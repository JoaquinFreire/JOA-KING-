import { fork } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yts from 'yt-search'
import youtubeDl from 'youtube-dl-exec'
import { ensureVoip } from './owner-voip.js'

const workerPath = fileURLToPath(new URL('../lib/voip-caller-worker.js', import.meta.url))
const authDir = path.resolve(process.env.BAILEYS_CALLER_AUTH_DIR || 'Sessions/VoipCaller')

const runningCaller = (conn) => {
  const child = conn.__baileysCaller
  return child && conn.__callerConnected && child.exitCode === null && child.connected ? child : null
}

const waitForCallerExit = (child, timeoutMs) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve(true)
  const onExit = () => {
    clearTimeout(timer)
    resolve(true)
  }
  const timer = setTimeout(() => {
    child.off('exit', onExit)
    resolve(child.exitCode !== null)
  }, timeoutMs)
  child.once('exit', onExit)
})

const stopCallerForReset = async (conn) => {
  if (conn.__callerGroupCall) {
    conn.__callerGroupCall.end()
    conn.__callerGroupCall = null
    conn.__callerGroupCallId = null
  }
  const child = conn.__baileysCaller
  if (!child || child.exitCode !== null) {
    conn.__baileysCaller = null
    conn.__callerConnected = false
    return
  }

  let exited = waitForCallerExit(child, 3000)
  try { child.send({ type: 'disconnect' }) } catch {}
  if (!(await exited)) {
    exited = waitForCallerExit(child, 3000)
    child.kill()
    if (!(await exited)) throw new Error('No se pudo cerrar el proceso Caller. No se movió la sesión.')
  }

  if (conn.__baileysCaller === child) conn.__baileysCaller = null
  conn.__callerConnected = false
}

const cleanupCallerAudio = async (conn) => {
  const filePath = conn.__callerAudioPath
  if (!filePath) return
  conn.__callerAudioPath = null
  await fs.unlink(filePath).catch(() => {})
}

const saveQuotedAudio = async (quoted) => {
  if (quoted?.mtype !== 'audioMessage') throw new Error('Responde a un audio de WhatsApp para usarlo en la llamada.')
  const mimeType = String(quoted.mimetype || '').split(';', 1)[0].toLowerCase()
  const extensionByMime = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/webm': 'webm'
  }
  const extension = extensionByMime[mimeType]
  if (!extension) throw new Error(`Formato de audio no compatible: ${mimeType || 'desconocido'}. Usa MP3, WAV u OGG.`)

  const buffer = await quoted.download()
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('No se pudo descargar el audio citado.')
  const directory = path.resolve('tmp', 'caller-audio')
  await fs.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `caller-${Date.now()}-${process.pid}.${extension}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

const resolveYoutubeAudio = async (query) => {
  const videoMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)
  const search = await yts(videoMatch ? `https://youtu.be/${videoMatch[1]}` : query)
  const videos = search.videos || []
  const video = videoMatch
    ? videos.find((item) => item.videoId === videoMatch[1])
    : search.all?.[0]
  if (!video) throw new Error('YouTube no encontró ninguna canción con esa búsqueda.')
  if (!video.url || !video.title) throw new Error('YouTube devolvió un resultado incompleto.')
  if (video.seconds > 1800) throw new Error('La canción supera el límite de 30 minutos.')

  const videoUrl = new URL(video.url)
  const isYoutubeHost = videoUrl.hostname === 'youtu.be'
    || videoUrl.hostname === 'youtube.com'
    || videoUrl.hostname.endsWith('.youtube.com')
  if (!isYoutubeHost) {
    throw new Error('El resultado de búsqueda no es un enlace válido de YouTube.')
  }

  let audioSource
  try {
    audioSource = await youtubeDl(videoUrl.toString(), {
      format: 'bestaudio/best',
      getUrl: true,
      noPlaylist: true,
      noWarnings: true,
      quiet: true
    })
  } catch (error) {
    const detail = String(error?.stderr || error?.message || 'error desconocido').trim().slice(0, 500)
    throw new Error(`yt-dlp no pudo obtener el audio de YouTube: ${detail}`)
  }

  const audioUrl = new URL(String(audioSource).trim().split(/\r?\n/, 1)[0])
  if (!['http:', 'https:'].includes(audioUrl.protocol)) throw new Error('yt-dlp devolvió una URL de audio no válida.')
  return { video, audioSource: audioUrl.toString() }
}

export const prepareGroupCallParticipants = async (conn, phoneNumbers) => {
  const pnJids = phoneNumbers.map((number) => `${number}@s.whatsapp.net`)
  const lidMapping = conn.signalRepository?.lidMapping
  if (typeof conn.getUSyncDevices !== 'function' || typeof lidMapping?.getLIDForPN !== 'function') {
    throw new Error('La sesión principal no expone USync/LID para preparar de forma segura los participantes grupales.')
  }

  try {
    await conn.getUSyncDevices(pnJids, false, false)
    const unresolved = []
    for (let index = 0; index < pnJids.length; index += 1) {
      const lid = await lidMapping.getLIDForPN(pnJids[index])
      if (typeof lid !== 'string' || !lid.endsWith('@lid')) unresolved.push(phoneNumbers[index])
    }
    if (unresolved.length) {
      throw new Error(`WhatsApp no devolvió un LID para ${unresolved.map((number) => `+${number}`).join(', ')}.`)
    }
  } catch (error) {
    throw new Error(`No se pudieron resolver las identidades de los participantes grupales: ${error?.message || String(error)}`)
  }
}

const startCaller = (conn, chat) => {
  const existing = runningCaller(conn)
  if (existing) return existing
  if (conn.__baileysCaller && conn.__baileysCaller.exitCode === null) {
    conn.__baileysCaller.kill()
    conn.__baileysCaller = null
  }

  const primaryAuthDir = path.resolve(global.sessions || 'Sessions/Principal')
  if (authDir === primaryAuthDir) {
    throw new Error('La sesión VoIP debe usar un directorio separado de la sesión principal.')
  }

  conn.__callerNotifyChat = chat
  conn.__callerConnected = false
  conn.__callerStartedAt = Date.now()
  const child = fork(workerPath, [], {
    cwd: process.cwd(),
    env: { ...process.env, BAILEYS_CALLER_AUTH_DIR: authDir },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })
  conn.__baileysCaller = child

  child.on('message', (message) => {
    if (!message || typeof message !== 'object') return

    const chatJid = conn.__callerNotifyChat
    const notify = (text) => {
      if (chatJid) conn.sendMessage(chatJid, { text }).catch((error) => console.error('[CALLER] No se pudo notificar:', error))
    }

    if (message.type === 'ready') {
      conn.__callerConnected = true
      console.log(`[CALLER] Sesión VoIP conectada; authDir=${message.authDir}`)
      notify(`La sesión de llamadas quedó conectada. Usa ${conn.__callerPrefix || '.'}caller llamar +549... para llamar.`)
    } else if (message.type === 'audio-ready') {
      conn.__callerStreamUrl = message.audioSource
      console.log('[CALLER] Stream local de audio listo para llamadas directas y grupales.')
    } else if (message.type === 'call-started') {
      conn.__callerDirectCall = true
      console.log(`[CALLER] Llamada iniciada a ${message.phoneNumber}; id=${message.callId}`)
      notify(`Llamada iniciada a +${message.phoneNumber}. Seguirá activa hasta que uses ${conn.__callerPrefix || '.'}caller colgar.`)
    } else if (message.type === 'call-state') {
      console.log(`[CALLER] Estado de llamada id=${message.callId}: ${message.state}`)
      if (message.state === 'ringing') notify('El teléfono remoto está sonando.')
      if (message.state === 'connected') notify(`La llamada directa fue atendida. Para iniciar una llamada grupal, usa ${conn.__callerPrefix || '.'}caller grupal +número dentro del grupo de WhatsApp.`)
    } else if (message.type === 'call-ended') {
      conn.__callerDirectCall = false
      console.log(`[CALLER] Llamada finalizada id=${message.callId}; motivo=${message.reason}`)
      void cleanupCallerAudio(conn)
      notify(`Llamada finalizada: ${message.reason}.`)
    } else if (message.type === 'fatal') {
      const detail = [message.message, message.code && `código=${message.code}`, message.reason && `motivo=${message.reason}`].filter(Boolean).join(' | ')
      console.error(`[CALLER] fatal: ${detail}`, message.stack || '')
      notify(`Caller: ${String(detail || 'error desconocido').slice(0, 900)}`)
      conn.__callerConnected = false
      void cleanupCallerAudio(conn)
      if (conn.__baileysCaller === child) conn.__baileysCaller = null
      if (child.exitCode === null) child.kill()
    } else if (message.type === 'error') {
      const detail = [message.message, message.code && `código=${message.code}`, message.reason && `motivo=${message.reason}`].filter(Boolean).join(' | ')
      console.error(`[CALLER] error: ${detail}`, message.stack || '')
      if (message.callSetupFailed) void cleanupCallerAudio(conn)
      notify(`Caller: ${String(detail || 'error desconocido').slice(0, 900)}`)
    } else if (message.type === 'status') {
      const state = message.callState == null ? 'ninguna' : String(message.callState)
      notify(`Caller conectado=${message.connected}; llamada=${state}; id=${message.callId || 'ninguna'}.`)
    } else if (message.type === 'track-queued') {
      notify(`Agregada a la cola: *${message.title}*. Canciones pendientes: ${message.queueLength}.`)
    } else if (message.type === 'track-started') {
      notify(`Reproduciendo: *${message.title}*. Canciones pendientes: ${message.queueLength}.`)
    } else if (message.type === 'track-error') {
      notify(`No se pudo reproducir *${message.title || 'la canción'}*: ${message.message}`)
    } else if (message.type === 'playback-paused') {
      notify('Música pausada.')
    } else if (message.type === 'playback-resumed') {
      notify('Música reanudada.')
    } else if (message.type === 'volume-set') {
      notify(`Volumen de la música: ${message.volume}%.`)
    } else if (message.type === 'queue-cleared') {
      notify('Se vació la cola. La canción actual, si hay una, continúa.')
    } else if (message.type === 'playback-stopped') {
      notify('Reproducción detenida.')
    } else if (message.type === 'playback-state') {
      const queue = message.queue.length ? message.queue.map((title, index) => `${index + 1}. ${title}`).join('\n') : 'vacía'
      notify(`Música: ${message.current || 'ninguna'}${message.paused ? ' (pausada)' : ''}\nVolumen: ${message.volume}%\nCola:\n${queue}`)
    } else if (message.type === 'group-playback-ready') {
      notify(`La música quedó conectada a la llamada grupal ${message.callId}.`)
    }
  })

  child.on('error', (error) => {
    console.error('[CALLER] Error del proceso hijo:', error)
    if (conn.__baileysCaller === child) conn.__callerConnected = false
  })
  child.on('exit', (code, signal) => {
    console.log(`[CALLER] Proceso finalizado; code=${code}; signal=${signal || 'ninguna'}`)
    void cleanupCallerAudio(conn)
    conn.__callerDirectCall = false
    conn.__callerStreamUrl = null
    if (conn.__callerGroupCall) {
      conn.__callerGroupCall.end()
      conn.__callerGroupCall = null
      conn.__callerGroupCallId = null
    }
    if (conn.__baileysCaller === child) {
      conn.__baileysCaller = null
      conn.__callerConnected = false
    }
  })

  return child
}

const handler = async (m, { conn, text, usedPrefix }) => {
  conn.__callerPrefix = usedPrefix
  const [action, target, ...audioParts] = String(text || '').trim().split(/\s+/)
  const audioArgument = audioParts.join(' ').replace(/^(['"])([\s\S]*)\1$/, '$2')

  try {
    if (action === 'renovar') {
      const primaryAuthDir = path.resolve(global.sessions || 'Sessions/Principal')
      if (authDir === primaryAuthDir) throw new Error('Por seguridad, no se puede renovar la sesión principal del bot.')
      await stopCallerForReset(conn)
      if (!existsSync(authDir)) return conn.reply(m.chat, `No hay credenciales Caller para renovar. Usa ${usedPrefix}caller iniciar.`, m)

      const backupDir = `${authDir}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
      await fs.rename(authDir, backupDir)
      return conn.reply(m.chat, `Sesión Caller anterior respaldada en ${backupDir}. Ahora usa ${usedPrefix}caller iniciar y escanea el nuevo QR. La sesión principal no se modificó.`, m)
    }

    if (action === 'iniciar') {
      const existing = conn.__baileysCaller
      if (existing && existing.exitCode === null && existing.connected) {
        if (conn.__callerConnected) return conn.reply(m.chat, 'La sesión caller ya está conectada.', m)
        if (Date.now() - (conn.__callerStartedAt || 0) < 45_000) {
          return conn.reply(m.chat, 'Caller todavía está iniciando. Mira la terminal para el QR o el motivo del fallo.', m)
        }
        existing.kill()
        conn.__baileysCaller = null
      }
      startCaller(conn, m.chat)
      return conn.reply(m.chat, `Iniciando el dispositivo VoIP separado. Escanea el QR en la terminal desde WhatsApp > Dispositivos vinculados. La sesión se guarda en ${authDir}.`, m)
    }

    if (action === 'reconectar') {
      await stopCallerForReset(conn)
      startCaller(conn, m.chat)
      return conn.reply(m.chat, `Reiniciando Caller con la sesión guardada en ${authDir}. Esto corta cualquier llamada activa; no debería pedir QR mientras WhatsApp conserve la vinculación.`, m)
    }

    if (action === 'llamar') {
      const phoneNumber = String(target || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(phoneNumber)) {
        return conn.reply(m.chat, `Usa el número completo con código de país. Ejemplo: ${usedPrefix}caller llamar +5493511234567`, m)
      }
      const child = runningCaller(conn)
      if (!child || !conn.__callerConnected) return conn.reply(m.chat, `Primero inicia y vincula el dispositivo con ${usedPrefix}caller iniciar.`, m)
      const configuredAudio = String(process.env.CALLER_AUDIO_SOURCE || '').trim()
      let cleanupAudioPath = null
      let requestedAudio = audioArgument || configuredAudio || 'silence'
      if (!audioArgument && m.quoted?.mtype === 'audioMessage') {
        if (conn.__callerAudioPath) return conn.reply(m.chat, 'Ya hay un audio temporal en uso por una llamada activa.', m)
        cleanupAudioPath = await saveQuotedAudio(m.quoted)
        conn.__callerAudioPath = cleanupAudioPath
        requestedAudio = cleanupAudioPath
      }
      const audioSource = requestedAudio.toLowerCase() === 'silence' ? 'silence' : path.resolve(requestedAudio)
      if (audioSource !== 'silence' && (!existsSync(audioSource) || !statSync(audioSource).isFile())) {
        if (cleanupAudioPath) await cleanupCallerAudio(conn)
        return conn.reply(m.chat, `No encuentro un archivo de audio válido en: ${audioSource}\nUsa un MP3 o WAV local, o pasa *silence*.`, m)
      }
      try {
        child.send({
          type: 'call',
          phoneNumber,
          initialAudioSource: audioSource,
          cleanupAudioPath
        })
      } catch (error) {
        if (cleanupAudioPath) await cleanupCallerAudio(conn)
        throw error
      }
      return
    }

    if (action === 'grupal') {
      if (!String(m.chat || '').endsWith('@g.us')) {
        return conn.reply(m.chat, `Ejecuta este comando dentro del grupo de WhatsApp donde quieres iniciar la llamada.\nUso: ${usedPrefix}caller grupal +549... [+549...]\nIncluye como argumentos a las personas a las que quieras invitar.`, m)
      }

      const participants = [...new Set([target, ...audioParts]
        .filter(Boolean)
        .map((number) => String(number).replace(/\D/g, '')))]
      if (!participants.length || participants.some((number) => !/^\d{8,15}$/.test(number))) {
        return conn.reply(m.chat, `Indica al menos un número internacional válido. Ejemplo: ${usedPrefix}caller grupal +5493511234567 +5493517654321`, m)
      }
      if (participants.length > 32) return conn.reply(m.chat, 'La llamada grupal admite como máximo 32 participantes invitados.', m)

      const child = runningCaller(conn)
      if (!child || !conn.__callerStreamUrl) {
        return conn.reply(m.chat, `Primero inicia Caller con ${usedPrefix}caller iniciar y espera a que se conecte.`, m)
      }
      if (conn.__callerDirectCall) {
        return conn.reply(m.chat, 'Cuelga primero la llamada directa de Caller; no se puede convertir una llamada directa en grupal.', m)
      }

      const voip = await ensureVoip(conn)
      if (voip.isBusy()) return conn.reply(m.chat, 'La sesión principal ya está en otra llamada VoIP.', m)

      await prepareGroupCallParticipants(conn, participants)
      const call = await voip.startGroupCall(m.chat, participants, {
        audioSource: conn.__callerStreamUrl,
        durationMs: 0,
        chatName: 'JOA-KING'
      })
      conn.__callerGroupCall = call
      conn.__callerGroupCallId = call.callId
      conn.__callerNotifyChat = m.chat
      child.send({ type: 'group-playback-start', callId: call.callId })
      let connected = false
      call.once('connected', () => {
        connected = true
        if (conn.__callerNotifyChat) {
          conn.sendMessage(conn.__callerNotifyChat, { text: `La llamada grupal quedó conectada. Ya pueden usar caller play y los controles de música.` })
            .catch((error) => console.error('[CALLER] No se pudo notificar la llamada grupal conectada:', error))
        }
      })
      call.once('ended', (reason) => {
        if (conn.__callerGroupCall === call) {
          conn.__callerGroupCall = null
          conn.__callerGroupCallId = null
        }
        try { child.send({ type: 'group-playback-stop', callId: call.callId }) } catch (error) {
          console.error('[CALLER] No se pudo detener el stream de la llamada grupal:', error)
        }
        console.log(`[CALLER] Llamada grupal finalizada id=${call.callId}; motivo=${reason}`)
        if (!connected && conn.__callerNotifyChat) {
          conn.sendMessage(conn.__callerNotifyChat, { text: `La llamada grupal terminó antes de conectarse (motivo: ${reason}). Revisa que los invitados puedan recibir llamadas.` })
            .catch((error) => console.error('[CALLER] No se pudo notificar el fallo de la llamada grupal:', error))
        }
      })
      return conn.reply(m.chat, `Solicité una llamada grupal en este chat e invité a ${participants.map((number) => `+${number}`).join(', ')}. Cuando conecte, podrás usar ${usedPrefix}caller play <canción>, los controles de música y ${usedPrefix}caller colgar.`, m)
    }

    if (action === 'play' || action === 'musica') {
      const query = [target, ...audioParts].filter(Boolean).join(' ').replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
      if (!query) return conn.reply(m.chat, `Indica una canción. Ejemplo: ${usedPrefix}caller play Soda Stereo De música ligera`, m)
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, `Primero inicia Caller y vincula el dispositivo con ${usedPrefix}caller iniciar.`, m)
      if (!conn.__callerDirectCall && !conn.__callerGroupCall) {
        return conn.reply(m.chat, 'No hay una llamada Caller activa. Usa caller llamar o caller grupal primero.', m)
      }
      conn.__callerNotifyChat = m.chat

      const { video, audioSource } = await resolveYoutubeAudio(query)
      child.send({ type: 'queue-track', title: video.title, audioSource })
      return conn.reply(m.chat, `Encontré *${video.title}* — ${video.author?.name || 'YouTube'}. La estoy agregando a la cola.`, m)
    }

    const playbackCommands = {
      pausa: 'pause',
      pause: 'pause',
      reanudar: 'resume',
      seguir: 'resume',
      resume: 'resume',
      saltar: 'skip',
      skip: 'skip',
      limpiarcola: 'clear-queue',
      cola: 'queue'
    }
    if (Object.hasOwn(playbackCommands, action)) {
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, `Primero inicia Caller con ${usedPrefix}caller iniciar.`, m)
      conn.__callerNotifyChat = m.chat
      child.send({ type: playbackCommands[action] })
      return
    }

    if (action === 'volumen' || action === 'volume') {
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, `Primero inicia Caller con ${usedPrefix}caller iniciar.`, m)
      const requestedVolume = Number(target)
      if (!Number.isInteger(requestedVolume) || requestedVolume < 0 || requestedVolume > 100) {
        return conn.reply(m.chat, `El volumen debe ser un entero entre 0 y 100. Ejemplo: ${usedPrefix}caller volumen 50`, m)
      }
      conn.__callerNotifyChat = m.chat
      child.send({ type: 'volume', volume: requestedVolume })
      return
    }

    if (action === 'colgar') {
      const groupCall = conn.__callerGroupCall
      if (groupCall) {
        groupCall.end()
        return conn.reply(m.chat, 'Se pidió finalizar la llamada grupal.', m)
      }
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, 'La sesión caller no está iniciada.', m)
      child.send({ type: 'hangup' })
      return conn.reply(m.chat, 'Se pidió finalizar la llamada.', m)
    }

    if (action === 'estado') {
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, `Caller no iniciado. Usa ${usedPrefix}caller iniciar.`, m)
      conn.__callerNotifyChat = m.chat
      child.send({ type: 'status' })
      if (conn.__callerGroupCall) {
        return conn.reply(m.chat, `Llamada grupal activa en ${conn.__callerGroupCall.groupJid || 'el grupo'}; id=${conn.__callerGroupCallId}.`, m)
      }
      return
    }

    if (action === 'detener') {
      const child = runningCaller(conn)
      if (!child) return conn.reply(m.chat, 'La sesión caller no está iniciada.', m)
      child.send({ type: 'disconnect' })
      return conn.reply(m.chat, 'Se está cerrando el dispositivo VoIP separado.', m)
    }

    return conn.reply(m.chat, `Comandos caller:\n${usedPrefix}caller iniciar\n${usedPrefix}caller reconectar\n${usedPrefix}caller estado\n${usedPrefix}caller llamar +549... [ruta.mp3|ruta.wav]\n${usedPrefix}caller grupal +549... [+549...] (desde el grupo donde se hará la llamada)\n${usedPrefix}caller play <canción o enlace de YouTube>\n${usedPrefix}caller pausa | reanudar | saltar\n${usedPrefix}caller volumen <0-100>\n${usedPrefix}caller cola | limpiarcola\n${usedPrefix}caller colgar\n${usedPrefix}caller detener\n${usedPrefix}caller renovar\nLa cola admite hasta 8 canciones pendientes; las canciones se transmiten sin guardarse en disco. Requiere ffmpeg instalado y disponible en PATH; yt-dlp se instala con npm install.`, m)
  } catch (error) {
    const detail = [error?.name, error?.message || String(error)].filter(Boolean).join(': ').slice(0, 1000)
    console.error('[CALLER] Error:', error)
    return conn.reply(m.chat, `Error de caller: ${detail}`, m)
  }
}

handler.help = ['caller iniciar', 'caller reconectar', 'caller estado', 'caller llamar <número> [audio.mp3|audio.wav]', 'caller grupal <número> [números...]', 'caller play <canción>', 'caller pausa', 'caller reanudar', 'caller saltar', 'caller volumen <0-100>', 'caller cola', 'caller limpiarcola', 'caller colgar', 'caller detener', 'caller renovar']
handler.tags = ['owner']
handler.command = ['caller']
handler.rowner = true

export default handler
import { existsSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const resolveVoipAudioSource = (conn, fallback = 'silence') => {
  const value = String(conn?.__voipAudioSource || '').trim()
  if (!value || value.toLowerCase() === 'silence') return 'silence'
  return path.resolve(value)
}

const saveQuotedVoipAudio = async (quoted) => {
  if (!quoted || quoted.mtype !== 'audioMessage') throw new Error('Responde a un audio de WhatsApp para usarlo como salida de llamada.')

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
  if (!extension) throw new Error(`Formato de audio no compatible: ${mimeType || 'desconocido'}.`)

  const buffer = await quoted.download()
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('No se pudo descargar el audio citado.')

  const directory = path.resolve('tmp', 'voip-audio')
  await fs.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `voip-${Date.now()}-${process.pid}.${extension}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

export const ensureVoip = async (conn) => {
  bindWireDiagnostics(conn)
  if (conn.voip) return conn.voip
  if (!conn?.ws) throw new Error('El socket de WhatsApp no está conectado.')

  const { attachVoip } = await import('@japofc/baileys')
  const resourcesPath = path.resolve('node_modules/@japofc/baileys/lib')

  const voip = await attachVoip(conn, {
    autoAnswer: false,
    autoJoinGroup: false,
    autoReject: false,
    audioSource: resolveVoipAudioSource(conn),
    resourcesPath,
    skipWasmIntegrityCheck: false
  })

  voip.on('incoming-call', async ({ callId, from, isGroupCall, busy }) => {
    console.log(`[VOIP] Llamada entrante ${isGroupCall ? 'grupal' : 'directa'} de ${from || 'origen desconocido'}; busy=${Boolean(busy)}`)
    if (busy) return
    try {
      const audioSource = resolveVoipAudioSource(conn)
      if (isGroupCall) {
        await voip.joinGroupCall(callId, { audioSource, joinAndAccept: true })
      } else {
        await voip.answerCall(callId, { audioSource })
      }
    } catch (error) {
      console.error('[VOIP] No se pudo responder a la llamada entrante:', error)
    }
  })
  voip.on('outgoing-call', ({ callId, to }) => {
    const call = voip.getActiveCall()
    if (call?.callId === callId) {
      call.on('ringing', () => console.log(`[VOIP] Está sonando la llamada ${callId}`))
      call.on('connected', () => console.log(`[VOIP] Llamada conectada ${callId}`))
    }
    console.log(`[VOIP] Llamada saliente a ${to}; id=${callId}`)
  })
  voip.on('call-ended', ({ callId, reason }) => {
    console.log(`[VOIP] Llamada finalizada id=${callId}; motivo=${reason}; ${relaySummary(voip)}`)
  })
  voip.on('call-degraded', ({ callId, attempt, maxRecoveries }) => {
    const call = voip.getActiveCall()
    const state = call?.state
    const stateLabel = state == null ? 'sin-llamada' : ({ 0: 'Idle', 1: 'Calling', 2: 'PreacceptReceived', 3: 'ReceivedCall', 4: 'AcceptSent', 5: 'AcceptReceived', 6: 'Active', 7: 'ActiveElsewhere', 13: 'Ending' }[state] || 'otro')
    console.warn(`[VOIP] Conexión degradada id=${callId}; fallo=${attempt}; recuperaciones=${maxRecoveries}; estado=${state ?? 'sin-llamada'} (${stateLabel}); ${relaySummary(voip)}`)
  })

  conn.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') voip.disconnect()
  })

  return voip
}

const relaySummary = (voip) => {
  const relay = voip.getStats()?.relay || {}
  return `relay abiertas=${relay.openConnections ?? 0}; enviados=${relay.sentPackets ?? 0}; recibidos=${relay.receivedPackets ?? 0}; descartados=${relay.droppedPackets ?? 0}`
}

  const bindWireDiagnostics = (conn) => {
    if (!conn?.ws || conn.__voipWireDiagnostics) return
    conn.__voipWireDiagnostics = true
      const callStanzas = new Set()

      try {
        const sendNode = conn.sendNode?.bind(conn)
        if (sendNode) {
          conn.sendNode = async (node) => {
            if (node?.tag !== 'call') return sendNode(node)
            const child = Array.isArray(node.content) ? node.content.find(item => item?.tag) : null
            const stanzaId = String(node.attrs?.id || '')
            const callId = String(child?.attrs?.['call-id'] || child?.attrs?.call_id || '')
            if (stanzaId) callStanzas.add(stanzaId)
            console.log(`[VOIP-WIRE] enviando tag=${child?.tag || 'desconocido'} stanza=${stanzaId || 'sin-id'} callId=${callId || 'sin-id'}`)
            try {
              const result = await sendNode(node)
              console.log(`[VOIP-WIRE] stanza call aceptado por socket stanza=${stanzaId || 'sin-id'}`)
              return result
            } catch (error) {
              if (stanzaId) callStanzas.delete(stanzaId)
              console.error(`[VOIP-WIRE] sendNode falló stanza=${stanzaId || 'sin-id'} error=${error?.name || 'Error'}:${error?.message || String(error)}`)
              throw error
            }
          }
        }
      } catch (error) {
        console.warn(`[VOIP-WIRE] No se pudo instrumentar sendNode: ${error?.message || String(error)}`)
      }

      try {
        const waitForMessage = conn.waitForMessage?.bind(conn)
        if (waitForMessage) {
          conn.waitForMessage = async (stanzaId, ...args) => {
            if (!callStanzas.has(String(stanzaId))) return waitForMessage(stanzaId, ...args)
            try {
              const ack = await waitForMessage(stanzaId, ...args)
              console.log(`[VOIP-WIRE] ACK stanza=${stanzaId} tag=${ack?.tag || 'sin-tag'} error=${ack?.attrs?.error || 'ninguno'}`)
              return ack
            } catch (error) {
              console.warn(`[VOIP-WIRE] ACK no recibido stanza=${stanzaId} error=${error?.name || 'Error'}:${error?.message || String(error)}`)
              throw error
            } finally {
              callStanzas.delete(String(stanzaId))
            }
          }
        }
      } catch (error) {
        console.warn(`[VOIP-WIRE] No se pudo instrumentar waitForMessage: ${error?.message || String(error)}`)
      }

    conn.ws.on('CB:call', (node) => {
      const child = Array.isArray(node?.content) ? node.content[0] : null
      const callId = child?.attrs?.['call-id'] || child?.attrs?.call_id || ''
      console.log(`[VOIP-WIRE] call recibido tag=${child?.tag || 'desconocido'} id=${callId || 'sin-id'}`)
    })
    conn.ws.on('CB:receipt', (node) => {
      const child = Array.isArray(node?.content) ? node.content[0] : null
      const callId = child?.attrs?.['call-id'] || child?.attrs?.call_id
      if (!callId) return
      console.log(`[VOIP-WIRE] receipt de llamada id=${callId} tipo=${child?.attrs?.type || 'sin-tipo'} error=${child?.attrs?.error || 'ninguno'}`)
    })
  }
const handler = async (m, { conn, text, usedPrefix }) => {
  const [action, target, ...audioParts] = String(text || '').trim().split(/\s+/)
  const audioArgument = audioParts.join(' ').replace(/^(['"])([\s\S]*)\1$/, '$2')

  try {
    if (action === 'iniciar') {
      const voip = await ensureVoip(conn)
      return conn.reply(m.chat, `VoIP inicializado en la misma sesión del bot.\nSe responderán llamadas entrantes con el audio actual (${resolveVoipAudioSource(conn)}).\nUsá ${usedPrefix}voip llamar +549... para iniciar una llamada manual.`, m)
    }

    if (action === 'audio') {
      const voip = await ensureVoip(conn)
      const quotedAudio = m.quoted?.mtype === 'audioMessage' ? m.quoted : null
      let audioSource = String(audioArgument || target || '').trim()

      if (!audioSource && quotedAudio) {
        const filePath = await saveQuotedVoipAudio(quotedAudio)
        conn.__voipAudioSource = filePath
        if (voip.getActiveCall()) voip.getActiveCall().setAudioSource(filePath)
        return conn.reply(m.chat, `Audio de respuesta configurado desde el mensaje citado: ${filePath}`, m)
      }

      if (!audioSource || audioSource.toLowerCase() === 'silence') {
        conn.__voipAudioSource = 'silence'
        if (voip.getActiveCall()) voip.getActiveCall().setAudioSource('silence')
        return conn.reply(m.chat, 'El audio de salida de VoIP quedó en silencio.', m)
      }

      const resolved = path.resolve(audioSource)
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        return conn.reply(m.chat, `No encuentro un archivo válido para audio VoIP: ${audioSource}`, m)
      }

      conn.__voipAudioSource = resolved
      if (voip.getActiveCall()) voip.getActiveCall().setAudioSource(resolved)
      return conn.reply(m.chat, `Audio VoIP configurado: ${resolved}`, m)
    }

    if (action === 'entrar' || action === 'unir') {
      const voip = await ensureVoip(conn)
      const pending = voip.getPendingCalls?.() || []
      const pendingGroup = pending.filter((call) => call?.isGroupCall)
      const quotedAudio = m.quoted?.mtype === 'audioMessage' ? m.quoted : null
      let callId = String(target || '').trim()
      let audioSource = String(audioArgument || '').trim()

      if (!audioSource && quotedAudio) {
        const filePath = await saveQuotedVoipAudio(quotedAudio)
        conn.__voipAudioSource = filePath
        audioSource = filePath
      }

      if (!callId) {
        if (!pendingGroup.length) return conn.reply(m.chat, 'No hay ninguna llamada grupal pendiente para entrar.', m)
        if (pendingGroup.length > 1) {
          return conn.reply(m.chat, `Hay varias llamadas grupales pendientes:\n${pendingGroup.map((entry) => entry.callId).join('\n')}`, m)
        }
        callId = pendingGroup[0].callId
      }

      if (!audioSource || audioSource.toLowerCase() === 'silence') {
        conn.__voipAudioSource = 'silence'
      } else {
        const resolved = path.resolve(audioSource)
        if (!existsSync(resolved) || !statSync(resolved).isFile()) {
          return conn.reply(m.chat, `No encuentro un archivo válido para la canción: ${audioSource}`, m)
        }
        conn.__voipAudioSource = resolved
      }

      const call = await voip.joinGroupCall(callId, {
        audioSource: resolveVoipAudioSource(conn),
        joinAndAccept: true
      })
      return conn.reply(m.chat, `Entré a la llamada grupal ${callId}. Audio: ${resolveVoipAudioSource(conn)}.`, m)
    }

    if (action === 'estado') {
      const voip = conn.voip
      if (!voip) return conn.reply(m.chat, `VoIP todavía no está iniciado. Usá ${usedPrefix}voip iniciar.`, m)
      const call = voip.getActiveCall()
      return conn.reply(m.chat, `VoIP activo. Llamada: ${call ? `${call.state} (${call.callId})` : 'ninguna'}. Audio: ${resolveVoipAudioSource(conn)}. ${relaySummary(voip)}`, m)
    }

    if (action === 'llamar') {
      const phoneNumber = String(target || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(phoneNumber)) {
        return conn.reply(m.chat, `Indicá el número completo con código de país. Ejemplo: ${usedPrefix}voip llamar +5493511234567`, m)
      }

      const voip = await ensureVoip(conn)
      if (voip.isBusy()) return conn.reply(m.chat, 'Ya hay una llamada VoIP activa.', m)

      const call = await voip.call(phoneNumber, {
        durationMs: 60_000,
        audioSource: resolveVoipAudioSource(conn)
      })
      return conn.reply(m.chat, `Llamada iniciada a +${phoneNumber}. Audio: ${resolveVoipAudioSource(conn)}. Para terminarla: ${usedPrefix}voip colgar.`, m)
    }

    if (action === 'grupal') {
      const voip = await ensureVoip(conn)
      const groupJid = String(target || '').trim()
      if (!groupJid) return conn.reply(m.chat, `Indicá el JID del grupo, por ejemplo: ${usedPrefix}voip grupal 120363...@g.us`, m)
      const call = await voip.startGroupCall(groupJid, [String(conn.user?.id || '').replace(/@s\.whatsapp\.net$/, '')], {
        chatName: 'JOA-KING',
        audioSource: resolveVoipAudioSource(conn)
      })
      return conn.reply(m.chat, `Se inició la llamada grupal ${groupJid}. Call id=${call.callId}.`, m)
    }

    if (action === 'colgar') {
      const call = conn.voip?.getActiveCall()
      if (!call) return conn.reply(m.chat, 'No hay una llamada VoIP activa.', m)
      call.end()
      return conn.reply(m.chat, 'Se pidió finalizar la llamada VoIP.', m)
    }

    return conn.reply(m.chat, `Comandos VoIP:\n${usedPrefix}voip iniciar\n${usedPrefix}voip audio [silence|ruta.mp3] o responde a un audio\n${usedPrefix}voip entrar [callId] [ruta.mp3]\n${usedPrefix}voip estado\n${usedPrefix}voip llamar +549...\n${usedPrefix}voip grupal <groupJid>\n${usedPrefix}voip colgar`, m)
  } catch (error) {
    const detail = [error?.name, error?.message || String(error)].filter(Boolean).join(': ').slice(0, 1000)
    console.error('[VOIP] Error:', error)
    return conn.reply(m.chat, `Falló la operación VoIP: ${detail}`, m)
  }
}

handler.help = ['voip iniciar', 'voip audio [silence|ruta.mp3]', 'voip entrar [callId] [ruta.mp3]', 'voip estado', 'voip llamar <número>', 'voip grupal <groupJid>', 'voip colgar']
handler.tags = ['owner']
handler.command = ['voip']
handler.rowner = true

export default handler
import { EdgeTTS } from 'node-edge-tts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MAX_TEXT_LENGTH = 1200

const voiceOptions = {
  vozloquendo2: {
    voice: 'es-MX-JorgeNeural',
    lang: 'es-MX',
    pitch: '-10%',
    rate: '-5%'
  },
  vozanime: {
    voice: 'es-MX-DaliaNeural',
    lang: 'es-MX',
    pitch: '+20%',
    rate: '+8%'
  }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const spokenText = String(text || '').trim()
  if (!spokenText) {
    return conn.reply(
      m.chat,
      `❀ Escribe el texto que quieres convertir en audio.\nEjemplo: *${usedPrefix}${command} Hola, ¿cómo estás?*`,
      m
    )
  }
  if (spokenText.length > MAX_TEXT_LENGTH) {
    return conn.reply(m.chat, `❀ El texto puede tener como máximo ${MAX_TEXT_LENGTH} caracteres.`, m)
  }

  if (command === 'vozloquendo') {
    return conn.reply(
      m.chat,
      '⚠︎ La voz original de Loquendo requiere acceso autorizado a su servicio o motor. La voz anterior sigue disponible como *%vozloquendo2*.',
      m
    )
  }

  const voice = voiceOptions[command]
  if (!voice) return conn.reply(m.chat, '✧ Ese comando de voz no está disponible.', m)

  let tempDirectory
  try {
    await m.react('🕒')
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'joa-king-tts-'))
    const audioPath = path.join(tempDirectory, 'voz.mp3')
    const tts = new EdgeTTS({
      ...voice,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 30000
    })
    await tts.ttsPromise(spokenText, audioPath)

    const audio = await readFile(audioPath)
    if (!audio.length) throw new Error('El servicio de voz devolvió un audio vacío.')

    await conn.sendMessage(m.chat, {
      audio,
      mimetype: 'audio/mpeg',
      fileName: `${command}.mp3`
    }, { quoted: m })
    await m.react('✔️')
  } catch (error) {
    await m.react('✖️')
    console.error(`[${String(command).toUpperCase()}] Error generando audio:`, error?.stack || error)
    return conn.reply(m.chat, '⚠︎ No se pudo generar el audio. Inténtalo de nuevo más tarde.', m)
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(error => {
        console.error('[TTS] No se pudo limpiar el audio temporal:', error?.message || error)
      })
    }
  }
}

handler.help = ['vozloquendo <texto>', 'vozloquendo2 <texto>', 'vozanime <texto>']
handler.tags = ['tools']
handler.command = ['vozloquendo', 'vozloquendo2', 'vozanime']

export default handler

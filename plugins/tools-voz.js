import { EdgeTTS } from 'node-edge-tts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toPTT } from '../lib/converter.js'
import { generateArgentinianVoice } from '../lib/piper-tts.js'

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
  const spokenText = String(text || '').trim() || String(m.quoted?.text || '').trim()
  if (!spokenText) {
    return conn.reply(
      m.chat,
      `❀ Escribe el texto que quieres convertir en audio o responde al mensaje que quieres convertir.\nEjemplo: *${usedPrefix}${command} Hola, ¿cómo estás?*`,
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
  if (command !== 'vozarg' && !voice) {
    return conn.reply(m.chat, '✧ Ese comando de voz no está disponible.', m)
  }

  let tempDirectory
  try {
    await m.react('🕒')
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'joa-king-tts-'))
    if (command === 'vozarg') {
      const wavPath = path.join(tempDirectory, 'vozarg.wav')
      await generateArgentinianVoice(spokenText, wavPath)
      const wav = await readFile(wavPath)
      if (!wav.length) throw new Error('Piper devolvió un audio vacío.')

      const audio = await toPTT(wav, 'wav')
      try {
        await conn.sendMessage(m.chat, {
          audio: audio.data,
          mimetype: 'audio/ogg; codecs=opus',
          fileName: 'vozarg.ogg',
          ptt: true
        }, { quoted: m })
      } finally {
        await audio.delete().catch(error => {
          console.error('[VOZARG] No se pudo limpiar el audio convertido:', error?.message || error)
        })
      }
    } else {
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
    }
    await m.react('✔️')
  } catch (error) {
    await m.react('✖️')
    console.error(`[${String(command).toUpperCase()}] Error generando audio:`, error?.stack || error)
    const detail = String(error?.message || error)
    const failureMessage = /No module named ['"]?piper|ModuleNotFoundError/.test(detail)
      ? '⚠︎ Falta instalar Piper. Ejecuta: *python -m pip install -r requirements-voice.txt*.'
      : /descarg|huggingface|network|ECONN|ETIMEDOUT|HTTP \d{3}/i.test(detail)
        ? '⚠︎ No se pudo descargar el modelo de voz argentina. Comprueba la conexión a Internet e inténtalo de nuevo.'
        : '⚠︎ No se pudo generar el audio. Inténtalo de nuevo más tarde.'
    return conn.reply(m.chat, failureMessage, m)
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(error => {
        console.error('[TTS] No se pudo limpiar el audio temporal:', error?.message || error)
      })
    }
  }
}

handler.help = ['vozarg <texto>', 'vozloquendo <texto>', 'vozloquendo2 <texto>', 'vozanime <texto>']
handler.tags = ['tools']
handler.command = ['vozarg', 'vozloquendo', 'vozloquendo2', 'vozanime']

export default handler

import { findPreviousCachedMessage } from '../lib/cached-message-history.js'
import { normalizeMessageContent } from '@whiskeysockets/baileys'

const handler = async (m, { conn }) => {
  const quotedMessageId = m.quoted?.id || m.quoted?.key?.id
  if (!quotedMessageId) {
    return conn.reply(m.chat, 'Responde con %rev al mensaje que aparece después del mensaje que querés recuperar.', m)
  }

  const previousMessage = findPreviousCachedMessage(
    global.__antideleteMessages,
    m.chat,
    quotedMessageId
  )
  if (!previousMessage?.message) {
    return conn.reply(m.chat, 'No encontré el mensaje anterior en el historial guardado de este chat.', m)
  }
  const content = normalizeMessageContent(previousMessage.message)
  const image = content?.imageMessage
  const video = content?.videoMessage
  const media = image || video
  if (media) {
    if (typeof conn.downloadM !== 'function') {
      throw new Error('La conexión no permite descargar los medios guardados.')
    }
    const buffer = await conn.downloadM(media, image ? 'image' : 'video')
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      return conn.reply(m.chat, 'No pude descargar el medio guardado para recuperarlo.', m)
    }
    const payload = image
      ? { image: buffer, mimetype: image.mimetype, caption: image.caption }
      : { video: buffer, mimetype: video.mimetype, caption: video.caption, gifPlayback: Boolean(video.gifPlayback) }
    return conn.sendMessage(m.chat, payload, { quoted: m })
  }
  if (typeof conn.copyNForward !== 'function') {
    throw new Error('La conexión no permite reenviar mensajes guardados.')
  }

  return conn.copyNForward(m.chat, previousMessage, true)
}

handler.help = ['rev (responde al mensaje posterior; recupera texto, imágenes y videos)']
handler.tags = ['tools']
handler.command = ['rev']
handler.group = true

export default handler

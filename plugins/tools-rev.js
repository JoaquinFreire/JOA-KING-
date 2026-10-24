import { findPreviousCachedMessage } from '../lib/cached-message-history.js'

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
  if (typeof conn.copyNForward !== 'function') {
    throw new Error('La conexión no permite reenviar mensajes guardados.')
  }

  return conn.copyNForward(m.chat, previousMessage, true)
}

handler.help = ['rev (responde al mensaje posterior)']
handler.tags = ['tools']
handler.command = ['rev']
handler.group = true

export default handler

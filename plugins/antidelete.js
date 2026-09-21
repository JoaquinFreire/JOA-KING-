import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const handledDeletes = new Set()
const deleteNotice = 'Borrá solo para vos, que yo quiero ver:'

const isAuthorized = (m, isOwner, isAdmin) => !m.isGroup || isAdmin || isOwner

const getOriginalMessage = (message) => {
  const content = message?.message || {}
  const type = Object.keys(content).find((key) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(key))
  if (!type) return null
  return { type, content: content[type] }
}

const getText = (content) => typeof content === 'string'
  ? content
  : content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || ''

const downloadMedia = async (content, type) => {
  const stream = await downloadContentFromMessage(content, type.replace('Message', '').toLowerCase())
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const resendDeleted = async (conn, protocolKey) => {
  const original = typeof conn.loadMessage === 'function' ? conn.loadMessage(protocolKey.id) : null
  const message = getOriginalMessage(original)
  if (!message) return false

  const text = getText(message.content)
  if (text && message.type !== 'imageMessage' && message.type !== 'videoMessage') {
    await conn.sendMessage(protocolKey.remoteJid, { text: `${deleteNotice}\n\n${text}` })
    return true
  }

  const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'])
  if (!mediaTypes.has(message.type) || !message.content?.url && !message.content?.directPath) return false

  const buffer = await downloadMedia(message.content, message.type)
  if (!buffer.length) return false
  const caption = `${deleteNotice}${text ? `\n\n${text}` : ''}`
  if (message.type === 'imageMessage') await conn.sendMessage(protocolKey.remoteJid, { image: buffer, caption })
  else if (message.type === 'videoMessage') await conn.sendMessage(protocolKey.remoteJid, { video: buffer, caption })
  else if (message.type === 'audioMessage') await conn.sendMessage(protocolKey.remoteJid, { audio: buffer, mimetype: message.content.mimetype || 'audio/ogg; codecs=opus', ptt: Boolean(message.content.ptt) })
  else if (message.type === 'stickerMessage') await conn.sendMessage(protocolKey.remoteJid, { sticker: buffer })
  else await conn.sendMessage(protocolKey.remoteJid, { document: buffer, fileName: message.content.fileName || 'mensaje-borrado', mimetype: message.content.mimetype || 'application/octet-stream', caption })
  return true
}

const handler = async (m, { conn, text, command, isOwner, isAdmin, chat }) => {
  const value = (text || '').trim().toLowerCase()
  if (command !== 'on' && command !== 'off') return
  if (value !== 'antidelete') return
  if (!isAuthorized(m, isOwner, isAdmin)) return conn.reply(m.chat, 'Solo un administrador puede activar esto en grupos.', m)

  const enabled = command === 'on'
  chat.antidelete = enabled
  await global.db.write().catch(() => {})
  return conn.reply(m.chat, `Antidelete ${enabled ? 'activado' : 'desactivado'} para este chat.`, m)
}

handler.all = async function (m, { chat }) {
  const conn = this
  const protocolMessage = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
  const protocolKey = protocolMessage?.key
  if (!chat?.antidelete || !protocolKey?.id || handledDeletes.has(protocolKey.id)) return
  handledDeletes.add(protocolKey.id)
  if (handledDeletes.size > 200) handledDeletes.delete(handledDeletes.values().next().value)

  try {
    const sent = await resendDeleted(conn, protocolKey)
    if (!sent) console.warn(`[ANTIDELETE] No se pudo recuperar el mensaje ${protocolKey.id}`)
  } catch (error) {
    console.error(`[ANTIDELETE] Error recuperando ${protocolKey.id}:`, error?.stack || error)
  }
}

handler.help = ['on antidelete', 'off antidelete']
handler.tags = ['owner']
handler.command = [/^on$/, /^off$/]

export default handler
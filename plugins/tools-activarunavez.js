import { getViewOnceMediaFromMessage, downloadViewOnceMedia } from '../lib/viewonce.js'

const ownerLids = new Set(['114864672526580'])
const botLids = new Set(['29107664511194'])
const handledProtocolMessages = new Set()

const ownerNumbers = new Set((global.owner || []).map((number) => number.replace(/\D/g, '')))

const resolveOwnerJids = async (conn) => {
  const jids = new Set()
  for (const number of global.owner || []) {
    const normalized = String(number).replace(/\D/g, '')
    if (!normalized) continue
    const resolved = typeof conn.onWhatsApp === 'function' ? await conn.onWhatsApp(normalized).catch(() => []) : []
    for (const item of resolved) if (item?.jid) jids.add(item.jid)
    if (!resolved.length) jids.add(`${normalized}@s.whatsapp.net`)
  }
  return [...jids]
}

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

const handler = async (m, { conn, text, command, isROwner, isOwner }) => {
  const commandValue = (command || '').trim().toLowerCase()
  const textValue = (text || '').trim().toLowerCase()
  if ((commandValue === 'on' || commandValue === 'off') && textValue === 'antidelete') return
  if (!await isConfiguredOwner(conn, m, isROwner, isOwner)) return conn.reply(m.chat, 'Solo el dueño puede usar este comando.', m)

  const value = commandValue === 'on' && textValue === 'noveruna' ? 'on noveruna' : textValue
  if (!['on noveruna', 'on', 'off', 'enable', 'disable', 'activar', 'desactivar'].includes(value)) {
    const status = global.db.data.chats[m.chat].captureViewOnce ? 'activado' : 'desactivado'
    return conn.reply(m.chat, `Uso: on noveruna\nEstado actual: ${status}`, m)
  }

  const enabled = value === 'on noveruna' || ['on', 'enable', 'activar'].includes(value)
  console.log(`[VIEW-ONCE] Comando recibido command=${commandValue} text=${textValue} enabled=${enabled} chat=${m.chat}`)
  global.db.data.chats[m.chat].captureViewOnce = enabled
  await global.db.write()
  return conn.reply(m.chat, `Captura de mensajes de una sola vez: ${enabled ? 'activada' : 'desactivada'}.`, m)
}

handler.all = async function (m, { chat }) {
  const conn = this
  const protocolMessage = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
  const protocolKey = protocolMessage?.key || null
  if (protocolKey?.id && chat?.captureViewOnce && !handledProtocolMessages.has(protocolKey.id)) {
    handledProtocolMessages.add(protocolKey.id)
    if (handledProtocolMessages.size > 100) handledProtocolMessages.delete(handledProtocolMessages.values().next().value)
    try {
      if (typeof conn.readMessages === 'function') await conn.readMessages([protocolKey])
      if (protocolKey.remoteJid && typeof conn.sendMessage === 'function') {
        await conn.sendMessage(protocolKey.remoteJid, { react: { text: '👀', key: protocolKey } })
      }
      console.log(`[VIEW-ONCE] Mensaje marcado id=${protocolKey.id}`)
    } catch (markError) {
      console.error('[VIEW-ONCE] No se pudo marcar el mensaje original:', markError?.message || markError)
    }
  }
  let media = getViewOnceMediaFromMessage(m)
  if (!media && protocolKey?.id && typeof conn.loadMessage === 'function') {
    const originalMessage = conn.loadMessage(protocolKey.id)
    media = getViewOnceMediaFromMessage(originalMessage)
    if (media) console.log(`[VIEW-ONCE] Mensaje original recuperado id=${protocolKey.id}`)
  }
  if (m.fromMe && !media && !protocolMessage) return
  if (!media) return
  if (!chat?.captureViewOnce) return
  console.log(`[VIEW-ONCE] Mensaje recibido chat=${m.chat} sender=${m.sender} mtype=${m.mtype} keys=${Object.keys(m.message || {}).join(',')}`)
  const ownerJids = await resolveOwnerJids(conn)
  console.log(`[VIEW-ONCE] Media detectada type=${media.type} destinos=${ownerJids.join(',') || 'ninguno'}`)
  if (!ownerJids.length) {
    console.error('[VIEW-ONCE] No se pudo resolver ningún propietario en WhatsApp')
    return
  }

  try {
    let buffer = null
    if (typeof m.download === 'function') {
      try {
        buffer = await m.download()
        console.log(`[VIEW-ONCE] Descarga por m.download bytes=${buffer?.length || 0}`)
      } catch (downloadError) {
        console.error('[VIEW-ONCE] m.download falló:', downloadError?.stack || downloadError)
      }
    }
    if (!buffer?.length) {
      buffer = await downloadViewOnceMedia(media.media, media.type)
      console.log(`[VIEW-ONCE] Descarga directa bytes=${buffer.length}`)
    }
    const caption = `View once capturado\nChat: ${m.isGroup ? m.chat : 'privado'}\nRemitente: ${m.sender}`
    for (const ownerJid of ownerJids) {
      if (media.type === 'imageMessage') {
        await conn.sendMessage(ownerJid, { image: buffer, caption }, { ephemeralExpiration: 0 })
      } else if (media.type === 'audioMessage') {
        await conn.sendMessage(ownerJid, { audio: buffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { ephemeralExpiration: 0 })
      } else if (media.type === 'videoMessage') {
        await conn.sendMessage(ownerJid, { video: buffer, caption, mimetype: media.media.mimetype || 'video/mp4' }, { ephemeralExpiration: 0 })
      } else {
        await conn.sendMessage(ownerJid, { document: buffer, fileName: media.media.fileName || 'view-once', mimetype: media.media.mimetype || 'application/octet-stream', caption }, { ephemeralExpiration: 0 })
      }
      console.log(`[VIEW-ONCE] Envío completado destino=${ownerJid}`)
    }
  } catch (error) {
    console.error(`[VIEW-ONCE] ERROR chat=${m.chat} sender=${m.sender} type=${media.type} destinos=${ownerJids.join(',')}`)
    console.error(error?.stack || error)
    for (const ownerJid of ownerJids) await conn.sendMessage(ownerJid, { text: `Error capturando view once\nChat: ${m.chat}\nRemitente: ${m.sender}\n${error.stack || error.message}` }).catch((sendError) => console.error(`[VIEW-ONCE] No se pudo enviar el detalle a ${ownerJid}:`, sendError?.stack || sendError))
  }
}

handler.help = ['on noveruna', 'activarunavez on/off']
handler.tags = ['owner']
handler.command = ['activarunavez', /^on$/]

export default handler
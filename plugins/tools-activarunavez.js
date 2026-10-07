import { getViewOnceMediaFromMessage, downloadViewOnceMedia } from '../lib/viewonce.js'

const ownerLids = new Set(['114864672526580'])
const botLids = new Set(['29107664511194'])
const handledProtocolMessages = new Set()

const ownerNumbers = new Set((global.owner || []).map((number) => number.replace(/\D/g, '')))

const getBotSettings = (conn) => {
  const settings = global.db.data.settings || (global.db.data.settings = {})
  const botJid = conn.user?.jid || conn.user?.id
  if (!botJid) return {}
  if (!settings[botJid] || typeof settings[botJid] !== 'object') settings[botJid] = {}
  return settings[botJid]
}

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

const getCachedOriginalMessage = async (conn, protocolKey) => {
  if (!protocolKey?.id) return null
  const cache = global.__antideleteMessages
  const cachedCandidates = [
    cache?.get(`${protocolKey.remoteJid || ''}:${protocolKey.id}`),
    cache?.get(protocolKey.id),
  ]
  const matchesProtocolKey = (candidate) => {
    if (candidate?.key?.id !== protocolKey.id) return false
    const cachedChat = String(candidate.key.remoteJid || candidate.chat || '')
    const protocolChat = String(protocolKey.remoteJid || '')
    return !cachedChat || !protocolChat || cachedChat.replace(/:\d+(?=@)/, '').toLowerCase() === protocolChat.replace(/:\d+(?=@)/, '').toLowerCase()
  }
  const cached = cachedCandidates.find(matchesProtocolKey)
  if (cached) return cached
  if (typeof conn.loadMessage !== 'function') return null
  try {
    const original = await conn.loadMessage(protocolKey.id)
    return matchesProtocolKey(original) ? original : null
  } catch (error) {
    console.warn(`[VIEW-ONCE] No se pudo recuperar el mensaje original ${protocolKey.id}:`, error?.message || error)
    return null
  }
}

const resolveGroupMetadata = async (conn, groupJid) => {
  if (!groupJid?.endsWith('@g.us') || typeof conn.groupMetadata !== 'function') return null
  try {
    return await conn.groupMetadata(groupJid)
  } catch (error) {
    console.warn(`[VIEW-ONCE] No se pudo resolver el grupo ${groupJid}:`, error?.message || error)
    return null
  }
}

const resolvePhoneNumber = async (conn, sourceMessage, protocolKey, groupMetadata) => {
  const groupCandidates = (groupMetadata?.participants || []).filter((participant) => {
    const messageSender = [
      sourceMessage?.key?.participant,
      sourceMessage?.sender,
      sourceMessage?.participant,
      protocolKey?.participant,
    ].filter(Boolean).map((jid) => String(jid).replace(/:\d+/g, '').toLowerCase())
    const participantIds = [participant?.id, participant?.jid, participant?.lid]
      .filter(Boolean)
      .map((jid) => String(jid).replace(/:\d+/g, '').toLowerCase())
    return participantIds.some((jid) => messageSender.includes(jid))
  })
  const candidates = [
    ...groupCandidates.flatMap((participant) => [participant?.phoneNumber, participant?.jid, participant?.id]),
    sourceMessage?.key?.senderPn,
    sourceMessage?.key?.remoteJidAlt,
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    protocolKey?.participant,
    sourceMessage?.key?.remoteJid?.endsWith('@g.us') ? null : sourceMessage?.key?.remoteJid,
    protocolKey?.remoteJid?.endsWith('@g.us') ? null : protocolKey?.remoteJid,
  ].filter(Boolean)

  for (const candidate of candidates) {
    let jid = conn.decodeJid?.(String(candidate)) || String(candidate)
    if (jid.endsWith('@lid')) {
      try {
        jid = await conn.signalRepository?.lidMapping?.getPNForLID?.(jid) || jid
      } catch (error) {
        console.warn('[VIEW-ONCE] No se pudo resolver el número del remitente:', error?.message || error)
      }
    }
    const number = String(jid).split('@')[0].replace(/\D/g, '')
    if (number.length >= 7) return `+${number}`
  }
  return 'Número no disponible'
}

const resolveBotPrivateJid = (conn) => [
  conn.user?.jid,
  conn.decodeJid?.(conn.user?.id),
  conn.user?.id,
  conn.user?.lid,
].find((jid) => jid && !jid.endsWith('@g.us') && !jid.endsWith('@newsletter') && jid !== 'status@broadcast')

const isConfiguredOwner = async (conn, m, isROwner, isOwner) => {
  if (isROwner || isOwner || m.fromMe) return true
  const candidates = [m.sender, m.key?.participant, m.key?.senderPn, m.key?.remoteJidAlt]
  const candidateNumbers = candidates.map((jid) => String(jid || '').replace(/\D/g, ''))
  if (candidateNumbers.some((number) => ownerNumbers.has(number) || ownerLids.has(number) || botLids.has(number))) return true
  const botJids = [conn.user?.id, conn.user?.jid, conn.user?.lid]
  if (candidates.some((jid) => botJids.includes(jid))) return true
  if (typeof conn.onWhatsApp !== 'function') return false
  const resolved = await conn.onWhatsApp(m.sender).catch(() => [])
  return resolved.some(({ jid }) => ownerNumbers.has(String(jid || '').replace(/\D/g, '')))
}

const handler = async (m, { conn, text, command, isROwner, isOwner, chat }) => {
  const commandValue = (command || '').trim().toLowerCase()
  const textValue = (text || '').trim().toLowerCase()
  const antiDeleteTargets = ['antidelete', 'antideleteprivate', 'antideleteprivado', 'antidelete private', 'antidelete privado']
  if ((commandValue === 'on' || commandValue === 'off') && antiDeleteTargets.includes(textValue)) return
  if (!await isConfiguredOwner(conn, m, isROwner, isOwner)) return conn.reply(m.chat, 'Solo el dueño puede usar este comando.', m)

  const value = commandValue === 'on' && textValue === 'noveruna' ? 'on noveruna' : textValue
  const targetChat = chat || global.db.data.chats[m.chat] || (global.db.data.chats[m.chat] = {})
  const botSettings = getBotSettings(conn)
  const destination = /^(destino|destination)\s+(bot|owner)$/.exec(value)
  if (destination) {
    botSettings.captureViewOnceTarget = destination[2]
    await global.db.write()
    return conn.reply(m.chat, `Los mensajes de una sola vez eliminados de grupos se enviarán al privado del ${destination[2] === 'bot' ? 'bot' : 'owner'}.`, m)
  }
  if (!['on noveruna', 'on', 'off', 'enable', 'disable', 'activar', 'desactivar'].includes(value)) {
    const status = targetChat.captureViewOnce ? 'activado' : 'desactivado'
    const currentDestination = botSettings.captureViewOnceTarget === 'owner' ? 'owner' : 'bot'
    return conn.reply(m.chat, `Uso: activarunavez on noveruna | activarunavez on/off | activarunavez destino bot/owner\nEstado actual: ${status}\nDestino de eliminados de grupos: ${currentDestination}`, m)
  }

  const enabled = value === 'on noveruna' || ['on', 'enable', 'activar'].includes(value)
  console.log(`[VIEW-ONCE] Comando recibido command=${commandValue} text=${textValue} enabled=${enabled} chat=${m.chat}`)
  targetChat.captureViewOnce = enabled
  await global.db.write()
  return conn.reply(m.chat, `Captura de mensajes de una sola vez: ${enabled ? 'activada' : 'desactivada'}.`, m)
}

handler.all = async function (m, { chat }) {
  const conn = this
  const protocolMessage = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
  const protocolKey = protocolMessage?.key || null
  if (!chat?.captureViewOnce) return
  if (protocolKey?.fromMe || m.fromMe) return
  if (protocolKey?.id && !handledProtocolMessages.has(protocolKey.id)) {
    handledProtocolMessages.add(protocolKey.id)
    if (handledProtocolMessages.size > 100) handledProtocolMessages.delete(handledProtocolMessages.values().next().value)
    console.log(`[VIEW-ONCE] Mensaje protocolo recibido id=${protocolKey.id} remote=${protocolKey.remoteJid || ''}`)
  }
  const sourceMessage = protocolKey?.id
    ? await getCachedOriginalMessage(conn, protocolKey) || m
    : m
  const media = getViewOnceMediaFromMessage(sourceMessage) || getViewOnceMediaFromMessage(m)
  if (m.fromMe && !media && !protocolMessage) return
  if (!media) return
  const sourceChat = String(sourceMessage?.key?.remoteJid || sourceMessage?.chat || m.chat || '')
  const isDeletedGroupViewOnce = Boolean(protocolMessage && sourceChat.endsWith('@g.us'))
  const groupMetadata = isDeletedGroupViewOnce ? await resolveGroupMetadata(conn, sourceChat) : null
  const senderNumber = await resolvePhoneNumber(conn, sourceMessage, protocolKey, groupMetadata)
  const groupName = groupMetadata?.subject || sourceChat
  const sendsDeletedToBot = isDeletedGroupViewOnce && (getBotSettings(conn).captureViewOnceTarget || 'bot') === 'bot'
  const destinations = sendsDeletedToBot
    ? [resolveBotPrivateJid(conn)].filter(Boolean)
    : await resolveOwnerJids(conn)
  console.log(`[VIEW-ONCE] Media detectada type=${media.type} destinos=${destinations.join(',') || 'ninguno'}`)
  if (!destinations.length) {
    console.error(sendsDeletedToBot
      ? '[VIEW-ONCE] No se pudo resolver el chat privado del bot'
      : '[VIEW-ONCE] No se pudo resolver ningún propietario en WhatsApp')
    return
  }

  try {
    const buffer = await downloadViewOnceMedia(media.media, media.type)
    console.log(`[VIEW-ONCE] Descarga directa bytes=${buffer.length}`)
    const caption = isDeletedGroupViewOnce
      ? `Mensaje para una vez eliminado\nGrupo: ${groupName}\nNúmero: ${senderNumber}`
      : `View once capturado\nChat: ${sourceChat.endsWith('@g.us') ? groupName : 'privado'}\nRemitente: ${senderNumber}`
    for (const destination of destinations) {
      if (media.type === 'imageMessage') {
        await conn.sendMessage(destination, { image: buffer, caption }, { ephemeralExpiration: 0 })
      } else if (media.type === 'audioMessage') {
        await conn.sendMessage(destination, { audio: buffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { ephemeralExpiration: 0 })
      } else if (media.type === 'videoMessage') {
        await conn.sendMessage(destination, { video: buffer, caption, mimetype: media.media.mimetype || 'video/mp4' }, { ephemeralExpiration: 0 })
      } else {
        await conn.sendMessage(destination, { document: buffer, fileName: media.media.fileName || 'view-once', mimetype: media.media.mimetype || 'application/octet-stream', caption }, { ephemeralExpiration: 0 })
      }
      console.log(`[VIEW-ONCE] Envío completado destino=${destination}`)
    }
  } catch (error) {
    console.error(`[VIEW-ONCE] ERROR chat=${sourceChat} sender=${senderNumber} type=${media.type} destinos=${destinations.join(',')}`)
    console.error(error?.stack || error)
    for (const destination of destinations) await conn.sendMessage(destination, { text: `Error capturando view once\nChat: ${sourceChat}\nRemitente: ${senderNumber}\n${error.stack || error.message}` }).catch((sendError) => console.error(`[VIEW-ONCE] No se pudo enviar el detalle a ${destination}:`, sendError?.stack || sendError))
  }
}

handler.help = ['activarunavez on noveruna', 'activarunavez on/off', 'activarunavez destino bot/owner']
handler.tags = ['owner']
handler.command = ['activarunavez']

export default handler
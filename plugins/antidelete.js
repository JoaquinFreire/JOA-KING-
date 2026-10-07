import fs from 'fs'
import path from 'path'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { warmUpTranscription } from './tools-autotranscribe.js'

const handledDeletes = new Set()
const deleteNotice = 'Borrá solo para vos, que yo quiero ver:'
const antideleteCacheFile = path.join(process.cwd(), 'tmp', 'antidelete-cache.json')

const getBotChatKey = (conn, chatId) => {
  const safeChatId = String(chatId || '').trim()
  const botJid = String(conn?.user?.jid || conn?.user?.id || conn?.jid || global.conn?.user?.jid || '').trim()
  if (!safeChatId) return safeChatId
  if (!botJid) return safeChatId
  return `${botJid}::${safeChatId}`
}

const getBotChat = (conn, chatId, create = false) => {
  const chats = global.db?.data?.chats || {}
  const safeChatId = String(chatId || '').trim()
  if (!safeChatId) return {}
  const scopedKey = getBotChatKey(conn, safeChatId)
  const scoped = chats[scopedKey]
  if (scoped && typeof scoped === 'object') return scoped
  if (create) {
    const base = chats[safeChatId] && typeof chats[safeChatId] === 'object' ? chats[safeChatId] : {}
    chats[scopedKey] = base
    return chats[scopedKey]
  }
  return chats[safeChatId] || {}
}

const getChatFlag = (chat, keys) => {
  for (const key of keys) {
    const value = chat?.[key]
    if (value !== undefined) return Boolean(value)
  }
  return false
}

const loadAntideleteHistory = () => {
  try {
    if (!fs.existsSync(antideleteCacheFile)) return new Map()
    const raw = fs.readFileSync(antideleteCacheFile, 'utf8')
    const parsed = JSON.parse(raw)
    return new Map(Object.entries(parsed || {}))
  } catch (error) {
    console.warn('[ANTIDELETE] Cache persistente no se pudo leer:', error?.message || error)
    return new Map()
  }
}

const safeCall = (fn) => {
  try {
    return Promise.resolve(fn()).catch(() => null)
  } catch (_) {
    return Promise.resolve(null)
  }
}

const isAuthorized = (m, isOwner, isAdmin) => !m.isGroup || isAdmin || isOwner
const normalizeJid = (jid) => String(jid || '').replace(/:\d+/g, '').replace(/\s+/g, '').toLowerCase().replace(/@.*$/, '').replace(/\D+/g, '')
const isGroupJid = (jid) => String(jid || '').endsWith('@g.us')
const isPrivateJid = (jid) => {
  const value = String(jid || '')
  return value && !value.endsWith('@g.us') && !value.endsWith('@newsletter') && value !== 'status@broadcast'
}

const decodeJid = (conn, jid) => {
  const value = String(jid || '').trim()
  if (!value) return ''
  const decoded = conn?.decodeJid?.(value)
  return typeof decoded === 'string' && decoded ? decoded : value
}

const resolveOwnerJids = async (conn) => {
  const targets = new Set()
  for (const owner of global.owner || []) {
    const number = String(owner || '').replace(/\D/g, '')
    if (!number) continue
    const resolved = typeof conn?.onWhatsApp === 'function' ? await conn.onWhatsApp(number).catch(() => []) : []
    for (const item of resolved || []) if (isPrivateJid(item?.jid)) targets.add(item.jid)
    if (!targets.size || !(resolved || []).length) targets.add(`${number}@s.whatsapp.net`)
  }
  return [...targets]
}

const findParticipantByJid = async (conn, groupJid, candidates = []) => {
  if (!isGroupJid(groupJid) || typeof conn?.groupMetadata !== 'function') return null
  const metadata = await safeCall(() => conn.groupMetadata(groupJid))
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : []
  if (!participants.length) return null
  const needles = candidates
    .map((jid) => decodeJid(conn, jid))
    .filter(Boolean)
  const needleNumbers = needles.map(normalizeJid).filter(Boolean)
  return participants.find((participant) => {
    const ids = [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber].map((jid) => decodeJid(conn, jid)).filter(Boolean)
    return ids.some((id) => needles.includes(id) || needleNumbers.includes(normalizeJid(id)))
  }) || null
}

const resolveLidToPhone = async (conn, jid) => {
  const value = decodeJid(conn, jid)
  if (!value.endsWith('@lid')) return value
  const mapped = await safeCall(() => conn?.signalRepository?.lidMapping?.getPNForLID?.(value))
  return typeof mapped === 'string' && mapped ? mapped : value
}

const getProfileState = (chat, profileName) => {
  const savedMode = String(chat?.[`${profileName}Mode`] || 'public').toLowerCase()
  const publicEnabled = Boolean(chat?.[`${profileName}Public`] ?? chat?.[`${profileName}public`])
  const privateEnabled = Boolean(chat?.[`${profileName}Private`] ?? chat?.[`${profileName}private`])
  const legacyValue = Boolean(chat?.[profileName])

  let resolvedMode = ['public', 'private'].includes(savedMode) ? savedMode : 'public'
  let publicState = publicEnabled
  let privateState = privateEnabled

  if (publicState && privateState) {
    if (resolvedMode === 'private') {
      publicState = false
    } else {
      privateState = false
    }
  }

  if (!publicState && !privateState && legacyValue) {
    resolvedMode = savedMode === 'private' ? 'private' : 'public'
    if (resolvedMode === 'private') privateState = true
    else publicState = true
  }

  if (resolvedMode === 'private') {
    publicState = false
  } else {
    privateState = false
  }

  return {
    mode: resolvedMode,
    publicEnabled: publicState,
    privateEnabled: privateState,
    legacyValue
  }
}

const saveProfileState = (chat, profileName, enabled, mode) => {
  const normalizedMode = ['public', 'private'].includes(mode) ? mode : 'public'
  const publicState = Boolean(enabled && normalizedMode === 'public')
  const privateState = Boolean(enabled && normalizedMode === 'private')

  chat[`${profileName}Mode`] = normalizedMode
  chat[`${profileName}Public`] = publicState
  chat[`${profileName}Private`] = privateState
  chat[`${profileName}public`] = publicState
  chat[`${profileName}private`] = privateState
  chat[profileName] = Boolean(enabled)
  return chat
}

const resetProfileState = (chat, profileName) => {
  const keys = [
    `${profileName}Mode`,
    `${profileName}Public`, `${profileName}Private`,
    `${profileName}public`, `${profileName}private`,
    profileName
  ]
  for (const key of keys) delete chat[key]
  return chat
}

const getOriginalMessage = (message) => {
  if (!message) return null
  const source = message.message || message
  const type = Object.keys(source || {}).find((key) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(key))
  if (!type) return null
  return { type, content: source[type] }
}

const isUnsupportedAntideleteContent = (content) => {
  if (!content || typeof content !== 'object') return false
  for (const [type, value] of Object.entries(content)) {
    if (/^viewOnceMessage/.test(type) || type === 'audioMessage' || value?.viewOnce) return true
    if (['ephemeralMessage', 'documentWithCaptionMessage'].includes(type) && isUnsupportedAntideleteContent(value?.message)) return true
  }
  return false
}

const getText = (content) => typeof content === 'string'
  ? content
  : content?.conversation || content?.text || content?.caption || content?.body || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || ''

const findSafePrivateTarget = (conn, candidates = []) => {
  const botJids = new Set([
    conn?.user?.jid,
    conn?.user?.id,
    conn?.user?.lid,
    conn?.decodeJid?.(conn?.user?.jid),
    conn?.decodeJid?.(conn?.user?.id),
    conn?.decodeJid?.(conn?.user?.lid),
    conn?.user?.verifiedName ? `${String(conn.user.verifiedName).replace(/\D/g, '')}@s.whatsapp.net` : null
  ].filter(Boolean))

  for (const candidate of candidates) {
    if (!candidate) continue
    const value = String(candidate).trim()
    if (!isPrivateJid(value)) continue
    const decoded = conn?.decodeJid?.(value) || value
    const normalized = decoded.replace(/:.*$/, '')
    if (!botJids.has(value) && !botJids.has(decoded) && !botJids.has(normalized)) return value
  }

  return ''
}

const normalizeForDisplay = (jid) => {
  const value = String(jid || '').trim()
  if (!value) return null
  const clean = value.split('@')[0]
  if (!clean) return null
  if (/^\d+$/.test(clean)) return `+${clean}`
  return value
}

const resolveSenderIdentity = async (conn, sourceMessage, protocolKey) => {
  const candidateJids = [...new Set([
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    sourceMessage?.key?.remoteJid,
    protocolKey?.participant,
    protocolKey?.remoteJid,
    sourceMessage?.key?.senderPn,
    sourceMessage?.key?.remoteJidAlt,
    sourceMessage?.key?.fromMe ? conn?.user?.jid : null,
  ].filter(Boolean))]

  let phone = null
  let name = null

  for (const jid of candidateJids) {
    if (typeof conn?.getName === 'function') {
      try {
        const resolvedName = await conn.getName(jid)
        if (resolvedName) name = resolvedName
      } catch (error) {
        // Ignorar resolución fallida de nombre
      }
    }

    const normalized = normalizeForDisplay(jid)
    if (normalized && /^\+\d+$/.test(normalized)) {
      phone = normalized
    }

    if (phone && name) break
  }

  if (!phone) {
    for (const jid of candidateJids) {
      const raw = String(jid || '')
      if (raw.includes('@lid')) {
        const lid = raw.replace(/@.*$/, '')
        const fallback = normalizeForDisplay(lid)
        if (fallback) phone = fallback
      }
    }
  }

  if (!phone) {
    for (const jid of candidateJids) {
      const raw = String(jid || '')
      if (raw.includes('@')) {
        const fallback = normalizeForDisplay(raw)
        if (fallback) phone = fallback
      }
    }
  }

  if (!name && phone) {
    name = 'Desconocido'
  }

  if (!phone && candidateJids.length) {
    phone = String(candidateJids[0]).replace(/@.*$/, '')
  }

  return { phone: phone || 'LID no disponible', name: name || 'Desconocido' }
}

const resolveDeleteSenderIdentity = async (conn, sourceMessage, protocolKey) => {
  const chatJid = protocolKey?.remoteJid || sourceMessage?.key?.remoteJid || sourceMessage?.chat || ''
  const participant = await findParticipantByJid(conn, chatJid, [
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    protocolKey?.participant,
    sourceMessage?.key?.senderPn,
    sourceMessage?.key?.remoteJidAlt,
  ])
  const candidateJids = [...new Set([
    participant?.phoneNumber,
    participant?.jid,
    participant?.id,
    participant?.lid,
    sourceMessage?.key?.participant,
    sourceMessage?.sender,
    sourceMessage?.participant,
    protocolKey?.participant,
    isPrivateJid(protocolKey?.remoteJid) ? protocolKey?.remoteJid : null,
    isPrivateJid(sourceMessage?.key?.remoteJid) ? sourceMessage?.key?.remoteJid : null,
    sourceMessage?.key?.senderPn,
    sourceMessage?.key?.remoteJidAlt,
    sourceMessage?.key?.fromMe ? conn?.user?.jid : null,
  ].filter(Boolean))]

  let phone = null
  let name = null
  for (const jid of candidateJids) {
    const resolvedJid = await resolveLidToPhone(conn, jid)
    const normalized = normalizeForDisplay(resolvedJid)
    if (normalized && /^\+\d+$/.test(normalized)) phone = normalized
    const resolvedName = typeof conn?.getName === 'function' ? await safeCall(() => conn.getName(resolvedJid)) : null
    if (resolvedName) name = resolvedName
    if (phone && name) break
  }

  if (!phone) {
    for (const jid of candidateJids) {
      const raw = String(jid || '')
      if (raw.endsWith('@g.us')) continue
      const fallback = normalizeForDisplay(raw.includes('@lid') ? raw.replace(/@.*$/, '') : raw)
      if (fallback) {
        phone = fallback
        break
      }
    }
  }

  return { phone: phone || 'LID no disponible', name: name || 'Desconocido' }
}

const formatGroupDeleteNotice = async (conn, sourceMessage, protocolKey) => {
  const { phone, name } = await resolveDeleteSenderIdentity(conn, sourceMessage, protocolKey)
  const cleanName = String(name || 'Desconocido').trim()
  const firstHandle = cleanName && cleanName !== 'Desconocido' ? cleanName : (phone || 'LID no disponible')
  return `@${firstHandle.replace(/^\+/, '').replace(/\s+/g, '')} eliminó este mensaje`
}

const downloadMedia = async (content, type) => {
  const stream = await downloadContentFromMessage(content, type.replace('Message', '').toLowerCase())
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const findCachedMessage = (conn, protocolKey) => {
  const antideleteMap = global.__antideleteMessages || loadAntideleteHistory()
  global.__antideleteMessages = antideleteMap
  if (!protocolKey?.id) return null
  const remoteJid = normalizeJid(protocolKey.remoteJid)
  const matchesDelete = (value) => {
    if (!value || typeof value !== 'object') return false
    const valueKey = value.key || {}
    const valueId = valueKey.id || value.id
    const valueRemote = normalizeJid(valueKey.remoteJid || value.chat || value.remoteJid)
    return valueId === protocolKey.id && (!remoteJid || valueRemote === remoteJid)
  }
  const keys = [`${protocolKey.remoteJid || ''}:${protocolKey.id}`, protocolKey.id]
  for (const key of keys) {
    const candidate = antideleteMap?.get(key)
    if (matchesDelete(candidate)) return candidate
  }

  const stores = [conn?.chats, conn?.store?.chats]
  for (const store of stores) {
    if (!store || typeof store !== 'object') continue
    for (const chatEntry of Object.values(store)) {
      const messages = chatEntry?.messages
      if (!messages || typeof messages !== 'object') continue
      for (const candidate of Object.values(messages)) {
        if (matchesDelete(candidate)) return candidate
      }
    }
  }
  return null
}

const resendDeleted = async (conn, protocolKey, options = {}) => {
  const cached = findCachedMessage(conn, protocolKey)
  const original = typeof conn.loadMessage === 'function' ? await conn.loadMessage(protocolKey.id) : null
  const sourceMessage = cached || (original?.key?.id === protocolKey.id && (!original.key.remoteJid || normalizeJid(original.key.remoteJid) === normalizeJid(protocolKey.remoteJid)) ? original : null)
  const payload = sourceMessage
  if (isUnsupportedAntideleteContent(payload?.message || payload)) return false
  const message = getOriginalMessage(payload)
  if (!message) return false

  const targets = new Set()
  const remoteTarget = protocolKey.remoteJid || payload?.key?.remoteJid || payload?.chat || ''
  const sameChatTarget = options.sameChatTarget || remoteTarget
  const isPrivateChat = isPrivateJid(remoteTarget)
  const botJids = new Set([
    conn?.user?.jid,
    conn?.user?.id,
    conn?.user?.lid,
    conn?.decodeJid?.(conn?.user?.jid),
    conn?.decodeJid?.(conn?.user?.id),
    conn?.decodeJid?.(conn?.user?.lid),
  ].filter(Boolean))
  const botPrivateTarget = [
    conn?.user?.jid,
    conn?.decodeJid?.(conn?.user?.id),
    conn?.user?.id,
    conn?.user?.lid,
  ].find(isPrivateJid)

  if (options.sendToSameChat && isPrivateJid(sameChatTarget)) {
    const chosenTarget = String(sameChatTarget).trim()
    if (chosenTarget && !botJids.has(chosenTarget) && !botJids.has(conn?.decodeJid?.(chosenTarget) || '')) {
      targets.add(chosenTarget)
    }
  }

  if (!isPrivateChat && options.privateTarget) {
    if (botPrivateTarget) targets.add(botPrivateTarget)
  }

  if (options.privateTarget && isPrivateChat && !options.sendToSameChat) {
    if (botPrivateTarget) targets.add(botPrivateTarget)
  }

  if (options.groupTarget && isGroupJid(remoteTarget)) targets.add(remoteTarget)
  if (!targets.size) return false

  const text = getText(message.content)
  const privateHeader = options.privateTarget ? await resolveSenderIdentity(conn, payload, protocolKey).then(({ phone, name }) => `${phone || 'LID no disponible'} ~ ${name || 'Desconocido'} eliminó este mensaje`) : null
  const groupHeader = options.groupTarget ? await formatGroupDeleteNotice(conn, payload, protocolKey) : null
  const sendToTargets = async (payloadMessage) => {
    for (const target of targets) {
      const decodedTarget = conn?.decodeJid?.(target) || target
      const isPrivateDestination = [conn?.user?.jid, conn?.user?.id, conn?.user?.lid]
        .some((jid) => jid && (String(jid) === String(target) || (conn?.decodeJid?.(jid) || jid) === decodedTarget))
      const isGroupDestination = isGroupJid(target)
      const finalText = isPrivateDestination && privateHeader
        ? `${privateHeader}\n\n${payloadMessage.text || ''}`
        : isGroupDestination && groupHeader
          ? `${groupHeader}\n\n${payloadMessage.text || ''}`
          : payloadMessage.text || ''
      await conn.sendMessage(target, { ...payloadMessage, text: finalText })
    }
  }

  if (text && message.type !== 'imageMessage' && message.type !== 'videoMessage') {
    await sendToTargets({ text: `${text}` })
    return true
  }

  const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'])
  if (!mediaTypes.has(message.type) || (!message.content?.url && !message.content?.directPath)) return false

  const buffer = await downloadMedia(message.content, message.type)
  if (!buffer.length) return false
  for (const target of targets) {
    const decodedTarget = conn?.decodeJid?.(target) || target
    const isPrivateDestination = [conn?.user?.jid, conn?.user?.id, conn?.user?.lid]
      .some((jid) => jid && (String(jid) === String(target) || (conn?.decodeJid?.(jid) || jid) === decodedTarget))
    const isGroupDestination = isGroupJid(target)
    const captionPrefix = isPrivateDestination && privateHeader
      ? `${privateHeader}${text ? `\n\n${text}` : ''}`
      : isGroupDestination && groupHeader
        ? `${groupHeader}${text ? `\n\n${text}` : ''}`
        : `${deleteNotice}${text ? `\n\n${text}` : ''}`
    const caption = captionPrefix

    if (message.type === 'imageMessage') await conn.sendMessage(target, { image: buffer, caption })
    else if (message.type === 'videoMessage') await conn.sendMessage(target, { video: buffer, caption })
    else if (message.type === 'audioMessage') await conn.sendMessage(target, { audio: buffer, mimetype: message.content.mimetype || 'audio/ogg; codecs=opus', ptt: Boolean(message.content.ptt) })
    else if (message.type === 'stickerMessage') await conn.sendMessage(target, { sticker: buffer })
    else await conn.sendMessage(target, { document: buffer, fileName: message.content.fileName || 'mensaje-borrado', mimetype: message.content.mimetype || 'application/octet-stream', caption })
  }
  return true
}

const handler = async (m, { conn, text, command, isOwner, isAdmin, chat }) => {
  const value = (text || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const action = (command || '').trim().toLowerCase()
  if (action === 'onoff') {
    const targetChat = getBotChat(conn, m.chat, true)
    const summary = [
      ['antidelete public', getProfileState(targetChat, 'antidelete').publicEnabled],
      ['antidelete private', getProfileState(targetChat, 'antidelete').privateEnabled],
      ['antideletep public', getProfileState(targetChat, 'antideletep').publicEnabled],
      ['antideletep private', getProfileState(targetChat, 'antideletep').privateEnabled],
      ['welcome', Boolean(targetChat.welcome)],
      ['detect', Boolean(targetChat.detect)],
      ['antilink', Boolean(targetChat.antiLink)],
      ['nsfw', Boolean(targetChat.nsfw)],
      ['modoadmin', Boolean(targetChat.modoadmin)]
    ]
    const lines = summary.map(([label, enabled]) => `${label}: ${enabled ? 'activado' : 'apagado'}`)
    return conn.reply(m.chat, `Estado del chat:\n${lines.join('\n')}`, m)
  }

  if (!['on', 'off', 'reset'].includes(action)) return

  const normalized = value || ''
  if (['on', 'off'].includes(action) && normalized === 'autotranscribe') {
    if (!isAuthorized(m, isOwner, isAdmin)) {
      return conn.reply(m.chat, 'Solo un administrador puede cambiar la transcripción automática en grupos.', m)
    }
    const targetChat = getBotChat(conn, m.chat, true)
    const wasEnabled = Boolean(targetChat.autoTranscribe)
    targetChat.autoTranscribe = action === 'on'
    await global.db.write().catch(() => {})
    if (targetChat.autoTranscribe && !wasEnabled) {
      await conn.reply(m.chat, 'Transcripción automática activada. Preparando el modelo local; esto solo tarda en el primer uso.', m)
      void warmUpTranscription().then(() => {
        conn.reply(m.chat, 'Modelo de transcripción listo para las notas de voz.', m).catch(() => {})
      }).catch(error => {
        console.error('[AUTO-TRANSCRIBE] No se pudo preparar el modelo:', error)
        conn.reply(m.chat, `Se activó la opción, pero no se pudo preparar Whisper: ${error.message}`, m).catch(() => {})
      })
      return
    }
    return conn.reply(m.chat, `Transcripción automática de notas de voz ${targetChat.autoTranscribe ? 'activada' : 'desactivada'} para este chat.`, m)
  }

  const profileTargets = {
    antidelete: {
      public: ['antidelete', 'antidelete public', 'antidelete grupal', 'antidelete group'],
      private: ['antideleteprivate', 'antidelete private', 'antideleteprivado', 'antidelete privado']
    },
    antideletep: {
      public: ['antideletep', 'antideletep public', 'antideletep grupal', 'antideletep group'],
      private: ['antideletepprivate', 'antideletep private', 'antideletepprivado', 'antideletep privado']
    }
  }

  const matchedProfile = Object.entries(profileTargets).find(([, modes]) =>
    Object.entries(modes).some(([, aliases]) => aliases.includes(normalized))
  )

  if (!matchedProfile && action === 'reset' && ['antidelete', 'antideletep'].includes(normalized)) {
    const targetChat = getBotChat(conn, m.chat, true)
    resetProfileState(targetChat, normalized)
    await global.db.write().catch(() => {})
    return conn.reply(m.chat, `Se reinició el estado de ${normalized} para este chat.`, m)
  }

  if (!matchedProfile) return
  const [profileName, modes] = matchedProfile
  const mode = Object.entries(modes).find(([, aliases]) => aliases.includes(normalized))?.[0] || 'public'

  if (profileName === 'antidelete' && !m.isGroup) {
    return conn.reply(m.chat, 'El antidelete sin la p solo puede activarse en grupos. Usa antideletep para chats privados.', m)
  }

  if (profileName === 'antideletep' && m.isGroup) {
    return conn.reply(m.chat, 'antideletep no se puede activar en grupos. Solo en chats privados.', m)
  }

  if (!isAuthorized(m, isOwner, isAdmin)) return conn.reply(m.chat, 'Solo un administrador puede activar esto en grupos.', m)

  const targetChat = getBotChat(conn, m.chat, true)
  if (action === 'reset') {
    resetProfileState(targetChat, profileName)
    await global.db.write().catch(() => {})
    return conn.reply(m.chat, `Se reinició ${profileName} para este chat.`, m)
  }

  const enabled = action === 'on'
  const profileState = getProfileState(targetChat, profileName)

  if (enabled && mode === 'private' && profileState.publicEnabled) {
    return conn.reply(m.chat, `Primero desactiva ${profileName} public para poder activar ${profileName} private.`, m)
  }

  if (enabled && mode === 'public' && profileState.privateEnabled) {
    return conn.reply(m.chat, `Primero desactiva ${profileName} private para poder activar ${profileName} public.`, m)
  }

  saveProfileState(targetChat, profileName, enabled, mode)
  await global.db.write().catch(() => {})

  return conn.reply(m.chat, `${profileName} ${mode} ${enabled ? 'activado' : 'desactivado'} para este chat.`, m)
}

handler.all = async function (m, { chat }) {
  const conn = this
  const botScopedChat = getBotChat(conn, m.chat, true)
  const protocolMessage = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
  const protocolKey = protocolMessage?.key
  const isOwnDelete = Boolean(protocolKey?.fromMe || m.fromMe || m.key?.fromMe)
  const isGroupDelete = !!(protocolKey?.remoteJid && String(protocolKey.remoteJid).endsWith('@g.us'))
  const isPrivateDelete = isPrivateJid(protocolKey?.remoteJid)

  const antideleteState = getProfileState(botScopedChat, 'antidelete')
  const antideletepState = getProfileState(botScopedChat, 'antideletep')

  const antideleteGroupPublicEnabled = Boolean(antideleteState.publicEnabled && isGroupDelete)
  const antideleteGroupPrivateEnabled = Boolean(antideleteState.privateEnabled && isGroupDelete)
  const antideletepPrivatePublicEnabled = Boolean(antideletepState.publicEnabled && isPrivateDelete)
  const antideletepPrivatePrivateEnabled = Boolean(antideletepState.privateEnabled && isPrivateDelete)

  const shouldRecover = Boolean(
    antideleteGroupPublicEnabled ||
    antideleteGroupPrivateEnabled ||
    antideletepPrivatePublicEnabled ||
    antideletepPrivatePrivateEnabled
  )
  if (isOwnDelete || !shouldRecover || !protocolKey?.id || handledDeletes.has(protocolKey.id)) return
  handledDeletes.add(protocolKey.id)
  if (handledDeletes.size > 200) handledDeletes.delete(handledDeletes.values().next().value)

  try {
    const route = {
      privateTarget: false,
      groupTarget: false,
      sendToSameChat: false,
      sameChatTarget: findSafePrivateTarget(conn, [
        protocolKey?.remoteJid,
        m.chat,
        m.sender,
        protocolKey?.participant,
        m.key?.remoteJid,
        m.key?.participant,
      ])
    }

    if (isGroupDelete) {
      route.groupTarget = antideleteGroupPublicEnabled
      route.privateTarget = antideleteGroupPrivateEnabled
    }

    if (isPrivateDelete) {
      route.sendToSameChat = antideletepPrivatePublicEnabled
      route.privateTarget = antideletepPrivatePrivateEnabled && !antideletepPrivatePublicEnabled
    }

    const sent = await resendDeleted(conn, protocolKey, route)
    if (!sent) console.warn(`[ANTIDELETE] No se pudo recuperar el mensaje ${protocolKey.id}`)
  } catch (error) {
    console.error(`[ANTIDELETE] Error recuperando ${protocolKey.id}:`, error?.stack || error)
  }
}

handler.help = ['on antidelete public', 'off antidelete public', 'on antidelete private', 'off antidelete private', 'on antideletep public', 'off antideletep public', 'on antideletep private', 'off antideletep private', 'on autotranscribe', 'off autotranscribe', 'reset antidelete', 'reset antideletep', 'onoff']
handler.tags = ['owner']
handler.command = [/^on$/, /^off$/, /^reset$/, /^onoff$/]

export default handler

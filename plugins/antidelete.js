import fs from 'fs'
import path from 'path'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const handledDeletes = new Set()
const deleteNotice = 'Borrá solo para vos, que yo quiero ver:'
const antideleteCacheFile = path.join(process.cwd(), 'tmp', 'antidelete-cache.json')

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

const isAuthorized = (m, isOwner, isAdmin) => !m.isGroup || isAdmin || isOwner
const normalizeJid = (jid) => String(jid || '').replace(/:\d+/g, '').replace(/\s+/g, '').toLowerCase().replace(/@.*$/, '').replace(/\D+/g, '')

const getOriginalMessage = (message) => {
  if (!message) return null
  const source = message.message || message
  const type = Object.keys(source || {}).find((key) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(key))
  if (!type) return null
  return { type, content: source[type] }
}

const getText = (content) => typeof content === 'string'
  ? content
  : content?.conversation || content?.text || content?.caption || content?.body || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || ''

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

const formatGroupDeleteNotice = async (conn, sourceMessage, protocolKey) => {
  const { phone, name } = await resolveSenderIdentity(conn, sourceMessage, protocolKey)
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
  const candidateMessages = []

  if (antideleteMap && protocolKey?.id) {
    candidateMessages.push(antideleteMap.get(protocolKey.id))
    candidateMessages.push(antideleteMap.get(`${protocolKey.remoteJid || ''}:${protocolKey.id}`))
    for (const value of antideleteMap.values()) candidateMessages.push(value)
  }

  if (conn?.chats && typeof conn.chats === 'object') {
    for (const chatEntry of Object.values(conn.chats)) {
      if (!chatEntry || typeof chatEntry !== 'object') continue
      const messages = chatEntry.messages || {}
      for (const value of Object.values(messages)) candidateMessages.push(value)
    }
  }

  if (conn?.store?.chats && typeof conn.store.chats === 'object') {
    for (const chatEntry of Object.values(conn.store.chats)) {
      if (!chatEntry || typeof chatEntry !== 'object') continue
      const messages = chatEntry.messages || {}
      for (const value of Object.values(messages)) candidateMessages.push(value)
    }
  }

  const remoteJid = normalizeJid(protocolKey?.remoteJid)
  const participant = normalizeJid(protocolKey?.participant)
  const chatTarget = normalizeJid((conn?.chats && Object.keys(conn.chats).find((jid) => normalizeJid(jid) === remoteJid)) || protocolKey?.remoteJid)
  let bestMatch = null
  let bestScore = -1

  for (const value of [...candidateMessages].reverse()) {
    if (!value || typeof value !== 'object') continue
    const valueKey = value.key || {}
    const candidateId = valueKey.id || value.id
    const valueRemote = normalizeJid(valueKey.remoteJid || value.chat || value.remoteJid)
    const valueParticipant = normalizeJid(valueKey.participant || value.sender || value.participant)
    const sameId = Boolean(protocolKey?.id && candidateId === protocolKey.id)
    const sameRemote = Boolean(remoteJid && (valueRemote === remoteJid || valueRemote === chatTarget || chatTarget === remoteJid))
    const sameParticipant = Boolean(participant && (valueParticipant === participant || valueParticipant === remoteJid || participant === remoteJid))

    let score = 0
    if (sameId) score = 100
    else if (sameRemote && sameParticipant) score = 90
    else if (sameRemote) score = 70
    else if (sameParticipant) score = 60

    if (score > bestScore) {
      bestScore = score
      bestMatch = value
    }
  }

  if (bestMatch) return bestMatch

  if (remoteJid) {
    for (const value of [...candidateMessages].reverse()) {
      if (!value || typeof value !== 'object') continue
      const valueKey = value.key || {}
      const valueRemote = normalizeJid(valueKey.remoteJid || value.chat || value.remoteJid)
      if (valueRemote === remoteJid) return value
    }
  }

  return null
}

const resendDeleted = async (conn, protocolKey, options = {}) => {
  const original = typeof conn.loadMessage === 'function' ? conn.loadMessage(protocolKey.id) : null
  const cached = findCachedMessage(conn, protocolKey)
  const sourceMessage = cached || original
  const payload = sourceMessage?.message ? sourceMessage : sourceMessage
  const message = getOriginalMessage(payload)
  if (!message) return false

  const targets = new Set()
  const privateTarget = conn.user?.jid || conn.user?.id || conn.user?.lid || ''
  const groupTarget = protocolKey.remoteJid || payload?.key?.remoteJid || payload?.chat || ''

  if (options.privateTarget && privateTarget) targets.add(privateTarget)
  if (options.groupTarget && groupTarget && groupTarget !== privateTarget) targets.add(groupTarget)
  if (!targets.size) return false

  const text = getText(message.content)
  const privateHeader = options.privateTarget ? await resolveSenderIdentity(conn, payload, protocolKey).then(({ phone, name }) => `${phone || 'LID no disponible'} ~ ${name || 'Desconocido'} eliminó este mensaje`) : null
  const groupHeader = options.groupTarget ? await formatGroupDeleteNotice(conn, payload, protocolKey) : null
  const sendToTargets = async (payloadMessage) => {
    for (const target of targets) {
      const isPrivateDestination = String(target) === (conn.user?.jid || conn.user?.id || conn.user?.lid || '')
      const isGroupDestination = String(target).endsWith('@g.us') || String(target).endsWith('@s.whatsapp.net')
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
    const isPrivateDestination = String(target) === (conn.user?.jid || conn.user?.id || conn.user?.lid || '')
    const isGroupDestination = String(target).endsWith('@g.us') || String(target).endsWith('@s.whatsapp.net')
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
  if (!['on', 'off'].includes(action)) return

  const normalized = value || ''
  const isPrivateTarget = ['antideleteprivate', 'antideleteprivado', 'antidelete private', 'antidelete privado'].includes(normalized)
  const isGroupTarget = normalized === 'antidelete'
  if (!isPrivateTarget && !isGroupTarget) return
  if (!isAuthorized(m, isOwner, isAdmin)) return conn.reply(m.chat, 'Solo un administrador puede activar esto en grupos.', m)

  const targetChat = chat || global.db.data.chats[m.chat] || {}
  const enabled = action === 'on'
  if (isPrivateTarget) targetChat.antideletePrivate = enabled
  else targetChat.antidelete = enabled
  await global.db.write().catch(() => {})
  return conn.reply(m.chat, `Antidelete ${isPrivateTarget ? 'privado' : 'grupal'} ${enabled ? 'activado' : 'desactivado'} para este chat.`, m)
}

handler.all = async function (m, { chat }) {
  const conn = this
  const protocolMessage = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
  const protocolKey = protocolMessage?.key
  const groupEnabled = Boolean(chat?.antidelete)
  const privateEnabled = Boolean(chat?.antideletePrivate)
  const shouldRecover = Boolean(groupEnabled || privateEnabled)
  if (!shouldRecover || !protocolKey?.id || handledDeletes.has(protocolKey.id)) return
  handledDeletes.add(protocolKey.id)
  if (handledDeletes.size > 200) handledDeletes.delete(handledDeletes.values().next().value)

  try {
    const sent = await resendDeleted(conn, protocolKey, {
      privateTarget: privateEnabled,
      groupTarget: groupEnabled
    })
    if (!sent) console.warn(`[ANTIDELETE] No se pudo recuperar el mensaje ${protocolKey.id}`)
  } catch (error) {
    console.error(`[ANTIDELETE] Error recuperando ${protocolKey.id}:`, error?.stack || error)
  }
}

handler.help = ['on antidelete', 'off antidelete', 'on antideleteprivate', 'off antideleteprivate']
handler.tags = ['owner']
handler.command = [/^on$/, /^off$/]

export default handler
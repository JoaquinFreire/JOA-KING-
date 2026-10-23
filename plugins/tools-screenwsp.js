import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fetch from 'node-fetch'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const MAX_MESSAGES = 14
const MAX_AVATARS = 10
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(PLUGIN_DIR, '..')
const FAKEWSP_DIR = path.join(ROOT_DIR, 'pruebas', 'fakewsp')
const PYTHON_SCRIPT = path.join(FAKEWSP_DIR, 'render_screenw.py')
const PYTHON = process.platform === 'win32'
  ? path.join(FAKEWSP_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(FAKEWSP_DIR, '.venv', 'bin', 'python')

const unwrapMessage = (message) => {
  let content = message?.message
  while (content && typeof content === 'object') {
    const wrapper = content.ephemeralMessage || content.viewOnceMessage ||
      content.viewOnceMessageV2 || content.documentWithCaptionMessage
    if (!wrapper?.message) break
    content = wrapper.message
  }
  return content || {}
}

const getContextInfo = (message) => {
  const content = unwrapMessage(message)
  return Object.values(content).find(value => value && typeof value === 'object' && value.contextInfo)?.contextInfo || {}
}

const getBody = async (message, identities, conn) => {
  const content = unwrapMessage(message)
  let text = content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption ||
    content.documentMessage?.caption
  if (text) {
    text = String(text).trim()
    const context = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo ||
      content.videoMessage?.contextInfo || content.documentMessage?.contextInfo || {}
    const mentionJids = context.mentionedJid || []
    const tokens = [...text.matchAll(/@(\d{5,})/g)]
    for (const [index, token] of tokens.entries()) {
      const digits = token[1]
      const identity = identities.resolve(`${digits}@lid`) || identities.resolve(`${digits}@s.whatsapp.net`) || identities.resolve(mentionJids[index])
      let displayName = identity?.name
      if (!displayName || /^\d+$/.test(String(displayName))) {
        displayName = ''
        for (const jid of [mentionJids[index], `${digits}@s.whatsapp.net`, `${digits}@lid`]) {
          displayName = conn.chats?.[jid]?.name
          if (!displayName) {
            try { displayName = await conn.getName?.(jid) } catch {}
          }
          if (displayName && !/^\d+$/.test(String(displayName))) break
          displayName = ''
        }
      }
      if (displayName && !/^\d+$/.test(String(displayName))) {
        text = text.replace(`@${digits}`, `\uE000${displayName}\uE001`)
      }
    }
    return text
  }
  if (content.imageMessage) return ''
  if (content.videoMessage) return '\u{1F3A5} Video'
  if (content.stickerMessage) return 'Sticker'
  if (content.audioMessage) return content.audioMessage.ptt ? '\u{1F3A4} Audio' : '\u{1F3B5} Audio'
  if (content.documentMessage) return '\u{1F4CE} Documento'
  if (content.contactMessage || content.contactsArrayMessage) return '\u{1F464} Contacto'
  if (content.locationMessage || content.liveLocationMessage) return '\u{1F4CD} Ubicaci\u00f3n'
  return ''
}

const getReplyPreview = async (message, identities, conn) => {
  const context = getContextInfo(message)
  const chat = message.key?.remoteJid
  const quotedFromStore = context.stanzaId
    ? Object.values(conn.chats?.[chat]?.messages || {}).find(candidate => candidate?.key?.id === context.stanzaId)
    : null
  const quotedMessage = context.quotedMessage || quotedFromStore?.message
  if (!quotedMessage) return null

  const quotedSender = context.participant || context.remoteJid || ''
  const identity = identities.resolve(quotedSender)
  let name = identity?.name || conn.chats?.[quotedSender]?.name
  if (!name && quotedSender) {
    try { name = await conn.getName?.(quotedSender) } catch {}
  }
  const quoted = unwrapMessage({ message: quotedMessage })
  const text = await getBody({ message: quotedMessage }, identities, conn)
  let image = null
  if (quoted.imageMessage?.jpegThumbnail) {
    const thumbnail = quoted.imageMessage.jpegThumbnail
    let bytes
    if (Buffer.isBuffer(thumbnail)) bytes = thumbnail
    else if (thumbnail instanceof Uint8Array) bytes = Buffer.from(thumbnail)
    else if (typeof thumbnail === 'string') bytes = Buffer.from(thumbnail, 'base64')
    else if (Array.isArray(thumbnail)) bytes = Buffer.from(thumbnail)
    if (bytes?.length && bytes[0] === 0xff && bytes[1] === 0xd8) {
      image = `data:image/jpeg;base64,${bytes.toString('base64')}`
    }
  }
  if (!image && quoted.imageMessage) image = await downloadImage({ message: quotedMessage })
  return {
    name: String(name || quotedSender.split('@')[0] || 'Usuario'),
    text: text || (quoted.imageMessage ? 'Imagen' : 'Mensaje'),
    image,
    kind: quoted.imageMessage ? 'image' : 'text',
  }
}

const asTimestamp = (value) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  if (value && typeof value.toNumber === 'function') return value.toNumber()
  return Number(value) || 0
}

const asUserJid = (value) => {
  if (!value) return ''
  const text = String(value).trim().replace(/:\d+(@(?:s\.whatsapp\.net|lid))$/, '$1')
  if (/@(?:s\.whatsapp\.net|lid)$/.test(text)) return text
  if (/^\d{5,}$/.test(text)) return `${text}@s.whatsapp.net`
  return ''
}

const buildIdentityIndex = async (conn, metadata, chat) => {
  const byAlias = new Map()
  const identities = []
  const lidMapping = conn.signalRepository?.lidMapping
  for (const participant of metadata?.participants || []) {
    const raw = [participant.phoneNumber, participant.jid, participant.id, participant.lid]
      .map(asUserJid).filter(Boolean)
    const lid = raw.find(jid => jid.endsWith('@lid'))
    let mappedPn = ''
    if (lid) {
      try { mappedPn = asUserJid(await lidMapping?.getPNForLID?.(lid)) } catch {}
      if (!mappedPn && global.lidResolver?.resolveLid) {
        try { mappedPn = asUserJid(await global.lidResolver.resolveLid(lid, chat, 2)) } catch {}
      }
    }
    const phone = raw.find(jid => jid.endsWith('@s.whatsapp.net')) || mappedPn
    const canonical = phone || lid || raw[0]
    if (!canonical) continue
    const contactName = raw.map(jid => conn.chats?.[jid]?.name).find(name => name && !/^\d+$/.test(String(name))) ||
      conn.chats?.[phone]?.name || conn.chats?.[canonical]?.name
    let displayName = [participant.notify, participant.name, contactName]
      .find(name => name && !/^\d+$/.test(String(name)))
    if (!displayName) {
      for (const jid of [...raw, mappedPn]) {
        if (!jid) continue
        try {
          const resolvedName = await conn.getName?.(jid)
          if (resolvedName && !/^\d+$/.test(String(resolvedName))) {
            displayName = resolvedName
            break
          }
        } catch {}
      }
    }
    const identity = {
      id: canonical,
      phone,
      name: String(displayName || (phone ? phone.split('@')[0] : 'Usuario')),
      is_self: false,
    }
    identities.push(identity)
    for (const alias of [...raw, mappedPn, canonical]) {
      const jid = asUserJid(alias)
      if (jid) byAlias.set(jid, identity)
    }
  }
  const resolve = value => byAlias.get(asUserJid(value))
  const selfIdentity = [conn.user?.jid, conn.user?.id].map(resolve).find(Boolean)
  if (selfIdentity) {
    selfIdentity.is_self = true
    selfIdentity.name = 'Tú'
  }
  return { identities, byAlias, resolve, selfId: selfIdentity?.id || asUserJid(conn.user?.jid || conn.user?.id) }
}

const downloadSticker = async (message) => {
  const sticker = unwrapMessage(message).stickerMessage
  if (!sticker) return null
  try {
    const stream = await downloadContentFromMessage(sticker, 'sticker')
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > 5_000_000) return null
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    if (!buffer.length) return null
    return `data:image/webp;base64,${buffer.toString('base64')}`
  } catch (error) {
    console.warn('[SCREENW] No se pudo descargar un sticker:', error?.message || error)
    return null
  }
}

const downloadImage = async (message) => {
  const image = unwrapMessage(message).imageMessage
  if (!image) return null
  try {
    const stream = await downloadContentFromMessage(image, 'image')
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > 8_000_000) return null
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    if (!buffer.length) return null
    const mimetype = /^image\/(jpeg|png|webp|gif)$/i.test(image.mimetype || '') ? image.mimetype : 'image/jpeg'
    return `data:${mimetype};base64,${buffer.toString('base64')}`
  } catch (error) {
    console.warn('[SCREENW] No se pudo descargar una imagen:', error?.message || error)
    return null
  }
}

const getStoredMessages = async (conn, chat, metadata, identities) => {
  const messages = Object.values(conn.chats?.[chat]?.messages || {})
    .filter(message => message?.key?.remoteJid === chat)
    .sort((a, b) => asTimestamp(a.messageTimestamp) - asTimestamp(b.messageTimestamp))
    .slice(-MAX_MESSAGES)
  const unique = new Map()
  for (const message of messages) {
    const senderCandidates = message.key.fromMe
      ? [conn.user?.jid, conn.user?.id, message.key.participant]
      : [message.key.senderPn, message.key.participantAlt, message.key.participant, message.participant]
    const matchedIdentity = senderCandidates.map(value => identities.resolve(value)).find(Boolean)
    const rawSender = senderCandidates.map(asUserJid).find(Boolean) || ''
    const sender = message.key.fromMe
      ? matchedIdentity?.id || asUserJid(conn.user?.jid || conn.user?.id) || rawSender
      : matchedIdentity?.id || rawSender
    const text = await getBody(message, identities, conn)
    const reply = await getReplyPreview(message, identities, conn)
    if (matchedIdentity && message.pushName && !/^\d+$/.test(String(message.pushName)) && /^\d+$/.test(matchedIdentity.name)) {
      matchedIdentity.name = String(message.pushName)
    }
    const sticker = await downloadSticker(message)
    const image = await downloadImage(message)
    const timestamp = asTimestamp(message.messageTimestamp)
    if (!sender || (!text && !sticker && !image) || !timestamp) continue
    const id = message.key?.id || `${sender}:${timestamp}:${text}`
    unique.set(id, {
      id: sender,
      sender,
      name: message.key.fromMe
        ? 'T\u00fa'
        : String(message.pushName && !/^\d+$/.test(String(message.pushName))
          ? message.pushName
          : conn.chats?.[sender]?.name && !/^\d+$/.test(String(conn.chats[sender].name))
            ? conn.chats[sender].name
            : matchedIdentity?.name || sender.split('@')[0] || 'Usuario'),
      text,
      reply,
      sticker,
      image,
      timestamp,
      is_self: Boolean(message.key.fromMe),
    })
  }
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_MESSAGES)
}

const getEmojiSequences = (messages) => {
  const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' })
  const emojiLike = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Presentation}]/u
  return [...new Set(messages.flatMap(message => [...segmenter.segment(message.text)]
    .map(part => part.segment)
    .filter(part => emojiLike.test(part))))]
}

const getAvatar = async (conn, jid) => {
  try {
    const url = await conn.profilePictureUrl(jid, 'image')
    const response = await fetch(url, { timeout: 5000 })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return null
    const bytes = await response.buffer()
    if (!bytes.length || bytes.length > 2_000_000) return null
    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

const react = async (conn, m, emoji) => {
  if (!m.key?.id) return
  await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => {})
}

const renderMedia = (payload) => new Promise((resolve, reject) => {
  const child = spawn(PYTHON, [PYTHON_SCRIPT], { cwd: FAKEWSP_DIR, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const stdout = []
  const stderr = []
  child.stdout.on('data', chunk => stdout.push(chunk))
  child.stderr.on('data', chunk => stderr.push(chunk))
  child.once('error', reject)
  child.once('close', code => {
    if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Renderer exited with code ${code}`))
    const media = Buffer.concat(stdout)
    if (!media.length) return reject(new Error('The renderer returned an empty file'))
    resolve(media)
  })
  child.stdin.end(JSON.stringify(payload))
})

const handler = async (m, { conn, groupMetadata, text = '' }) => {
  if (!String(m.chat || '').endsWith('@g.us')) {
    return conn.reply(m.chat, 'Este comando solo funciona en grupos.', m)
  }

  await react(conn, m, '\u23f3')
  try {
    const options = String(text).toLowerCase().split(/\s+/)
    const mode = options.includes('video') ? 'video' : 'img'
    const theme = options.some(option => option === 'dark' || option === 'oscuro') ? 'dark' : 'light'
    const metadata = groupMetadata || conn.chats?.[m.chat]?.metadata || await conn.groupMetadata(m.chat)
    const identities = await buildIdentityIndex(conn, metadata, m.chat)
    const messages = (await getStoredMessages(conn, m.chat, metadata, identities))
      .filter(message => !/^([.!#%])screenw(?:sp)?\b/i.test(message.text))
    if (!messages.length) {
      return conn.reply(m.chat, 'Todav\u00eda no tengo mensajes recientes de este grupo para recrear la pantalla.', m)
    }

    const participants = new Map()
    for (const message of messages) {
      participants.set(message.sender, { id: message.sender, name: message.name, is_self: message.is_self })
    }
    const selfJid = identities.selfId
    if (selfJid && !participants.has(selfJid)) {
      participants.set(selfJid, { id: selfJid, name: 'T\u00fa', is_self: true })
    }

    for (const participant of identities.identities.slice(0, 12)) {
      if (!participants.has(participant.id)) participants.set(participant.id, participant)
    }
    if ([...participants.values()].filter(participant => !participant.is_self).length < 2) {
      const fallback = identities.identities.find(participant => participant.id !== asUserJid(selfJid) && !participants.has(participant.id))
      if (fallback) {
        participants.set(fallback.id, fallback)
      }
    }

    const avatarJids = [...participants.keys()].filter(jid => jid !== asUserJid(selfJid)).slice(0, MAX_AVATARS)
    const avatars = Object.fromEntries(await Promise.all(avatarJids.map(async jid => [jid, await getAvatar(conn, jid)])))
    const result = await renderMedia({
      title: metadata.subject || conn.chats?.[m.chat]?.subject || 'Grupo',
      participants: [...participants.values()],
      messages,
      emoji_sequences: getEmojiSequences(messages),
      avatars,
      group_avatar: await getAvatar(conn, m.chat),
      generated_at: new Date().toISOString(),
      mode,
      theme,
    })

    const caption = `\u{1F4F1} Captura recreada de *${metadata.subject || 'este grupo'}* con sus \u00faltimos mensajes recibidos por el bot.`
    if (mode === 'video') {
      return await conn.sendMessage(m.chat, { video: result, mimetype: 'video/mp4', caption }, { quoted: m })
    }
    return await conn.sendMessage(m.chat, { image: result, caption }, { quoted: m })
  } catch (error) {
    console.error('[SCREENW] No se pudo recrear la pantalla del grupo:', error?.stack || error)
    return conn.reply(m.chat, `No pude recrear la vista de este grupo.\n> ${error?.message || error}`, m)
  } finally {
    await react(conn, m, '')
  }
}

handler.help = ['screenw img [dark|claro]', 'screenw video [dark|claro]']
handler.tags = ['fun']
handler.command = ['screenw', 'screenwsp']
handler.group = true

export default handler

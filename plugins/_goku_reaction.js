const handler = (m) => m

function extractText(value, seen = new WeakSet()) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'object') return ''
  if (typeof value.then === 'function') return ''
  if (seen.has(value)) return ''
  seen.add(value)

  const parts = []

  if (Array.isArray(value)) {
    for (const item of value) {
      const txt = extractText(item, seen)
      if (txt) parts.push(txt)
    }
    return parts.join(' ')
  }

  for (const [key, inner] of Object.entries(value)) {
    if (['contextInfo', 'message', 'key', 'participant', 'remoteJid', 'quoted', 'sender', 'status', 'thumbnail', 'mediaKey', 'fileSha256', 'directPath', 'mediaData', 'buffer', 'stream', 'mentionedJid', 'messageContextInfo'].includes(key)) continue

    if (typeof inner === 'string') {
      if (inner.trim()) parts.push(inner.trim())
      continue
    }

    if (inner && typeof inner === 'object') {
      const txt = extractText(inner, seen)
      if (txt) parts.push(txt)
    }
  }

  return parts.join(' ')
}

async function reactToMessage(m, conn) {
  try {
    if (typeof m?.react === 'function') {
      await m.react('❤️')
      return
    }
    if (conn && typeof conn.sendMessage === 'function' && m?.chat && m?.key) {
      await conn.sendMessage(m.chat, { react: { text: '❤️', key: m.key } })
    }
  } catch (_) {}
}

handler.before = async function (m, { conn }) {
  if (!m || m.fromMe) return true
  if (!m?.chat || m.chat === 'status@broadcast') return true

  const candidateSources = [
    m.text,
    m.caption,
    m.pushName,
    m?.message?.imageMessage?.caption,
    m?.message?.videoMessage?.caption,
    m?.message?.extendedTextMessage?.text,
    m?.msg?.caption,
    m?.msg?.text,
    m?.msg?.description,
    m?.msg?.title,
    m?.msg?.body,
    extractText(m.message),
    extractText(m.quoted),
    extractText(m?.message?.imageMessage || m?.message?.videoMessage || m?.message?.extendedTextMessage || null),
    extractText(m?.msg || null),
    extractText(m?.quoted?.message || null)
  ]

  const allText = candidateSources
    .filter((text) => typeof text === 'string' && text.trim())
    .join(' ')

  if (!allText) return true

  const normalized = allText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const hasGoku = /goku/.test(normalized)
  const hasDragon = /dragon\s*ball|dragonball/.test(normalized)
  const hasReclamar = /reclamar/.test(normalized)

  if (hasGoku && hasDragon && hasReclamar) {
    await reactToMessage(m, conn)
  }

  return true
}

export default handler

const normalizeChatJid = (jid) => String(jid || '').trim().toLowerCase()

export const findPreviousCachedMessage = (messageCache, chatJid, messageId) => {
  if (!(messageCache instanceof Map) || !chatJid || !messageId) return null
  const normalizedChat = normalizeChatJid(chatJid)
  const seen = new Set()
  const messages = []

  for (const cached of messageCache.values()) {
    const key = cached?.key || {}
    const id = key.id || cached?.id
    const chat = normalizeChatJid(key.remoteJid || cached?.chat || cached?.remoteJid)
    if (!id || chat !== normalizedChat) continue
    const identity = `${chat}:${id}`
    if (seen.has(identity)) continue
    seen.add(identity)
    messages.push(cached)
  }

  const targetIndex = messages.findIndex((cached) => (cached.key?.id || cached.id) === messageId)
  return targetIndex > 0 ? messages[targetIndex - 1] : null
}

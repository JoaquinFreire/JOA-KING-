import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const mediaTypes = ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage']

export function unwrapViewOnce(message) {
  const visit = (current, inheritedViewOnce = false, seen = new Set()) => {
    if (!current || typeof current !== 'object' || seen.has(current)) return null
    seen.add(current)
    const currentViewOnce = inheritedViewOnce || current.viewOnce === true
    for (const key of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage']) {
      const nested = current[key]?.message
      const result = visit(nested, currentViewOnce || key !== 'ephemeralMessage', seen)
      if (result) return result
    }
    const directType = mediaTypes.find((candidate) => current[candidate]?.viewOnce === true)
    if (directType) return { [directType]: current[directType] }
    const type = mediaTypes.find((candidate) => current[candidate])
    if (type && currentViewOnce) return current
    for (const value of Object.values(current)) {
      const result = visit(value, currentViewOnce, seen)
      if (result) return result
    }
    return null
  }
  return visit(message)
}

export function getViewOnceMedia(message) {
  const unwrapped = unwrapViewOnce(message)
  if (!unwrapped) return null
  const type = mediaTypes.find((candidate) => unwrapped[candidate])
  return type ? { type, media: unwrapped[type] } : null
}

export function getViewOnceMediaFromMessage(message) {
  for (const candidate of [message?.message, message?.msg, message?.vM?.message, message?.mediaMessage, message]) {
    const media = getViewOnceMedia(candidate)
    if (media) return media
  }
  return null
}

export async function downloadViewOnceMedia(media, type) {
  const stream = await downloadContentFromMessage(media, type.replace('Message', ''))
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

import assert from 'node:assert/strict'
import { findPreviousCachedMessage } from '../lib/cached-message-history.js'
import handler from '../plugins/tools-rev.js'

const group = '120363000000000001@g.us'
const otherGroup = '120363000000000002@g.us'
const previous = {
  key: { id: 'PREVIOUS', remoteJid: group },
  message: { stickerMessage: { mimetype: 'image/webp' } },
}
const marker = {
  key: { id: 'MARKER', remoteJid: group },
  message: { conversation: 'chau' },
}
const following = {
  key: { id: 'FOLLOWING', remoteJid: group },
  message: { conversation: '%rev' },
}
const unrelatedPrevious = {
  key: { id: 'OTHER-PREVIOUS', remoteJid: otherGroup },
  message: { conversation: 'mensaje de otro grupo' },
}
const history = new Map([
  [previous.key.id, previous],
  [`${group}:${previous.key.id}`, previous],
  [unrelatedPrevious.key.id, unrelatedPrevious],
  [`${otherGroup}:${unrelatedPrevious.key.id}`, unrelatedPrevious],
  [marker.key.id, marker],
  [`${group}:${marker.key.id}`, marker],
  [following.key.id, following],
  [`${group}:${following.key.id}`, following],
])

assert.equal(
  findPreviousCachedMessage(history, group, marker.key.id),
  previous,
  'debe hallar el mensaje anterior del mismo grupo y no contar entradas duplicadas del cache'
)
assert.equal(findPreviousCachedMessage(history, otherGroup, marker.key.id), null)
assert.equal(findPreviousCachedMessage(history, group, 'NOT-CACHED'), null)

let forwarded
const conn = {
  copyNForward: async (...args) => {
    forwarded = args
    return true
  },
  reply: async (_chat, text) => text,
}
global.__antideleteMessages = history
await handler({ chat: group, quoted: { id: marker.key.id } }, { conn })
assert.equal(forwarded[0], group)
assert.equal(forwarded[1], previous, 'debe reenviar el mensaje anterior original, incluidos sus medios')

const missingReply = await handler({ chat: group }, { conn })
assert.match(missingReply, /Responde con %rev/)

console.log('Pruebas de %rev aprobadas.')

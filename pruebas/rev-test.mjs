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
let sent
const conn = {
  copyNForward: async (...args) => {
    forwarded = args
    return true
  },
  downloadM: async (media, type) => {
    assert.equal(media.mimetype, type === 'image' ? 'image/jpeg' : 'video/mp4')
    return Buffer.from(`downloaded ${type}`)
  },
  sendMessage: async (...args) => {
    sent = args
    return true
  },
  reply: async (_chat, text) => text,
}
global.__antideleteMessages = history
await handler({ chat: group, quoted: { id: marker.key.id } }, { conn })
assert.equal(forwarded[0], group)
assert.equal(forwarded[1], previous, 'debe reenviar el mensaje anterior original, incluidos sus medios')

const image = {
  key: { id: 'IMAGE', remoteJid: group },
  message: { imageMessage: { url: 'https://example.com/image', mimetype: 'image/jpeg', caption: 'imagen guardada' } },
}
const imageMarker = {
  key: { id: 'IMAGE-MARKER', remoteJid: group },
  message: { conversation: 'marcador de imagen' },
}
const video = {
  key: { id: 'VIDEO', remoteJid: group },
  message: { ephemeralMessage: { message: { videoMessage: { url: 'https://example.com/video', mimetype: 'video/mp4', caption: 'video guardado', gifPlayback: true } } } },
}
const videoMarker = {
  key: { id: 'VIDEO-MARKER', remoteJid: group },
  message: { conversation: 'marcador de video' },
}
history.set(image.key.id, image)
history.set(`${group}:${image.key.id}`, image)
history.set(imageMarker.key.id, imageMarker)
history.set(`${group}:${imageMarker.key.id}`, imageMarker)
history.set(video.key.id, video)
history.set(`${group}:${video.key.id}`, video)
history.set(videoMarker.key.id, videoMarker)
history.set(`${group}:${videoMarker.key.id}`, videoMarker)

await handler({ chat: group, quoted: { id: imageMarker.key.id } }, { conn })
assert.deepEqual(sent[1].image, Buffer.from('downloaded image'))
assert.equal(sent[1].caption, 'imagen guardada', 'debe conservar el caption de la imagen')
await handler({ chat: group, quoted: { id: videoMarker.key.id } }, { conn })
assert.deepEqual(sent[1].video, Buffer.from('downloaded video'))
assert.equal(sent[1].caption, 'video guardado', 'debe conservar el caption del video')
assert.equal(sent[1].gifPlayback, true, 'debe conservar la reproducción GIF del video')

const missingReply = await handler({ chat: group }, { conn })
assert.match(missingReply, /Responde con %rev/)

console.log('Pruebas de %rev aprobadas.')

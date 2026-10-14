import assert from 'node:assert/strict'
import Jimp from 'jimp'
import { default as handler, renderGroupSnapshot } from '../plugins/tools-screenwsp.js'

const group = '120363000000000001@g.us'
const messages = Array.from({ length: 12 }, (_, index) => ({
  sender: `${5491111111111 + index}@s.whatsapp.net`,
  name: `Persona ${index + 1}`,
  text: `Mensaje ${index + 1}`,
  timestamp: 1_760_000_000 + index * 60,
  time: '12:34',
  colorIndex: index,
}))
const screenshot = await renderGroupSnapshot({
  title: 'Grupo de prueba',
  participantCount: 24,
  messages,
  now: new Date('2026-10-14T12:00:00.000Z'),
})
assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
const rendered = await Jimp.read(screenshot)
assert.equal(rendered.bitmap.width, 720)
assert.ok(rendered.bitmap.height >= 980)

const sent = []
const replies = []
const conn = {
  chats: {
    [group]: {
      subject: 'Grupo de prueba',
      metadata: { subject: 'Grupo de prueba', participants: Array.from({ length: 24 }, (_, index) => ({ id: `${index}@s.whatsapp.net` })) },
      messages: Object.fromEntries([
        ...messages.map((message, index) => [`MSG-${index}`, {
          key: { remoteJid: group, participant: message.sender, fromMe: false },
          pushName: message.name,
          messageTimestamp: message.timestamp,
          message: { conversation: message.text },
        }]),
        ['OUTGOING', {
          key: { remoteJid: group, participant: '5491111111111@s.whatsapp.net', fromMe: true },
          pushName: 'Bot',
          messageTimestamp: 1_760_001_020,
          message: { conversation: 'Respuesta reciente del bot' },
        }],
        ['CURRENT', {
          key: { remoteJid: group, participant: messages[0].sender, fromMe: false },
          messageTimestamp: 1_760_001_030,
          message: { conversation: '.screenwsp' },
        }],
      ]),
    },
  },
  groupMetadata: async () => ({ subject: 'Grupo de prueba', participants: Array(24).fill({}) }),
  sendMessage: async (chat, content, options) => sent.push({ chat, content, options }),
  reply: async (chat, text) => replies.push({ chat, text }),
}

await handler({
  chat: group,
  sender: messages[0].sender,
  id: 'CURRENT',
}, { conn, groupMetadata: conn.chats[group].metadata })
assert.equal(replies.length, 0)
assert.equal(sent.length, 1)
assert.equal(sent[0].chat, group, 'la vista debe enviarse al mismo grupo')
assert.ok(Buffer.isBuffer(sent[0].content.image))
assert.match(sent[0].content.caption, /últimos mensajes/)
assert.match(sent[0].content.caption, /recibió o envió el bot/)

await handler({ chat: '5491111111111@s.whatsapp.net', sender: messages[0].sender }, { conn })
assert.match(replies.at(-1).text, /solo funciona en grupos/)

console.log('Todos los tests de screenwsp pasaron')

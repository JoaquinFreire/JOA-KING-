import assert from 'node:assert/strict'
import ws from 'ws'

const { default: handler } = await import('../plugins/sockets-botlist.js')
const { default: serbotHandler } = await import('../plugins/sockets-serbot.js')
const primaryJid = '5493513117202@s.whatsapp.net'
const ownerJid = '5491111111111@s.whatsapp.net'
const subBotJid = '5491222222222@s.whatsapp.net'
const subBotLid = '998877665544332211@lid'
const messages = []
const primary = {
  user: { jid: primaryJid },
  ws: { socket: { readyState: ws.OPEN } },
  reply: async (chat, text) => messages.push({ chat, text }),
  sendMessage: async (chat, content) => messages.push({ chat, content }),
}
let logoutCount = 0
const subBot = {
  user: { jid: subBotJid },
  subBotOwnerJid: ownerJid,
  ws: { socket: { readyState: ws.OPEN } },
  logout: async () => { logoutCount += 1 },
}
global.conn = primary
global.conns = [subBot]
global.owner = ['5493513117202']

const message = (sender, mentionedJid = []) => ({
  chat: '120363000000000001@g.us',
  sender,
  mentionedJid,
})

await handler(message(ownerJid), {
  conn: primary,
  command: 'bots',
  text: '',
})
assert.match(messages.at(-1).content.text, /Total: \*2\*/)
assert.match(messages.at(-1).content.text, /Subbot: @5491222222222 · dueño: @5491111111111/)
assert.deepEqual(messages.at(-1).content.mentions, [primaryJid, subBotJid, ownerJid])

await handler(message('5493513117202@s.whatsapp.net', [subBotJid]), {
  conn: primary,
  command: 'disconnectbot',
  text: '@5491222222222',
  isOwner: true,
  usedPrefix: '%',
})
assert.equal(logoutCount, 1, 'el owner debe poder desconectar el subbot mencionado')
assert.equal(subBot.intentionalDisconnect, true)

const selfManagedSubBot = {
  ...subBot,
  user: { jid: subBotLid, id: subBotJid },
  reply: primary.reply,
  logout: async () => { logoutCount += 1 },
}
global.conns = [selfManagedSubBot]
await handler(message(ownerJid), {
  conn: primary,
  command: 'bots',
  text: '',
})
assert.match(messages.at(-1).content.text, /Subbot: @5491222222222 · dueño: @5491111111111/)
await handler(message('5493513117202@s.whatsapp.net', [subBotLid]), {
  conn: primary,
  command: 'disconnectbot',
  text: '@998877665544332211',
  isOwner: true,
  usedPrefix: '%',
  groupMetadata: {
    participants: [{
      id: '541222222222@s.whatsapp.net',
      jid: '541222222222@s.whatsapp.net',
      lid: subBotLid,
      phoneNumber: '541222222222',
    }],
  },
})
assert.equal(logoutCount, 2, 'el owner debe poder desconectar una mención LID resolviendo su número real')

await handler(message(ownerJid, ['112233445566778899@lid']), {
  conn: selfManagedSubBot,
  command: 'disconnectbot',
  text: '@112233445566778899',
  usedPrefix: '%',
})
assert.equal(logoutCount, 2, 'una mención que no se pudo resolver no debe desconectar el subbot propio')

await handler(message(ownerJid), {
  conn: selfManagedSubBot,
  command: 'disconnectbot',
  text: '',
  usedPrefix: '%',
})
assert.equal(logoutCount, 3, 'el dueño del subbot debe poder desconectarlo sin mención')

const codeReplies = []
await serbotHandler(message(ownerJid), {
  conn: { reply: async (chat, text) => codeReplies.push({ chat, text }) },
  args: [],
  text: '',
  usedPrefix: '%',
  command: 'code',
})
assert.match(codeReplies.at(-1).text, /Uso: %code \+549XXXXXXXXXX/)

console.log('Todos los tests de bots y desconexión pasaron')

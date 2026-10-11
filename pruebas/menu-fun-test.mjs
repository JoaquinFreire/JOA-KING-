import assert from 'node:assert/strict'

global.botname = 'JOA-KING'
global.db = { data: { users: {} } }
global.plugins = {}
global.conn = { user: { jid: '5493513117202@s.whatsapp.net' } }

const { default: menuHandler } = await import('../plugins/main-menu.js')
const { default: funHandler } = await import('../plugins/fun-fun.js')
const menuMessages = []
const menuConnection = {
  user: global.conn.user,
  sendMessage: async (chat, content) => menuMessages.push({ chat, content }),
  reply: async (chat, text) => menuMessages.push({ chat, text }),
}
const menuMessage = {
  chat: '120363000000000001@g.us',
  sender: '5491111111111@s.whatsapp.net',
  mentionedJid: [],
}

await menuHandler(menuMessage, {
  conn: menuConnection,
  args: ['descargar'],
  usedPrefix: '%',
})
assert.match(menuMessages.at(-1).content.text, /Comandos de \*Descargas\*/)
assert.doesNotMatch(menuMessages.at(-1).content.text, /SOCKETS/)

await menuHandler(menuMessage, {
  conn: menuConnection,
  args: ['mudae'],
  usedPrefix: '%',
})
assert.match(menuMessages.at(-1).content.text, /Coleccioná personajes/)
assert.match(menuMessages.at(-1).content.text, /%albumespj/)
assert.match(menuMessages.at(-1).content.text, /%pjs/)

const funMessages = []
const funConnection = {
  reply: async (chat, text) => funMessages.push({ chat, text }),
  sendMessage: async (chat, content) => funMessages.push({ chat, content }),
  parseMention: () => [],
}
const funMessage = { chat: menuMessage.chat, sender: menuMessage.sender }
const runFun = (command, text = '', args = [], participants = []) => funHandler(funMessage, {
  conn: funConnection,
  command,
  text,
  args,
  usedPrefix: '%',
  groupMetadata: { participants },
})

await runFun('pregunta', '¿me va a salir bien?')
assert.match(funMessages.at(-1).text, /CONSULTA AL ORÁCULO/)
assert.match(funMessages.at(-1).text, /¿me va a salir bien\?/)
assert.match(funMessages.at(-1).text, /sí|no|capaz|chance|veredicto/i)

global.db.data.users = {
  '5491111111111@s.whatsapp.net': { genre: 'Hombre' },
  '5491222222222@s.whatsapp.net': { genre: 'Mujer' },
  '5491333333333@s.whatsapp.net': { genre: 'Hombre' },
  '5491444444444@s.whatsapp.net': { genre: 'Mujer' },
}
const participants = Object.keys(global.db.data.users).map((id) => ({ id }))
await runFun('formarpnormal', '', [], participants)
assert.equal(funMessages.at(-1).content.mentions.length, 2)
assert.ok(funMessages.at(-1).content.mentions.some((jid) => global.db.data.users[jid].genre === 'Hombre'))
assert.ok(funMessages.at(-1).content.mentions.some((jid) => global.db.data.users[jid].genre === 'Mujer'))
await runFun('formarpgay', '', [], participants)
assert.ok(funMessages.at(-1).content.mentions.every((jid) => global.db.data.users[jid].genre === 'Hombre'))
await runFun('formarplesbi', '', [], participants)
assert.ok(funMessages.at(-1).content.mentions.every((jid) => global.db.data.users[jid].genre === 'Mujer'))

console.log('Todos los tests de menú y comandos divertidos pasaron')

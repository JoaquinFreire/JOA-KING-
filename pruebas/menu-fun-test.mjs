import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Jimp from 'jimp'

global.botname = 'JOA-KING'
global.db = { data: { users: {} } }
global.plugins = {}
global.conn = { user: { jid: '5493513117202@s.whatsapp.net' } }

const { default: menuHandler } = await import('../plugins/main-menu.js')
const { default: ownerHandler } = await import('../plugins/main-owner.js')
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

await menuHandler(menuMessage, {
  conn: menuConnection,
  args: ['fun'],
  usedPrefix: '%',
})
assert.match(menuMessages.at(-1).content.text, /\.screenwsp/)
assert.match(menuMessages.at(-1).content.text, /%manco/)
assert.match(menuMessages.at(-1).content.text, /%homofobico/)
assert.match(menuMessages.at(-1).content.text, /%gay2/)

await menuHandler(menuMessage, {
  conn: menuConnection,
  args: ['tools'],
  usedPrefix: '%',
})
assert.match(menuMessages.at(-1).content.text, /%translate/)
assert.doesNotMatch(menuMessages.at(-1).content.text, /PAREJAS AL AZAR/)
assert.match(menuMessages.at(-1).content.text, /%fakemsg2/)
assert.match(menuMessages.at(-1).content.text, /%owner/)
assert.match(menuMessages.at(-1).content.text, /\.fms/)

await ownerHandler(menuMessage, { conn: menuConnection })
const ownerContact = menuMessages.at(-1).content.contacts
assert.equal(ownerContact.displayName, 'Joako Freire')
assert.match(ownerContact.contacts[0].vcard, /waid=5493513117202:\+5493513117202/)
assert.match(ownerContact.contacts[0].vcard, /joako_freire/)

const funMessages = []
const funConnection = {
  reply: async (chat, text) => funMessages.push({ chat, text }),
  sendMessage: async (chat, content) => funMessages.push({ chat, content }),
  parseMention: () => [],
  profilePictureUrl: async () => profileImagePath,
}
const profileImagePath = path.join(os.tmpdir(), `joa-king-gay2-test-${process.pid}.png`)
await fs.writeFile(profileImagePath, await (await Jimp.create(32, 32, 0xffffffff)).getBufferAsync(Jimp.MIME_PNG))
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
await runFun('preguntar', '¿sale el plan?')
assert.match(funMessages.at(-1).text, /¿sale el plan\?/)
const percentageCommands = [
  'manco', 'manca', 'gay', 'gato', 'infiel', 'perra', 'tonto', 'puto', 'puta',
  'malapersona', 'homofobico', 'inteligente', 'amable', 'buitre', 'colafacil',
  'cornudo', 'cornuda', 'simp', 'tatiana', 'pajero', 'pajera', 'antipala',
  'peronista', 'pernonista', 'lesbiana', 'rata', 'prostituto', 'prostituta',
  'vago', 'intenso', 'chismoso', 'dormilon', 'fantasma', 'despistado', 'otaku',
  'gracioso', 'toxico', 'dramatico',
]
for (const command of ['pregunta', 'preguntar', 'formarpnormal', 'formarpgay', 'formarplesbi', 'gay2', ...percentageCommands]) {
  assert.ok(funHandler.command.includes(command), `${command} debe estar registrado como comando`)
}
assert.ok(funHandler.command.every((command) => !command.includes(' ')), 'los patrones de uso no deben registrarse como comandos')

const originalRandom = Math.random
Math.random = () => 0
try {
  await runFun('manco')
} finally {
  Math.random = originalRandom
}
assert.match(funMessages.at(-1).content.text, /TEST DE MANCO/)
assert.match(funMessages.at(-1).content.text, /\*1%\*/, 'el porcentaje mínimo debe ser 1')
assert.deepEqual(funMessages.at(-1).content.mentions, [funMessage.sender], 'el comando debe calcular el porcentaje de quien lo usa sin mención')
for (const command of percentageCommands) {
  await runFun(command)
  assert.doesNotMatch(funMessages.at(-1).content.text, /\n\n>/, `${command} no debe incluir frases adicionales al resultado`)
}
Math.random = () => 0
try {
  await runFun('lesbiana')
} finally {
  Math.random = originalRandom
}
assert.match(funMessages.at(-1).content.text, /\*1%\*/)
assert.doesNotMatch(funMessages.at(-1).content.text, /radar sáfico|playlist romántica|estrellas dicen/)

funMessage.mentionedJid = ['5491222222222@s.whatsapp.net']
Math.random = () => 0.999999
try {
  await runFun('gato', '@5491222222222')
} finally {
  Math.random = originalRandom
  delete funMessage.mentionedJid
}
assert.match(funMessages.at(-1).content.text, /TEST DE GATO/)
assert.match(funMessages.at(-1).content.text, /\*100%\*/, 'el porcentaje máximo debe ser 100')
assert.deepEqual(funMessages.at(-1).content.mentions, ['5491222222222@s.whatsapp.net'], 'el comando debe admitir calcular el porcentaje de una persona mencionada')

funMessage.mentionedJid = ['5491222222222@s.whatsapp.net']
await runFun('gay2', '@5491222222222')
delete funMessage.mentionedJid
assert.match(funMessages.at(-1).content.caption, /Les presento a este gay/)
assert.deepEqual(funMessages.at(-1).content.mentions, ['5491222222222@s.whatsapp.net'])
const processedProfile = await Jimp.read(funMessages.at(-1).content.image)
assert.equal(processedProfile.bitmap.width, 32)
assert.equal(processedProfile.bitmap.height, 32)
assert.notEqual(processedProfile.getPixelColor(16, 2), 0xffffffff, 'la foto debe llevar encima la capa arcoíris')
await fs.rm(profileImagePath, { force: true })

global.db.data.users = {
  '5491111111111@s.whatsapp.net': { genre: 'Hombre' },
  '5491222222222@s.whatsapp.net': { genre: 'Mujer' },
  '5491333333333@s.whatsapp.net': { genre: 'Hombre' },
  '5491444444444@s.whatsapp.net': { genre: 'Mujer' },
}
const participants = Object.keys(global.db.data.users).map((id) => ({ id }))
await runFun('formarpnormal', '', [], participants)
assert.equal(funMessages.at(-1).content.mentions.length, 2)
assert.match(funMessages.at(-1).content.text, /La mejor pareja del grupo/)
assert.ok(funMessages.at(-1).content.mentions.some((jid) => global.db.data.users[jid].genre === 'Hombre'))
assert.ok(funMessages.at(-1).content.mentions.some((jid) => global.db.data.users[jid].genre === 'Mujer'))
await runFun('formarpnormal', '', ['8'], participants)
assert.equal(funMessages.at(-1).content.mentions.length, 4, 'debe formar todas las parejas posibles aunque sean menos que las pedidas')
assert.match(funMessages.at(-1).content.text, /Se formaron 2/)
await runFun('formargay', '', ['5'], participants)
assert.equal(funMessages.at(-1).content.mentions.length, 2, 'el alias gay debe formar hasta donde alcance')
assert.ok(funMessages.at(-1).content.mentions.every((jid) => global.db.data.users[jid].genre === 'Hombre'))
await runFun('formarplesbi', '', [], participants)
assert.ok(funMessages.at(-1).content.mentions.every((jid) => global.db.data.users[jid].genre === 'Mujer'))

console.log('Todos los tests de menú y comandos divertidos pasaron')

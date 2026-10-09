import assert from 'node:assert/strict'

const sender = '5491111111111@s.whatsapp.net'
const spouse = '5491222222222@s.whatsapp.net'
const unassigned = '5491333333333@s.whatsapp.net'
const owner = '5493513117202@s.whatsapp.net'
global.owner = ['5493513117202']
global.db = {
  data: {
    users: {
      [sender]: { name: 'Alice', genre: '' },
      [spouse]: { name: 'Bob', genre: '' },
      [unassigned]: { name: 'Charlie', genre: '' },
    },
  },
  writes: 0,
  async write() {
    this.writes += 1
  },
}

const { default: misexoHandler } = await import('../plugins/profile-misex.js')
const { default: marryHandler } = await import('../plugins/profile-marry.js')
const replies = []
const conn = {
  async reply(chat, text) {
    replies.push({ chat, text })
    return text
  },
}
const message = (user, mentionedJid = []) => ({
  chat: '120363000000000001@g.us',
  sender: user,
  pushName: global.db.data.users[user]?.name,
  isGroup: true,
  mentionedJid,
})
const runMisexo = (user, text, mentionedJid, isOwner = false) => misexoHandler(message(user, mentionedJid), {
  conn,
  text,
  usedPrefix: '%',
  isOwner,
})
const runMarry = (user, target) => marryHandler(message(user, target ? [target] : []), {
  conn,
  command: 'marry',
  text: target ? `@${target.split('@')[0]}` : '',
  usedPrefix: '%',
})

await runMisexo(sender, 'hombre')
assert.equal(global.db.data.users[sender].genre, 'Hombre', 'las personas deben poder elegir un sexo inicialmente')
await runMisexo(sender, 'mujer')
assert.equal(global.db.data.users[sender].genre, 'Hombre', 'una persona no puede cambiar su selección')
assert.match(replies.at(-1).text, /no se puede cambiar/i)
await runMisexo(sender, 'mujer', [spouse])
assert.equal(global.db.data.users[spouse].genre, '', 'una persona no puede cambiar el sexo de otra')
await runMisexo(owner, `@${spouse.split('@')[0]} mujer`, [spouse], true)
assert.equal(global.db.data.users[spouse].genre, 'Mujer', 'el owner puede registrar el sexo de otra persona')
await runMisexo(owner, `@${spouse.split('@')[0]} hombre`, [spouse], true)
assert.equal(global.db.data.users[spouse].genre, 'Hombre', 'el owner puede corregir el sexo ya asignado')
await runMisexo(owner, `@${unassigned.split('@')[0]} mujer`, [unassigned], true)
assert.equal(global.db.data.users[unassigned].genre, 'Mujer', 'el owner puede asignar un sexo que todavía no existe')
await runMisexo(owner, 'mujer', [], true)
await runMisexo(owner, 'hombre', [], true)
assert.equal(global.db.data.users[owner].genre, 'Mujer', 'el owner también debe mencionar al usuario para cambiar un valor asignado')

await runMarry(sender, spouse)
assert.match(replies.at(-1).text, /propuso matrimonio/i)
await runMarry(spouse, sender)
assert.equal(global.db.data.users[sender].marry, spouse, 'la aceptación debe vincular a ambos usuarios')
assert.equal(global.db.data.users[spouse].marry, sender, 'la pareja debe tener el vínculo recíproco')
assert.match(replies.at(-1).text, /se han casado/i)

await marryHandler(message(sender), { conn, command: 'divorce', text: '', usedPrefix: '%' })
assert.equal(global.db.data.users[sender].marry, '', 'divorce debe limpiar el vínculo de quien lo ejecuta')
assert.equal(global.db.data.users[spouse].marry, '', 'divorce debe limpiar también el vínculo de la pareja')
assert.match(replies.at(-1).text, /se han divorciado/i)

await marryHandler(message(sender), { conn, command: 'divorce', text: '', usedPrefix: '%' })
assert.match(replies.at(-1).text, /no estás casado/i, 'divorce debe informar cuando no hay pareja')

console.log('Todos los tests de perfil pasaron')

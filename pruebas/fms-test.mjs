import assert from 'node:assert/strict'
import axios from 'axios'
import Jimp from 'jimp'
import handler, { createQuotePayload } from '../plugins/tools-fms.js'

global.db = { data: { users: {} } }
global.support = { ffmpeg: false }
global.packsticker = 'Test'
global.packsticker2 = 'JOA-KING'

const payload = createQuotePayload({
  name: 'Persona citada',
  avatarUrl: 'https://example.com/avatar.jpg',
  text: 'Hola mundo',
})
assert.equal(payload.type, 'quote')
assert.equal(payload.format, 'png')
assert.equal(payload.messages[0].from.name, 'Persona citada')
assert.equal(payload.messages[0].from.photo.url, 'https://example.com/avatar.jpg')
assert.equal(payload.messages[0].text, 'Hola mundo')

const generatedPng = await (await Jimp.create(128, 128, '#ffffff')).getBufferAsync(Jimp.MIME_PNG)
const originalPost = axios.post
const apiCalls = []
axios.post = async (url, data, options) => {
  apiCalls.push({ url, data, options })
  return { data: { result: { image: generatedPng.toString('base64') } } }
}

const sent = []
const replies = []
const profileLookups = []
const conn = {
  sendMessage: async (chat, content, options) => sent.push({ chat, content, options }),
  reply: async (chat, text) => replies.push({ chat, text }),
  getName: async (jid) => jid.split('@')[0],
  profilePictureUrl: async (jid) => {
    profileLookups.push(jid)
    return `https://example.com/${jid.split('@')[0]}.jpg`
  },
}

try {
  const message = {
    chat: '120363000000000001@g.us',
    sender: '5491111111111@s.whatsapp.net',
    pushName: 'Nombre propio',
  }

  await handler(message, { conn, text: 'Hola mundo', args: ['Hola', 'mundo'] })
  assert.equal(sent.length, 1)
  assert.equal(Object.keys(sent[0].content).join(','), 'sticker', 'debe responder únicamente con un sticker')
  assert.equal(sent[0].content.sticker.subarray(0, 4).toString(), 'RIFF')
  assert.equal(sent[0].content.sticker.subarray(8, 12).toString(), 'WEBP')
  assert.equal(apiCalls.at(-1).data.messages[0].text, 'Hola mundo')
  assert.equal(apiCalls.at(-1).data.messages[0].from.name, 'Nombre propio')
  assert.deepEqual(profileLookups, [message.sender], 'sin cita debe tomar la identidad del usuario que ejecutó el comando')

  message.quoted = {
    sender: '5491222222222@s.whatsapp.net',
    pushName: 'Persona citada',
    text: 'Texto citado original',
  }
  await handler(message, { conn, text: 'Mensaje nuevo', args: ['Mensaje', 'nuevo'] })
  assert.equal(sent.length, 2)
  assert.equal(apiCalls.at(-1).data.messages[0].text, 'Mensaje nuevo', 'el texto escrito debe reemplazar el texto citado')
  assert.equal(apiCalls.at(-1).data.messages[0].from.name, 'Persona citada')
  assert.equal(profileLookups.at(-1), '5491222222222@s.whatsapp.net', 'al responder debe usar la identidad citada')

  await handler(message, { conn, text: '', args: [] })
  assert.equal(apiCalls.at(-1).data.messages[0].text, 'Texto citado original', 'sin texto nuevo debe usar el texto citado')
  assert.equal(profileLookups.at(-1), '5491222222222@s.whatsapp.net')

  await handler({ chat: message.chat, sender: message.sender, pushName: message.pushName }, { conn, text: '', args: [] })
  assert.equal(apiCalls.at(-1).data.messages[0].text, 'HOLA', 'sin cita ni texto debe crear el sticker con HOLA')
  assert.equal(replies.length, 0)

  await handler(message, { conn, text: 'Este texto supera el límite permitido de treinta caracteres.', args: ['Este', 'texto', 'supera', 'el', 'límite', 'permitido', 'de', 'treinta', 'caracteres.'] })
  assert.equal(apiCalls.length, 4, 'no debe llamar a la API para textos demasiado largos')
  assert.match(replies.at(-1).text, /30 caracteres/)
} finally {
  axios.post = originalPost
}

console.log('Todos los tests de fms pasaron')

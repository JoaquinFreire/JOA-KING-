import assert from 'node:assert/strict'

global.db = {
  data: {
    users: { 'user@s.whatsapp.net': { commands: 3 } },
    chats: { 'group@g.us': {} },
    settings: {},
  },
  write: async () => {},
}
global.plugins = { example: { help: ['test'], tags: ['test'] } }
global.conns = [{ user: { jid: 'bot@s.whatsapp.net' }, ws: { socket: { readyState: 1 } } }]

const { default: statusHandler } = await import('../plugins/main-status.js')
let statusReply = ''
await statusHandler({ chat: 'chat@s.whatsapp.net' }, {
  conn: {
    reply: async (_chat, text) => {
      statusReply = text
    },
  },
})
assert.match(statusReply, /Estado del Sistema/)
assert.match(statusReply, /Comandos ejecutados.*3/)

global.owner = []
global.__antideleteMessages = new Map()
const { default: captureHandler, formatViewOnceCaption } = await import('../plugins/tools-activarunavez.js')
const { getViewOnceMediaFromOwnMessage } = await import('../lib/viewonce.js')
const {
  getViewOnceMediaKey,
  hasAlreadySentViewOnce,
  rememberSentViewOnce,
} = await import('../plugins/tools-activarunavez.js')
const expectedDate = new Date(1_704_164_645_000).toLocaleString('es-AR')
assert.equal(
  formatViewOnceCaption('5491111111111@s.whatsapp.net', 'Grupo de prueba', 1_704_164_645),
  `Tag: @5491111111111\nChat: Grupo de prueba\nFecha: ${expectedDate}`,
  'la notificación debe contener solo tag, nombre del chat y fecha'
)
const groupJid = '120363000000000099@g.us'
const originalMessageId = 'VIEW-ONCE-DELETE-ONCE'
const originalViewOnce = {
  viewOnceMessageV2: {
    message: { imageMessage: { viewOnce: true, mimetype: 'image/jpeg' } },
  },
}
assert.ok(getViewOnceMediaFromOwnMessage(originalViewOnce), 'debe detectar el view-once enviado directamente')
assert.equal(
  getViewOnceMediaFromOwnMessage({
    extendedTextMessage: { contextInfo: { quotedMessage: originalViewOnce } },
  }),
  null,
  'responder a una foto view-once no debe volver a contarla como un medio nuevo'
)
const stableMediaKey = getViewOnceMediaKey({
  key: { id: originalMessageId, remoteJid: groupJid },
}, null)
assert.equal(stableMediaKey, `${groupJid}:${originalMessageId}`)
const botJid = 'bot@s.whatsapp.net'
global.db.data.settings[botJid] = {}
const ledgerConnection = { user: { jid: botJid } }
assert.equal(hasAlreadySentViewOnce(ledgerConnection, stableMediaKey), false)
await rememberSentViewOnce(ledgerConnection, stableMediaKey)
assert.equal(hasAlreadySentViewOnce(ledgerConnection, stableMediaKey), true, 'el ID enviado debe quedar registrado en la base persistente')
global.__antideleteMessages.set(`${groupJid}:${originalMessageId}`, {
  key: {
    id: originalMessageId,
    remoteJid: groupJid,
    participant: '5491111111111@s.whatsapp.net',
  },
  message: {
    ...originalViewOnce,
  },
  messageTimestamp: 1_704_164_645,
})

let groupMetadataCalls = 0
let sentMessages = 0
const conn = {
  user: { jid: botJid },
  decodeJid: (jid) => jid,
  groupMetadata: async () => {
    groupMetadataCalls += 1
    return {
      subject: 'Grupo de prueba',
      participants: [{ id: '5491111111111@s.whatsapp.net', phoneNumber: '5491111111111@s.whatsapp.net' }],
    }
  },
  sendMessage: async () => {
    sentMessages += 1
  },
}
const deletedMessage = {
  chat: groupJid,
  sender: '5491111111111@s.whatsapp.net',
  mtype: 'protocolMessage',
  message: {
    protocolMessage: {
      key: { id: originalMessageId, remoteJid: groupJid, participant: '5491111111111@s.whatsapp.net' },
    },
  },
}
const chat = { captureViewOnce: true }
await captureHandler.all.call(conn, deletedMessage, { chat })
await captureHandler.all.call(conn, deletedMessage, { chat })
const repeatedQuoteMessage = {
  chat: groupJid,
  key: { id: 'REPLY-TO-VIEW-ONCE', remoteJid: groupJid, participant: '5491111111111@s.whatsapp.net' },
  message: {
    extendedTextMessage: {
      text: 'respondo a la foto',
      contextInfo: { stanzaId: originalMessageId, quotedMessage: originalViewOnce },
    },
  },
}
await captureHandler.all.call(conn, repeatedQuoteMessage, { chat })
assert.equal(groupMetadataCalls, 0, 'el registro persistente evita procesar de nuevo un view-once ya enviado')
assert.equal(sentMessages, 0, 'no debe enviar nada si no se pudo resolver un destino privado')

console.log('Pruebas de regresión aprobadas.')

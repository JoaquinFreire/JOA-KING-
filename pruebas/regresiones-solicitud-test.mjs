import assert from 'node:assert/strict'
import Jimp from 'jimp'
import { beginCommandExecution } from '../lib/command-execution.js'

const guardedMessage = { chat: 'chat@s.whatsapp.net', key: { id: 'DUPLICATE-COMMAND' } }
const firstExecution = beginCommandExecution(guardedMessage, 'hd')
assert.ok(firstExecution, 'el primer intento debe adquirir el bloqueo')
assert.equal(beginCommandExecution(guardedMessage, 'hd'), null, 'un segundo intento simultáneo del mismo mensaje debe ignorarse')
firstExecution.finish()
assert.equal(beginCommandExecution(guardedMessage, 'hd'), null, 'un mensaje repetido tras terminar también debe ignorarse')
assert.ok(beginCommandExecution(guardedMessage, 'read'), 'el mismo mensaje puede ejecutar otro comando distinto')
assert.ok(beginCommandExecution({ chat: guardedMessage.chat, key: { id: 'NEW-MESSAGE' } }, 'hd'), 'un mensaje nuevo debe poder ejecutar el comando')

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
const { default: captureHandler, formatViewOnceCaption, resolveOwnerJids, sendToOwner } = await import('../plugins/tools-activarunavez.js')
const { responseToImageBuffer, enhanceImageLocally } = await import('../plugins/tools-hd.js')
const { getViewOnceMediaFromOwnMessage } = await import('../lib/viewonce.js')
const {
  getViewOnceMediaKey,
  getQuotedViewOnceSource,
  hasAlreadySentViewOnce,
  rememberSentViewOnce,
} = await import('../plugins/tools-activarunavez.js')
global.owner = ['5493513117202']
assert.deepEqual(await resolveOwnerJids(), ['5493513117202@s.whatsapp.net'], 'el destino owner debe usar el número configurado sin depender de onWhatsApp')
global.ownerLids = ['114864672526580']
const ownerRouteAttempts = []
await sendToOwner({
  sendMessage: async (jid) => {
    ownerRouteAttempts.push(jid)
    if (jid.endsWith('@s.whatsapp.net')) throw new Error('PN no disponible')
    return { key: { id: 'OWNER-FALLBACK-SENT' } }
  },
}, '5493513117202@s.whatsapp.net', { image: Buffer.from('x') }, {})
assert.deepEqual(ownerRouteAttempts, ['5493513117202@s.whatsapp.net', '114864672526580@lid'], 'si falla el número, debe intentar el LID configurado del owner')
global.ownerLids = []
global.owner = []
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
const quotedViewOnce = getQuotedViewOnceSource({
  chat: groupJid,
  sender: '5491222222222@s.whatsapp.net',
  message: {
    extendedTextMessage: {
      contextInfo: {
        stanzaId: originalMessageId,
        participant: '5491111111111@s.whatsapp.net',
        quotedMessage: originalViewOnce,
      },
    },
  },
})
assert.equal(quotedViewOnce?.media.type, 'imageMessage', 'al responder a una imagen view-once debe recuperar el medio citado')
assert.equal(quotedViewOnce?.sourceMessage.key.id, originalMessageId, 'la captura citada debe deduplicarse con el ID original')
const imageBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
assert.deepEqual(
  await responseToImageBuffer({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => imageBytes.buffer,
  }),
  Buffer.from(imageBytes),
  'el mejorador debe aceptar directamente una respuesta binaria de imagen'
)
const localHdImage = await Jimp.create(24, 16, 0xff555555)
const localHdInput = await localHdImage.getBufferAsync(Jimp.MIME_PNG)
const localHdOutput = await Jimp.read(await enhanceImageLocally(localHdInput))
assert.equal(localHdOutput.bitmap.width, 48, 'la mejora local debe duplicar la resolución horizontal')
assert.equal(localHdOutput.bitmap.height, 32, 'la mejora local debe duplicar la resolución vertical')

const toggleChat = { captureViewOnce: false }
await captureHandler({ chat: groupJid }, {
  conn: { user: { jid: 'bot@s.whatsapp.net' }, reply: async () => {} },
  command: 'on',
  text: 'unavez',
  chat: toggleChat,
  isOwner: true,
})
assert.equal(toggleChat.captureViewOnce, true, 'on unavez debe activar la captura automática')
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

const retriableMessageId = 'VIEW-ONCE-RETRY'
global.db.data.settings[botJid].captureViewOnceTarget = 'owner'
const retriableDeleteMessage = {
  chat: groupJid,
  sender: '5491111111111@s.whatsapp.net',
  mtype: 'protocolMessage',
  message: {
    protocolMessage: {
      key: { id: retriableMessageId, remoteJid: groupJid, participant: '5491111111111@s.whatsapp.net' },
    },
  },
}
await captureHandler.all.call(conn, retriableDeleteMessage, { chat })
global.__antideleteMessages.set(`${groupJid}:${retriableMessageId}`, {
  key: {
    id: retriableMessageId,
    remoteJid: groupJid,
    participant: '5491111111111@s.whatsapp.net',
  },
  message: { ...originalViewOnce },
  messageTimestamp: 1_704_164_645,
})
await captureHandler.all.call(conn, retriableDeleteMessage, { chat })
assert.equal(groupMetadataCalls, 1, 'un primer aviso sin el original no debe impedir procesar un reintento que ya puede recuperar la imagen')
assert.equal(sentMessages, 0, 'no debe enviar la imagen cuando no hay un destino privado resoluble')

console.log('Pruebas de regresión aprobadas.')

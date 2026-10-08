// Test offline de plugins/tools-fakemsg2.js
// Ejecutar: node pruebas/fakemsg2-test.mjs
import assert from 'node:assert'
import handler from '../plugins/tools-fakemsg2.js'

async function runCase({ m, text = 'mensaje inventado', connOverrides = {}, permissions = {} }) {
  const relays = []
  const sends = []
  const replies = []
  const reactions = []
  let generated = 0
  const conn = {
    relayMessage: async (jid, message, opts = {}) => {
      const id = opts.messageId || `TEMP${++generated}`
      relays.push({ jid, message, opts, id })
      return id
    },
    sendMessage: async (jid, content, opts) => sends.push({ jid, content, opts }),
    reply: async (jid, message) => replies.push({ jid, message }),
    ...connOverrides,
  }
  const fakeM = { react: async (emoji) => reactions.push(emoji), ...m }
  await handler(fakeM, { conn, text, usedPrefix: '%', command: 'fakemsg2', ...permissions })
  return { relays, sends, replies, reactions }
}

{
  const { relays, sends, replies, reactions } = await runCase({
    m: {
      chat: '120363000000000000@g.us',
      isGroup: true,
      msg: { contextInfo: { stanzaId: 'MSG1' } },
      quoted: {
        id: 'MSG1',
        sender: '5491122223333@s.whatsapp.net',
        message: { extendedTextMessage: { text: 'texto original' } },
      },
    },
    permissions: { isAdmin: true },
  })

  assert.strictEqual(replies.length, 0, 'no debe responder error')
  assert.strictEqual(relays.length, 2, 'debe enviar temporal y protocolMessage edit')
  assert.strictEqual(sends.length, 2, 'debe intentar borrar ambos mensajes temporales')

  assert.deepStrictEqual(relays[0].message, {
    extendedTextMessage: {
      text: '',
      contextInfo: {
        isGroupStatus: true,
      },
    },
  }, 'el primer relay debe ser el temporal oculto')

  const protocol = relays[1].message.protocolMessage
  assert.ok(protocol, 'el segundo relay debe ser protocolMessage')
  assert.strictEqual(protocol.key.id, 'TEMP1', 'la edicion debe apuntar al temporal')
  assert.strictEqual(protocol.key.fromMe, true, 'la key editada debe ser fromMe')
  assert.strictEqual(protocol.type, 14, 'debe usar MESSAGE_EDIT')
  assert.strictEqual(protocol.editedMessage.extendedTextMessage.text, 'mensaje inventado', 'debe llevar el texto nuevo')
  assert.strictEqual(protocol.editedMessage.extendedTextMessage.contextInfo.isGroupStatus, false, 'debe quitar group status en la edicion')
  assert.strictEqual(relays[1].opts.messageId, 'MSG1', 'el stanza del protocolMessage debe reutilizar el id citado')

  assert.deepStrictEqual(sends.map((send) => send.content.delete.id), ['TEMP1', 'MSG1'], 'debe limpiar temporal y relay de edicion')
  assert.ok(reactions.includes('\u2705'), 'debe reaccionar ok')
}

{
  const { relays, sends, replies } = await runCase({
    m: {
      chat: '120363000000000000@g.us',
      isGroup: true,
      msg: { contextInfo: { stanzaId: 'MSG-UNAUTHORIZED' } },
      quoted: { id: 'MSG-UNAUTHORIZED' },
    },
  })
  assert.strictEqual(relays.length, 0, 'miembros comunes no deben ejecutar fakemsg2')
  assert.strictEqual(sends.length, 0, 'miembros comunes no deben enviar mensajes')
  assert.match(replies[0].message, /administradores del grupo o el owner/)
}

{
  const { relays, replies } = await runCase({
    m: {
      chat: '120363000000000000@g.us',
      isGroup: true,
      msg: { contextInfo: { stanzaId: 'MSG-OWNER' } },
      quoted: { id: 'MSG-OWNER' },
    },
    permissions: { isOwner: true },
  })
  assert.strictEqual(relays.length, 2, 'el owner mantiene acceso')
  assert.strictEqual(replies.length, 0)
}

{
  const { relays, sends, replies } = await runCase({
    m: { chat: 'x@s.whatsapp.net', isGroup: false, quoted: null },
  })
  assert.strictEqual(relays.length, 0, 'sin cita no debe relayer')
  assert.strictEqual(sends.length, 0, 'sin cita no debe enviar')
  assert.strictEqual(replies.length, 1, 'sin cita debe responder uso')
}

{
  const { relays, sends, replies } = await runCase({
    text: '   ',
    m: {
      chat: '120363@g.us',
      isGroup: true,
      msg: { contextInfo: { stanzaId: 'MSG2' } },
      quoted: { id: 'MSG2' },
    },
  })
  assert.strictEqual(relays.length, 0, 'sin texto no debe relayer')
  assert.strictEqual(sends.length, 0, 'sin texto no debe enviar')
  assert.strictEqual(replies.length, 1, 'sin texto debe responder uso')
}

{
  const { relays, sends, replies } = await runCase({
    m: {
      chat: '5491122223333@s.whatsapp.net',
      isGroup: false,
      msg: { contextInfo: { stanzaId: 'DM1' } },
      quoted: { id: 'DM1' },
    },
  })
  assert.strictEqual(relays.length, 0, 'en privado no debe relayer')
  assert.strictEqual(sends.length, 0, 'en privado no debe enviar')
  assert.strictEqual(replies.length, 1, 'en privado debe avisar que es solo grupos')
}

console.log('Todos los tests de fakemsg2 pasaron')

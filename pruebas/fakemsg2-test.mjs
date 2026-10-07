// Test offline de plugins/tools-fakemsg2.js
// Ejecutar: node pruebas/fakemsg2-test.mjs
import assert from 'node:assert'
import handler from '../plugins/tools-fakemsg2.js'

async function runCase({ m, text = 'mensaje inventado', connOverrides = {} }) {
  const relays = []
  const sends = []
  const replies = []
  const reactions = []
  const conn = {
    user: { jid: '5491100000000:12@s.whatsapp.net' },
    getName: async () => 'Nombre Test',
    profilePictureUrl: async () => null,
    relayMessage: async (jid, message, opts) => relays.push({ jid, message, opts }),
    sendMessage: async (jid, content, opts) => sends.push({ jid, content, opts }),
    reply: async (jid, message) => replies.push({ jid, message }),
    cMod: (_jid, message) => message,
    ...connOverrides,
  }
  const fakeM = { react: async (emoji) => reactions.push(emoji), ...m }
  await handler(fakeM, { conn, text, usedPrefix: '%', command: 'fakemsg2' })
  return { relays, sends, replies, reactions }
}

{
  const { sends, replies, reactions } = await runCase({
    m: {
      chat: '120363000000000000@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '5491122223333@s.whatsapp.net', stanzaId: 'MSG1' } },
      quoted: {
        id: 'MSG1',
        sender: '5491122223333@s.whatsapp.net',
        message: { extendedTextMessage: { text: 'texto original' } },
      },
    },
  })

  assert.strictEqual(replies.length, 0, 'no debe responder error')
  assert.strictEqual(sends.length, 1, 'debe mandar un solo mensaje visible')
  assert.strictEqual(sends[0].jid, '120363000000000000@g.us', 'send al grupo')
  assert.strictEqual(sends[0].opts.quoted, null, 'no debe citar el comando real')

  const content = sends[0].content
  assert.ok(content.text.includes('*FAKEMSG2 - SIMULACION*'), 'debe tener encabezado explicito')
  assert.ok(content.text.includes('*Nombre:* Nombre Test'), 'debe poner nombre resuelto')
  assert.ok(content.text.includes('*Usuario:* @5491122223333'), 'debe mencionar usuario objetivo')
  assert.ok(content.text.includes('mensaje inventado'), 'debe incluir el texto simulado')
  assert.ok(content.text.includes('Este mensaje fue generado por el bot'), 'debe incluir disclaimer visible')
  assert.deepStrictEqual(content.mentions, ['5491122223333@s.whatsapp.net'], 'debe mencionar participante objetivo')
  assert.ok(reactions.includes('\u2705'), 'debe reaccionar ok')
}

{
  const { sends, replies } = await runCase({
    m: {
      chat: '5491122223333@s.whatsapp.net',
      isGroup: false,
      msg: { contextInfo: { stanzaId: 'DM1' } },
      quoted: {
        id: 'DM1',
        sender: '5491122223333@s.whatsapp.net',
        message: { conversation: 'texto real' },
      },
    },
  })

  assert.strictEqual(replies.length, 0, 'DM no debe responder error')
  assert.strictEqual(sends.length, 1, 'DM debe enviar un mensaje')
  assert.ok(sends[0].content.text.includes('mensaje inventado'), 'texto visible correcto')
  assert.ok(sends[0].content.text.includes('Este mensaje fue generado por el bot'), 'disclaimer visible correcto')
}

{
  const { relays, sends, replies } = await runCase({
    m: { chat: 'x@s.whatsapp.net', isGroup: false, quoted: null },
  })
  assert.strictEqual(relays.length, 0, 'sin cita no debe relayer')
  assert.strictEqual(sends.length, 0, 'sin cita no debe enviar')
  assert.strictEqual(replies.length, 1, 'sin cita debe responder uso')
}

console.log('Todos los tests de fakemsg2 pasaron')

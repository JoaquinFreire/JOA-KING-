// Test offline de plugins/tools-fakemsg.js
// Ejecutar: node pruebas/fakemsg-test.mjs
// No toca la red: mockea conn.relayMessage y valida las keys del protocolMessage.
import assert from 'node:assert'
import handler from '../plugins/tools-fakemsg.js'

const protoType = 14 // proto.Message.ProtocolMessage.Type.MESSAGE_EDIT

async function runCase({ m, connOverrides = {}, text = 'hola' }) {
  const relays = []
  const replies = []
  const reactions = []
  const overrides = typeof connOverrides === 'function'
    ? connOverrides({ relays, replies, reactions })
    : connOverrides
  const conn = {
    user: { jid: '5491100000000:12@s.whatsapp.net' },
    __fakemsgNoFallback: true,
    reply: async (jid, txt) => replies.push(txt),
    getName: async () => 'NombreTest',
    relayMessage: async (jid, message, opts) => relays.push({ jid, message, opts }),
    ...overrides,
  }
  const fakeM = { react: async (emoji) => reactions.push(emoji), ...m }
  await handler(fakeM, { conn, text, usedPrefix: '%', command: 'fakemsg' })
  return { relays, replies, reactions }
}

function extractKeys(relays) {
  return relays.map((r) => {
    const pm = r.message.protocolMessage
    assert.strictEqual(pm.type, protoType, 'type debe ser MESSAGE_EDIT (14)')
    assert.strictEqual(r.opts.additionalAttributes.edit, '1', 'falta attr edit=1')
    const em = pm.editedMessage
    const text = em.conversation ?? em.extendedTextMessage?.text
    assert.strictEqual(text, 'hola', 'editedMessage debe llevar el texto falso (conversation o extendedTextMessage)')
    return { key: { ...pm.key }, relayJid: r.jid, contentType: em.conversation ? 'conversation' : 'extendedTextMessage' }
  })
}

// 1) Grupo con addressing LID: participant crudo debe conservarse como xxx@lid
{
  const { relays, replies } = await runCase({
    m: {
      chat: '120363000000000000@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '987654321@lid', stanzaId: 'MSGID1' } },
      quoted: { id: 'MSGID1', sender: '987654321@lid' },
    },
  })
  assert.strictEqual(replies.length, 0, 'no debe responder error')
  const items = extractKeys(relays)
  const keys = items.map((i) => i.key)
  assert.ok(keys.length >= 2, `debe enviar varias variantes (obtuvo ${keys.length})`)
  assert.ok(
    keys.some((k) => k.participant === '987654321@lid' && k.fromMe === false && k.id === 'MSGID1'),
    'falta la key principal: participant LID crudo + fromMe false'
  )
  assert.ok(keys.some((k) => k.fromMe === true), 'falta variante fromMe=true (dispositivo de la víctima)')
  assert.ok(keys.every((k) => k.id === 'MSGID1'), 'todas las keys apuntan al id original')
  assert.ok(keys.every((k) => k.remoteJid === '120363000000000000@g.us'), 'todas apuntan al grupo')
  assert.ok(items.every((i) => i.relayJid === '120363000000000000@g.us'), 'el relay va al grupo')
  console.log(`✔ grupo LID: ${keys.length} variantes, LID crudo preservado`)
}

// 2) Grupo tradicional (PN): participant resuelto debe estar presente
{
  const { relays } = await runCase({
    m: {
      chat: '120363000000000001@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '5491122223333@s.whatsapp.net', stanzaId: 'MSGID2' } },
      quoted: { id: 'MSGID2', sender: '5491122223333@s.whatsapp.net' },
    },
  })
  const keys = extractKeys(relays).map((i) => i.key)
  assert.ok(
    keys.some((k) => k.participant === '5491122223333@s.whatsapp.net' && k.fromMe === false),
    'falta key con participant PN + fromMe false'
  )
  assert.ok(keys.every((k) => k.id === 'MSGID2'), 'todas las keys apuntan al id original')
  console.log(`✔ grupo PN: ${keys.length} variantes`)
}

// 2b) Grupo LID con groupMetadata: DEBE agregar la forma PN real (phoneNumber)
{
  const { relays } = await runCase({
    m: {
      chat: '120363000000000002@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '987654321@lid', stanzaId: 'MSGID2B' } },
      quoted: { id: 'MSGID2B', sender: '987654321@lid' },
    },
    connOverrides: {
      groupMetadata: async () => ({
        addressingMode: 'lid',
        participants: [
          { id: '987654321@lid', phoneNumber: '5491155556666@s.whatsapp.net' },
        ],
      }),
    },
  })
  const items = extractKeys(relays)
  const keys = items.map((i) => i.key)
  assert.ok(
    keys.some((k) => k.participant === '5491155556666@s.whatsapp.net'),
    'falta la variante PN real obtenida de groupMetadata.phoneNumber'
  )
  assert.ok(
    keys.some((k) => k.participant === '987654321@lid'),
    'falta la variante LID cruda'
  )
  assert.ok(keys.some((k) => !k.participant), 'falta key desnuda (solo id)')
  assert.ok(items.some((i) => i.contentType === 'extendedTextMessage'), 'falta variante extendedTextMessage')
  assert.ok(items.some((i) => i.contentType === 'conversation'), 'falta variante conversation')
  console.log(`✔ grupo LID+metadata: ${keys.length} keys, PN real incluido, doble contenido`)
}

// 2c) Grupo LID SIN phoneNumber en metadata: el PN debe venir de lidMapping USYNC
{
  const { relays } = await runCase({
    m: {
      chat: '120363000000000003@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '111222333@lid', stanzaId: 'MSGID2C' } },
      quoted: { id: 'MSGID2C', sender: '111222333@lid' },
    },
    connOverrides: {
      groupMetadata: async () => ({
        addressingMode: 'lid',
        participants: [{ id: '111222333@lid' }], // sin phoneNumber (caso real del usuario)
      }),
      signalRepository: {
        lidMapping: {
          getPNForLID: async (lid) => (lid === '111222333@lid' ? '5491177778888@s.whatsapp.net' : null),
          getLIDForPN: async () => null,
        },
      },
    },
  })
  const keys = extractKeys(relays).map((i) => i.key)
  assert.ok(
    keys.some((k) => k.participant === '5491177778888@s.whatsapp.net'),
    'falta el PN resuelto vía signalRepository.lidMapping.getPNForLID'
  )
  assert.ok(keys.some((k) => k.participant === '111222333@lid'), 'falta el LID crudo')
  console.log(`✔ grupo LID sin phoneNumber: PN resuelto vía USYNC lidMapping (${keys.length} keys)`)
}

// 2d) Path OFICIAL: cuando conn.sendMessage existe, debe usarse con {text, edit: key}
{
  const sendCalls = []
  const { relays } = await runCase({
    m: {
      chat: '120363000000000004@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '444555666@lid', stanzaId: 'MSGID2D' } },
      quoted: { id: 'MSGID2D', sender: '444555666@lid' },
    },
    connOverrides: ({ relays }) => ({
      sendMessage: async (jid, content) => {
        sendCalls.push({ jid, content })
        // Simular la salida real: genera protocolMessage como Baileys
        relays.push({
          jid,
          message: {
            protocolMessage: {
              key: content.edit,
              editedMessage: { extendedTextMessage: { text: content.text } },
              type: 14,
            },
          },
          opts: { additionalAttributes: { edit: '1' } },
        })
      },
    }),
  })
  assert.ok(sendCalls.length > 0, 'conn.sendMessage no fue usado')
  assert.ok(
    sendCalls.every((c) => typeof c.content.edit === 'object' && c.content.edit.id === 'MSGID2D'),
    'cada sendMessage debe llevar {text, edit: key}'
  )
  assert.ok(relays.length > 0, 'debe caer también la variante conversation por relayMessage')
  console.log(`✔ path oficial sendMessage({text, edit}): ${sendCalls.length} llamadas + ${relays.length} relays`)
}

// 2e) La forma "texto ficticio + respuesta" separa el contenido citado del texto visible.
{
  const sendCalls = []
  await runCase({
    text: 'texto ficticio + respuesta visible del bot',
    m: {
      chat: '120363000000000006@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '555666777@lid', stanzaId: 'MSG2E' } },
      quoted: { id: 'MSG2E', sender: '555666777@lid' },
    },
    connOverrides: {
      __fakemsgNoFallback: false,
      sendMessage: async (jid, content) => sendCalls.push({ jid, content }),
    },
  })
  const fallback = sendCalls.find(({ content }) => !content.edit)
  assert.ok(fallback, 'debe enviar el mensaje visible de respuesta')
  assert.strictEqual(fallback.content.text, 'respuesta visible del bot', 'la respuesta del bot no debe quedar vacía')
  assert.strictEqual(
    fallback.content.contextInfo.quotedMessage.conversation,
    'texto ficticio',
    'el contenido ficticio citado debe quedar separado de la respuesta'
  )
  assert.ok(
    sendCalls.filter(({ content }) => content.edit).every(({ content }) => content.text === 'texto ficticio'),
    'las variantes de edición deben usar solo el texto ficticio'
  )
  console.log('✔ separa texto ficticio y respuesta visible')
}


// 3) DM: sin participant; cubrir chat y jid del bot con fromMe true/false
{
  const { relays } = await runCase({
    m: {
      chat: '5491122223333@s.whatsapp.net',
      isGroup: false,
      msg: { contextInfo: { stanzaId: 'MSGID3' } },
      quoted: { id: 'MSGID3', sender: '5491122223333@s.whatsapp.net' },
    },
  })
  const keys = extractKeys(relays).map((i) => i.key)
  assert.ok(keys.every((k) => !k.participant), 'las keys de DM no deben llevar participant')
  assert.ok(
    keys.some((k) => k.remoteJid === '5491122223333@s.whatsapp.net' && k.fromMe === false),
    'falta key con remoteJid = chat + fromMe false'
  )
  assert.ok(
    keys.some((k) => k.remoteJid === '5491100000000@s.whatsapp.net' && k.fromMe === true),
    'falta key con remoteJid = jid del bot + fromMe true (store del otro lado)'
  )
  assert.ok(keys.every((k) => k.id === 'MSGID3'), 'todas las keys apuntan al id original')
  console.log(`✔ DM: ${keys.length} variantes`)
}

// 4) Algunos serializadores llaman al texto citado "extendedText" en vez de "extendedTextMessage"
{
  const { relays, replies } = await runCase({
    m: {
      chat: '120363000000000005@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '222333444@lid', stanzaId: 'MSGID4' } },
      quoted: { id: 'MSGID4', sender: '222333444@lid', mtype: 'extendedText', text: 'texto real citado' },
    },
  })
  assert.strictEqual(replies.length, 0, 'no debe rechazar ExtendedText como media')
  assert.ok(relays.length > 0, 'debe relayear cuando el citado es ExtendedText')
  console.log('✔ acepta citado ExtendedText')
}

// 5) Sin quoted: mensaje de uso, cero relays
{
  const { relays, replies } = await runCase({
    m: { chat: 'x@s.whatsapp.net', isGroup: false, msg: null, quoted: null },
  })
  assert.strictEqual(relays.length, 0, 'no debe relayear sin quoted')
  assert.strictEqual(replies.length, 1, 'debe pedir que cite un mensaje')
  console.log('✔ sin quoted')
}

// 6) Sin texto: mensaje de uso, cero relays
{
  const { relays, replies } = await runCase({
    text: '   ',
    m: {
      chat: 'x@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '1@lid', stanzaId: 'I' } },
      quoted: { id: 'I', sender: '1@lid' },
    },
  })
  assert.strictEqual(relays.length, 0, 'no debe relayear sin texto')
  assert.strictEqual(replies.length, 1, 'debe pedir el texto')
  console.log('✔ sin texto')
}

// 7) Mensaje citado no editable: debe rechazar media/sticker/audio antes de relayear
{
  const { relays, replies, reactions } = await runCase({
    m: {
      chat: '120363@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '1@lid', stanzaId: 'IMG1' } },
      quoted: { id: 'IMG1', sender: '1@lid', mtype: 'imageMessage' },
    },
  })
  assert.strictEqual(relays.length, 0, 'no debe relayear media como edicion de texto')
  assert.strictEqual(replies.length, 1, 'debe explicar que solo edita texto')
  assert.ok(replies[0].includes('solo acepta editar mensajes de texto'), 'debe mencionar la limitacion de texto')
  assert.ok(reactions.includes('✖️'), 'debe reaccionar error')
  console.log('✔ rechaza citado no-texto')
}

// 8) Relay falla en todas las variantes: reacciona ✖️ y responde con el error
{
  const { replies, reactions } = await runCase({
    m: {
      chat: '120363@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '1@lid', stanzaId: 'I' } },
      quoted: { id: 'I', sender: '1@lid' },
    },
    connOverrides: {
      relayMessage: async () => {
        throw new Error('fallo simulado')
      },
    },
  })
  assert.ok(reactions.includes('✖️'), 'debe reaccionar ✖️')
  assert.strictEqual(replies.length, 1, 'debe responder con el error')
  assert.ok(replies[0].includes('fallo simulado'), 'el error debe incluir el motivo')
  console.log('✔ relay falla total')
}

// 9) Relay falla parcialmente: al menos una variante exitosa = ✅
{
  let calls = 0
  const { reactions } = await runCase({
    m: {
      chat: '120363@g.us',
      isGroup: true,
      msg: { contextInfo: { participant: '1@lid', stanzaId: 'I' } },
      quoted: { id: 'I', sender: '1@lid' },
    },
    connOverrides: {
      relayMessage: async () => {
        calls++
        if (calls === 1) throw new Error('primera falla')
      },
    },
  })
  assert.ok(reactions.includes('✅'), 'debe reaccionar ✅ si alguna variante salió')
  console.log('✔ relay falla parcial')
}

console.log('\nTodos los tests de fakemsg pasaron ✔')

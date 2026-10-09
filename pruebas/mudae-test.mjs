import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const testDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'joa-king-mudae-test-'))
process.env.MUDAE_DATA_DIR = testDataDirectory
process.env.MUDAE_CATALOG_FILE = path.join(testDataDirectory, 'catalog.json')
global.owner = ['5493513117202']

const {
  default: handler,
  MUDAE_CONFIG,
  getCloudinaryCredentials,
  hasQuotedMudaeImage,
  makeCharacterIdentity,
  normalizeMudaeIdentity,
  normalizeMudaeLabel,
  parseMudaeParts,
} = await import('../plugins/mudae.js')
const { default: animeInfoHandler } = await import('../plugins/anime-infoanime.js')
const { default: legacySeriesHandler } = await import('../plugins/gacha-serielist.js')

const groupOne = '120363000000000001@g.us'
const groupTwo = '120363000000000002@g.us'
const groupThree = '120363000000000003@g.us'
const groupFour = '120363000000000004@g.us'
const groupFive = '120363000000000005@g.us'
const groupSix = '120363000000000006@g.us'
const groupSeven = '120363000000000007@g.us'
const groupEight = '120363000000000008@g.us'
const groupNine = '120363000000000009@g.us'
const groupTen = '120363000000000010@g.us'
const userOne = '5491111111111@s.whatsapp.net'
const userTwo = '5491222222222@s.whatsapp.net'
const botJid = '5493513117202@s.whatsapp.net'
const filenameFor = (groupId) => path.join(
  testDataDirectory,
  `group-${crypto.createHash('sha256').update(groupId).digest('hex')}.json`
)
const createState = (groupId, overrides = {}) => ({
  groupId,
  enabled: true,
  albums: ['Dragon Ball Z'],
  characters: [],
  users: {},
  rollCooldowns: {},
  claimCooldowns: {},
  voteCooldowns: {},
  pendingVotes: {},
  activeRoll: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})
const readState = async (groupId) => JSON.parse(await fs.readFile(filenameFor(groupId), 'utf8'))
const available = {
  id: 'character-1',
  name: 'Trunks',
  album: 'Dragon Ball Z',
  value: 1000,
  imageUrl: 'https://res.cloudinary.com/example/image/upload/trunks.jpg',
  cloudinaryPublicId: 'mudae/test/trunks',
  owner: null,
  createdAt: Date.now(),
}
const secondCharacter = {
  ...available,
  id: 'character-2',
  name: 'Goku',
  value: 1500,
  owner: userTwo,
}

class FakeEvents {
  listeners = new Map()

  on(name, listener) {
    const list = this.listeners.get(name) || []
    list.push(listener)
    this.listeners.set(name, list)
  }
}

const createConnection = () => {
  const sent = []
  const replies = []
  let messageId = 0
  const conn = {
    user: { jid: botJid },
    ev: new FakeEvents(),
    getName: async (jid) => jid.split('@')[0],
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options })
      return { key: { id: `ROLL-${++messageId}`, remoteJid: jid } }
    },
    reply: async (jid, text) => {
      replies.push({ jid, text })
      return text
    },
    decodeJid: (jid) => jid,
  }
  return { conn, sent, replies }
}

const groupMessage = (chat, sender = userOne) => ({
  chat,
  sender,
  pushName: sender.split('@')[0],
  isGroup: true,
  mentionedJid: [],
})

const runCommand = (conn, m, command, text = '', extra = {}) => handler(m, {
  conn,
  command,
  text,
  usedPrefix: '%',
  isOwner: false,
  isROwner: false,
  isAdmin: false,
  ...extra,
})
const runCommandAfterRollCooldown = async (conn, m, command, text = '', extra = {}) => {
  const originalNow = Date.now
  Date.now = () => originalNow() + MUDAE_CONFIG.ROLL_COOLDOWN + 1
  try {
    return await runCommand(conn, m, command, text, extra)
  } finally {
    Date.now = originalNow
  }
}

try {
  assert.equal(MUDAE_CONFIG.ROLL_COOLDOWN, 5000)
  assert.equal(MUDAE_CONFIG.CLAIM_COOLDOWN, 60 * 60 * 1000)
  assert.equal(MUDAE_CONFIG.CLAIM_DURATION, 60 * 1000)
  assert.equal(MUDAE_CONFIG.VOTE_COOLDOWN, 24 * 60 * 60 * 1000)
  assert.equal(MUDAE_CONFIG.VOTE_VALUE_INCREMENT, 125)
  assert.equal(MUDAE_CONFIG.WISHLIST_LIMIT, 3)
  assert.equal(MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE, 1000)
  const previousCloudinaryUrl = process.env.CLOUDINARY_URL
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME
  const previousApiKey = process.env.CLOUDINARY_API_KEY
  const previousApiSecret = process.env.CLOUDINARY_API_SECRET
  delete process.env.CLOUDINARY_CLOUD_NAME
  delete process.env.CLOUDINARY_API_KEY
  delete process.env.CLOUDINARY_API_SECRET
  process.env.CLOUDINARY_URL = 'cloudinary://123456:test-secret@demo-cloud'
  assert.deepEqual(getCloudinaryCredentials(), {
    cloudName: 'demo-cloud',
    apiKey: '123456',
    apiSecret: 'test-secret',
  }, 'debe aceptar las credenciales de CLOUDINARY_URL')
  if (previousCloudinaryUrl === undefined) delete process.env.CLOUDINARY_URL
  else process.env.CLOUDINARY_URL = previousCloudinaryUrl
  if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME
  else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName
  if (previousApiKey === undefined) delete process.env.CLOUDINARY_API_KEY
  else process.env.CLOUDINARY_API_KEY = previousApiKey
  if (previousApiSecret === undefined) delete process.env.CLOUDINARY_API_SECRET
  else process.env.CLOUDINARY_API_SECRET = previousApiSecret
  assert.equal(
    makeCharacterIdentity('Dragon Ball Z', 'Trunks'),
    makeCharacterIdentity(' dragon   ball z ', ' trunks '),
    'la identidad debe ignorar mayúsculas y espacios extra'
  )
  assert.equal(normalizeMudaeIdentity('  Trunks   Base '), 'trunks base')
  assert.equal(normalizeMudaeIdentity('  Dragón   Báll '), 'dragon ball')
  assert.equal(normalizeMudaeLabel('  nUtELLa   con   cHOCOLATE '), 'Nutella Con Chocolate')
  assert.deepEqual(parseMudaeParts('  dRAGON   bALL z + tRUNKS  ', 2), ['Dragon Ball Z', 'Trunks'])
  assert.deepEqual(parseMudaeParts('Dragon Ball Z + Trunks', 2), ['Dragon Ball Z', 'Trunks'])
  assert.equal(parseMudaeParts('Dragon Ball Z | Trunks', 2), null, 'debe reemplazar "|" por "+"')
  assert.equal(hasQuotedMudaeImage({
    quoted: {
      mtype: 'imageMessage',
      mimetype: 'image/jpeg',
      download: async () => Buffer.from('image'),
    },
  }), true, 'debe detectar imagen citada en mensaje serializado')
  assert.equal(hasQuotedMudaeImage({
    msg: {
      contextInfo: {
        quotedMessage: {
          ephemeralMessage: {
            message: { imageMessage: { mimetype: 'image/png' } },
          },
        },
      },
    },
  }), true, 'debe detectar imagen citada dentro de un mensaje efímero')

  await fs.writeFile(filenameFor(groupOne), JSON.stringify(createState(groupOne, {
    enabled: false,
    characters: [available, secondCharacter],
  })), 'utf8')
  await fs.writeFile(filenameFor(groupTwo), JSON.stringify(createState(groupTwo, {
    characters: [available],
    activeRoll: { messageId: 'COOLDOWN-ROLL', characterId: available.id, expiresAt: Date.now() + 60000 },
    claimCounts: { [userOne]: MUDAE_CONFIG.CLAIM_LIMIT },
    claimCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.CLAIM_COOLDOWN },
  })), 'utf8')
  await fs.writeFile(filenameFor(groupThree), JSON.stringify(createState(groupThree, {
    characters: [available],
    activeRoll: { messageId: 'EXPIRED', characterId: available.id, expiresAt: Date.now() - 1 },
  })), 'utf8')
  await fs.writeFile(filenameFor(groupFour), JSON.stringify(createState(groupFour, {
    albums: ['Dragon Ball Z', 'Dragon Ball Z Kai'],
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
    pendingVotes: { [userOne]: true },
    characters: [
      { ...available, id: 'claimed-character', owner: userTwo },
      { ...available, id: 'claimed-character-other-album', album: 'Dragon Ball Z Kai', owner: userTwo },
    ],
  })), 'utf8')
  await fs.writeFile(filenameFor(groupFive), JSON.stringify(createState(groupFive, {
    albums: ['postres'],
    characters: [{
      ...available,
      id: 'legacy-character',
      name: 'nutella',
      album: 'postres',
      variant: 'no sé',
      owner: userTwo,
    }],
  })), 'utf8')
  await fs.writeFile(filenameFor(groupSix), JSON.stringify(createState(groupSix, {
    characters: Array.from({ length: 12 }, (_, index) => ({
      ...available,
      id: `rank-character-${index}`,
      name: `Character ${index}`,
      owner: `5491000000${String(index).padStart(3, '0')}@s.whatsapp.net`,
      value: (index + 1) * 100,
    })),
  })), 'utf8')
  await fs.writeFile(filenameFor(groupEight), JSON.stringify(createState(groupEight, {
    characters: [{ ...available, id: 'owned-character', name: 'Owned Character', owner: userTwo, claimedAt: Date.now() }],
  })), 'utf8')
  await fs.writeFile(filenameFor(groupNine), JSON.stringify(createState(groupNine, {
    characters: Array.from({ length: 4 }, (_, index) => ({
      ...available,
      id: `wish-character-${index}`,
      name: `Wish ${index}`,
    })),
  })), 'utf8')
  await fs.writeFile(filenameFor(groupTen), JSON.stringify(createState(groupTen, {
    characters: [
      { ...available, id: 'wanted-roll', name: 'Wanted Roll' },
      { ...available, id: 'second-wanted-roll', name: 'Second Wanted Roll' },
    ],
    users: { [userTwo]: { wishlist: ['wanted-roll'] } },
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
    pendingVotes: { [userOne]: true },
  })), 'utf8')
  await fs.writeFile(filenameFor(groupSeven), JSON.stringify(createState(groupSeven, {
    enabled: false,
    characters: [{ ...available, id: 'retired-character', name: 'Retired Character' }],
  })), 'utf8')
  await fs.writeFile(path.join(testDataDirectory, 'catalog.json'), JSON.stringify({
    version: 1,
    albums: [],
    characters: [],
    deletedCharacterIds: ['retired-character'],
  }), 'utf8')

  const { conn, sent, replies } = createConnection()
  await runCommand(conn, groupMessage(groupSeven), 'rw')
  assert.match(replies.at(-1).text, /desactivado/, 'Mudae debe comenzar apagado')
  assert.ok(!(await readState(groupSeven)).characters.some((character) => character.id === 'retired-character'), 'un personaje borrado no debe volver desde un estado antiguo')
  await runCommand(conn, groupMessage(groupSeven), 'menumudae')
  assert.match(replies.at(-1).text, /%addpj/)
  assert.doesNotMatch(replies.at(-1).text, /variante/i)
  assert.match(replies.at(-1).text, /%votarpj/)
  assert.match(replies.at(-1).text, /%wishremove/)
  assert.match(replies.at(-1).text, /%addpj <álbum> \+ <nombre>/)
  assert.ok(handler.command.includes('toppj'))
  assert.ok(handler.command.includes('ainfo'))
  assert.ok(!animeInfoHandler.command.includes('ainfo'))
  assert.ok(animeInfoHandler.command.includes('animedata'))
  assert.ok(!legacySeriesHandler.command.includes('ainfo'))
  assert.ok(!handler.command.includes('top'))
  assert.ok(handler.command.includes('menumudae'))

  await runCommand(conn, groupMessage(groupOne), 'onmudae')
  assert.match(replies.at(-1).text, /Solo el owner/)
  assert.equal((await readState(groupOne)).enabled, false, 'solo el owner puede activarlo')
  await runCommand(conn, groupMessage(groupOne), 'onmudae', '', { isOwner: true })
  assert.equal((await readState(groupOne)).enabled, true)
  assert.equal((await readState(groupTwo)).enabled, true)
  const sentBeforeUnvotedRoll = sent.length
  await runCommand(conn, groupMessage(groupOne), 'rw')
  assert.match(replies.at(-1).text, /votarpj Goku/, 'debe explicar cómo votar antes de tirar')
  assert.equal(sent.length, sentBeforeUnvotedRoll, 'no debe tirar sin un voto pendiente')

  await runCommand(conn, groupMessage(groupTwo), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /1\.125/)
  assert.equal((await readState(groupTwo)).pendingVotes[userOne], true, 'un voto válido habilita una tirada')
  await runCommand(conn, groupMessage(groupTwo), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /voto pendiente/, 'no permite acumular votos pendientes')
  await runCommand(conn, groupMessage(groupTwo, userTwo), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /1\.250/, 'otro usuario puede emitir su propio voto')
  assert.equal((await readState(groupTwo)).characters[0].value, 1250)

  await runCommand(conn, groupMessage(groupOne), 'addalbum', 'Dragon Ball Z', { isAdmin: true })
  assert.match(replies.at(-1).text, /ya existe/, 'debe rechazar álbum duplicado ignorando case')
  assert.deepEqual((await readState(groupOne)).albums, ['Dragon Ball Z'])
  await runCommand(conn, groupMessage(groupOne), 'addalbum', 'Other Album', { isAdmin: true })
  await runCommand(conn, groupMessage(groupOne), 'ainfo', 'Dragon Ball Z')
  assert.match(replies.at(-1).text, /PERSONAJES DE DRAGON BALL Z/)
  assert.match(replies.at(-1).text, /Trunks/)
  assert.match(replies.at(-1).text, /Goku/)
  assert.match(replies.at(-1).text, /\$1\.000/, 'ainfo debe mostrar el valor de cada personaje')
  await runCommand(conn, groupMessage(groupOne), 'ainfo', 'Drágon Báll Z')
  assert.match(replies.at(-1).text, /PERSONAJES DE DRAGON BALL Z/, 'ainfo debe encontrar álbumes aunque la consulta tenga tildes')
  await runCommand(conn, groupMessage(groupOne), 'votarpj', 'Goku')
  assert.match(replies.at(-1).text, /VOTO REGISTRADO/)
  await runCommand(conn, groupMessage(groupOne), 'votarpj', 'oku')
  assert.match(replies.at(-1).text, /voto pendiente/, 'votarpj debe resolver una palabra única que no esté al comienzo del nombre')

  await runCommand(conn, groupMessage(groupOne), 'delpj', 'Dragon Ball Z + Goku', { isAdmin: true })
  assert.match(replies.at(-1).text, /Solo el owner del bot/)
  assert.ok((await readState(groupOne)).characters.some((character) => character.name === 'Goku'))

  const credentialsToRestore = {
    CLOUDINARY_URL: process.env.CLOUDINARY_URL,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  }
  delete process.env.CLOUDINARY_URL
  delete process.env.CLOUDINARY_CLOUD_NAME
  delete process.env.CLOUDINARY_API_KEY
  delete process.env.CLOUDINARY_API_SECRET
  const repliedImageCommand = groupMessage(groupOne)
  repliedImageCommand.quoted = {
    mtype: 'imageMessage',
    mimetype: 'image/jpeg',
    download: async () => Buffer.from('test image'),
  }
  await runCommand(conn, repliedImageCommand, 'addpj', 'Other Album + Trunks', { isAdmin: true })
  assert.match(replies.at(-1).text, /nombres deben ser únicos/, 'no permite repetir el nombre en otro álbum')
  await runCommand(conn, repliedImageCommand, 'addpj', 'Dragon Ball Z + nEW cHARACTER', { isAdmin: true })
  assert.match(replies.at(-1).text, /CLOUDINARY_URL/, 'quoted image and valid arguments must pass usage validation')
  assert.doesNotMatch(replies.at(-1).text, /Uso:/)
  for (const [key, value] of Object.entries(credentialsToRestore)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  await runCommand(conn, groupMessage(groupOne), 'editpj', 'Dragon Ball Z + Trunks + Dragon Ball Z + Goku', { isAdmin: true })
  assert.match(replies.at(-1).text, /Ya existe un personaje/, 'editar no debe generar nombres duplicados')
  assert.equal((await readState(groupOne)).characters[0].name, 'Trunks')

  await runCommand(conn, groupMessage(groupOne), 'delalbum', 'Dragon Ball Z', { isAdmin: true })
  assert.match(replies.at(-1).text, /todavía tiene personajes/, 'no debe eliminar álbumes con personajes')

  const mentionedUser = groupMessage(groupOne)
  mentionedUser.mentionedJid = [userTwo]
  await runCommand(conn, mentionedUser, 'personajes', '@5491222222222')
  assert.match(replies.at(-1).text, /PERSONAJES DE/)
  assert.match(replies.at(-1).text, /Goku/)
  assert.match(replies.at(-1).text, /\$1\.625/)
  await runCommand(conn, groupMessage(groupOne), 'verpj', 'Góku')
  const characterInfo = sent.at(-1)
  assert.equal(characterInfo.content.image.url, available.imageUrl)
  assert.match(characterInfo.content.caption, /👑 \*Dueño:\* @5491222222222/)
  assert.deepEqual(characterInfo.content.mentions, [userTwo], 'la ficha debe etiquetar al dueño')
  await runCommand(conn, groupMessage(groupOne), 'verpj', 'run')
  assert.equal(sent.at(-1).content.image.url, available.imageUrl, 'verpj debe completar un nombre parcial si solo hay un resultado')
  await runCommand(conn, groupMessage(groupFour), 'verpj', 'Trunks')
  assert.match(replies.at(-1).text, /más de un álbum/, 'debe informar nombres ambiguos')
  await runCommand(conn, groupMessage(groupFour), 'verpj', 'Tru')
  assert.match(replies.at(-1).text, /No encontré ese personaje/, 'un fragmento ambiguo debe responder que no encontró el personaje')
  await runCommand(conn, groupMessage(groupFour), 'verpj', 'Dragon Ball Z Kai + Trunks')
  assert.match(sent.at(-1).content.caption, /\*Trunks\*/, 'debe permitir resolver la ambigüedad')
  await runCommand(conn, groupMessage(groupFive), 'wish', 'tella')
  assert.match(replies.at(-1).text, /AGREGADO A TU WISHLIST/, 'wish debe aceptar una palabra parcial que no esté al comienzo del nombre')
  await runCommand(conn, groupMessage(groupTen), 'wish', 'Roll')
  assert.match(replies.at(-1).text, /No encontré ese personaje/, 'wish debe rechazar un fragmento que coincide con varios personajes')
  await runCommand(conn, groupMessage(groupTen), 'verpj', 'Roll')
  assert.match(replies.at(-1).text, /No encontré ese personaje/, 'verpj debe rechazar un fragmento que coincide con varios personajes')
  await runCommand(conn, groupMessage(groupOne), 'wish', 'Goku')
  assert.match(replies.at(-1).text, /WISHLIST/)
  await runCommand(conn, groupMessage(groupOne), 'wishlist')
  assert.match(replies.at(-1).text, /Goku/)
  await runCommand(conn, groupMessage(groupSix), 'toppj')
  const rankMessage = sent.at(-1)
  assert.match(rankMessage.content.text, /TOP 10 PERSONAJES/)
  assert.equal(rankMessage.content.mentions.length, 10, 'el ranking debe limitar menciones a diez personas')
  assert.equal((rankMessage.content.text.match(/@/g) || []).length, 10, 'el ranking debe mostrar solamente diez puestos')

  for (const name of ['Wish 0', 'Wish 1', 'Wish 2']) {
    await runCommand(conn, groupMessage(groupNine), 'wish', name)
  }
  await runCommand(conn, groupMessage(groupNine), 'wish', 'Wish 3')
  assert.match(replies.at(-1).text, /límite de 3/, 'la wishlist no debe aceptar más de tres personajes')
  await runCommand(conn, groupMessage(groupNine), 'wishremove', 'Wish 1')
  assert.match(replies.at(-1).text, /DESEADO ELIMINADO/)
  await runCommand(conn, groupMessage(groupNine), 'wish', 'Wish 3')
  await runCommand(conn, groupMessage(groupNine), 'wishlist')
  assert.match(replies.at(-1).text, /Wish 0/)
  assert.match(replies.at(-1).text, /Wish 2/)
  assert.match(replies.at(-1).text, /Wish 3/)
  assert.doesNotMatch(replies.at(-1).text, /Wish 1/)

  await runCommand(conn, groupMessage(groupTen), 'wishlist')
  const groupTenAvailable = (await readState(groupTen)).characters.filter((character) => !character.owner)
  const wantedRollIndex = groupTenAvailable.findIndex((character) => character.id === 'wanted-roll')
  assert.notEqual(wantedRollIndex, -1, 'el personaje deseado debe estar disponible para el roll')
  const originalRandom = Math.random
  Math.random = () => (wantedRollIndex + 0.5) / groupTenAvailable.length
  await runCommand(conn, groupMessage(groupTen), 'rw')
  Math.random = originalRandom
  const wantedRoll = sent.at(-1)
  assert.match(wantedRoll.content.caption, /\*Deseado por:\* @5491222222222/)
  assert.deepEqual(wantedRoll.content.mentions, [userTwo], 'el roll debe etiquetar a quienes lo tienen en wishlist')
  const sentAfterFirstWantedRoll = sent.length
  await runCommandAfterRollCooldown(conn, groupMessage(groupTen), 'rw')
  assert.equal(sent.length, sentAfterFirstWantedRoll + 1, 'el mismo voto debe habilitar otra tirada dentro de las 24 horas')
  const groupTenStateAfterSecondRoll = await readState(groupTen)
  assert.equal(groupTenStateAfterSecondRoll.rollCounts[userOne], 2, 'las tiradas múltiples deben contar dentro del límite diario')
  const valueBeforeRepeatVote = groupTenStateAfterSecondRoll.characters.find((character) => character.id === 'wanted-roll').value
  await runCommand(conn, groupMessage(groupTen), 'votarpj', 'Wanted Roll')
  assert.match(replies.at(-1).text, /Ya votaste en las últimas 24 horas/, 'el cooldown del voto se mantiene aunque permita varias tiradas')
  assert.equal((await readState(groupTen)).characters.find((character) => character.id === 'wanted-roll').value, valueBeforeRepeatVote)

  const beforeRollMessages = sent.length
  await runCommand(conn, groupMessage(groupOne), 'rw')
  assert.equal(sent.length, beforeRollMessages + 1, 'debe publicar roll con imagen')
  const rollMessage = sent.at(-1)
  assert.ok(rollMessage.content.image.url.includes('cloudinary.com'))
  assert.match(rollMessage.content.caption, /Trunks/)
  assert.match(rollMessage.content.caption, /\*Trunks\*/)
  assert.doesNotMatch(rollMessage.content.caption, /variante/i)
  assert.match((await readState(groupOne)).activeRolls[0].messageId, /^ROLL-/)

  await runCommandAfterRollCooldown(conn, groupMessage(groupOne), 'rw')
  assert.match(replies.at(-1).text, /NO HAY PERSONAJES DISPONIBLES/, 'el voto habilita tiradas aunque el único personaje disponible esté activo')
  assert.equal((await readState(groupOne)).activeRolls.length, 1, 'no debe crear un roll sin personajes disponibles')

  await handler.all.call(conn, groupMessage(groupOne))
  const reactionListener = conn.ev.listeners.get('messages.reaction')?.[0]
  assert.equal(typeof reactionListener, 'function', 'debe conectar el evento de reacciones')

  await reactionListener([{
    key: { remoteJid: groupOne, id: 'MENSAJE-AJENO' },
    reaction: { text: '❤️', key: { participant: userOne } },
  }])
  assert.equal((await readState(groupOne)).characters[0].owner, null, 'ignora reacciones a otro mensaje')

  const activeRollId = (await readState(groupOne)).activeRolls[0].messageId
  await reactionListener([{
    key: { remoteJid: groupOne, id: activeRollId, participant: botJid },
    reaction: { text: '❤️', key: { participant: botJid, fromMe: true } },
  }])
  assert.equal((await readState(groupOne)).characters[0].owner, null, 'una reacción fromMe del bot no puede reclamar el roll')
  await reactionListener([{
    key: { remoteJid: groupOne, id: activeRollId, participant: botJid },
    reaction: { text: '❤️', key: { participant: botJid } },
  }])
  assert.equal((await readState(groupOne)).characters[0].owner, null, 'el bot no puede reclamar aunque fromMe no esté marcado')
  await reactionListener([{
    key: { remoteJid: groupOne, id: activeRollId, participant: botJid },
    reaction: { text: '❤️', key: {} },
  }])
  assert.equal((await readState(groupOne)).characters[0].owner, null, 'el autor del mensaje objetivo no debe confundirse con quien reaccionó')
  await Promise.all([
    reactionListener([{
      key: { remoteJid: groupOne, id: activeRollId },
      reaction: { text: '❤️', key: { participant: userOne } },
    }]),
    reactionListener([{
      key: { remoteJid: groupOne, id: activeRollId },
      reaction: { text: '❤️', key: { participant: userTwo } },
    }]),
  ])
  const claimed = await readState(groupOne)
  assert.ok([userOne, userTwo].includes(claimed.characters[0].owner), 'debe asignar el personaje a un ganador')
  assert.equal(claimed.activeRolls.length, 0, 'debe eliminar el roll activo inmediatamente al reclamar')
  assert.equal(claimed.activeRoll, null, 'debe cerrar el roll inmediatamente al reclamar')
  assert.equal(Object.keys(claimed.claimCounts).length, 1, 'solamente un usuario debe quedar registrado como ganador')
  assert.equal(Object.values(claimed.claimCounts)[0], 1, 'el ganador debe consumir un reclamo')
  const claimMessage = sent.find((message) => /¡Reclamado!/.test(message.content.text || ''))
  assert.ok(claimMessage, 'debe confirmar el reclamo')
  assert.match(claimMessage.content.text, /\*Trunks\*/)
  assert.match(claimMessage.content.text, /Dragon Ball Z/)
  assert.doesNotMatch(claimMessage.content.text, /variante/i)
  await runCommand(conn, groupMessage(groupOne, claimed.characters[0].owner), 'cd')
  assert.match(replies.at(-1).text, /Reclamos: 1\/2/, 'cd debe contar el primer reclamo antes de activar el cooldown')
  assert.doesNotMatch(replies.at(-1).text, /Próxima tirada del grupo/, 'cd no debe mostrar el cooldown grupal de la próxima tirada')

  await runCommand(conn, groupMessage(groupOne), 'personajes')
  assert.match(replies.at(-1).text, /Trunks/)
  const sentAfterClaim = sent.length
  await runCommandAfterRollCooldown(conn, groupMessage(groupOne), 'rw')
  assert.match(replies.at(-1).text, /NO HAY PERSONAJES DISPONIBLES/, 'el voto todavía está vigente, pero ya no quedan personajes para tirar')
  assert.equal(sent.length, sentAfterClaim, 'no debe crear otro roll cuando no quedan personajes disponibles')
  assert.equal((await readState(groupOne)).activeRolls.length, 0, 'el cooldown no debe crear otro roll')

  await handler.all.call(conn, groupMessage(groupTwo))
  await handler.all.call(conn, groupMessage(groupThree))
  await reactionListener([{
    key: { remoteJid: groupTwo, id: 'COOLDOWN-ROLL' },
    reaction: { text: '❤️', key: { participant: userOne } },
  }])
  const stillAvailable = await readState(groupTwo)
  assert.equal(stillAvailable.characters[0].owner, null, 'el cooldown de claim bloquea al usuario')
  assert.equal(stillAvailable.activeRolls[0].messageId, 'COOLDOWN-ROLL', 'otro usuario aún puede reclamar ese roll')
  await reactionListener([{
    key: { remoteJid: groupTwo, id: 'COOLDOWN-ROLL' },
    reaction: { text: '❤️', key: { participant: userTwo } },
  }])
  assert.equal((await readState(groupTwo)).characters[0].owner, userTwo, 'otro usuario sin cooldown puede reclamar')
  await runCommand(conn, groupMessage(groupTwo), 'cd')
  assert.match(replies.at(-1).text, /Reclamos: 0\/2/, 'cd debe mostrar 0/2 durante el cooldown de reclamos')
  const originalNow = Date.now
  Date.now = () => originalNow() + MUDAE_CONFIG.CLAIM_COOLDOWN + 1
  try {
    await runCommand(conn, groupMessage(groupTwo), 'cd')
  } finally {
    Date.now = originalNow
  }
  assert.match(replies.at(-1).text, /Reclamos: 2\/2/, 'cd debe volver a 2/2 cuando termina el cooldown')

  await reactionListener([{
    key: { remoteJid: groupThree, id: 'EXPIRED' },
    reaction: { text: '❤️', key: { participant: userOne } },
  }])
  assert.equal((await readState(groupThree)).characters[0].owner, null, 'rolls vencidos no se pueden reclamar')
  const beforeSharedCatalogRoll = sent.length
  await runCommand(conn, groupMessage(groupFour), 'rw')
  assert.equal(sent.length, beforeSharedCatalogRoll + 1, 'los personajes globales deben estar disponibles para los grupos')
  const groupOneState = await readState(groupOne)
  const groupTwoState = await readState(groupTwo)
  assert.equal(groupOneState.groupId, groupOne)
  assert.equal(groupTwoState.groupId, groupTwo)
  assert.equal(groupOneState.characters[0].owner, claimed.characters[0].owner, 'los datos de un grupo no deben cambiar al reclamar en otro')
  await runCommand(conn, groupMessage(groupFive), 'personajes', `@${userTwo.split('@')[0]}`)
  const migratedState = await readState(groupFive)
  const migratedCharacter = migratedState.characters.find((character) => character.id === 'legacy-character')
  assert.equal(migratedCharacter.name, 'Nutella', 'migra el nombre a capitalización de título')
  assert.equal(migratedCharacter.album, 'Postres', 'migra el álbum a capitalización de título')
  assert.equal(migratedCharacter.owner, userTwo, 'la migración conserva el propietario')
  assert.equal(Object.hasOwn(migratedCharacter, 'variant'), false, 'la migración elimina la variante')

  await runCommand(conn, groupMessage(groupEight), 'quitarpj', 'Owned Character')
  assert.match(replies.at(-1).text, /Solo quien tiene el personaje/, 'solo el dueño puede liberar el personaje')
  const giftMessage = groupMessage(groupEight, userTwo)
  giftMessage.mentionedJid = [userOne]
  await runCommand(conn, giftMessage, 'regalarpj', 'wned + @5491111111111')
  assert.match(sent.at(-1).content.text, /PERSONAJE REGALADO/, 'regalarpj debe aceptar una palabra parcial dentro del nombre')
  assert.equal((await readState(groupEight)).characters.find((character) => character.id === 'owned-character').owner, userOne, 'regalarpj transfiere la propiedad al mencionado')
  assert.deepEqual(sent.at(-1).content.mentions, [userOne], 'el regalo etiqueta al destinatario')
  await runCommand(conn, groupMessage(groupEight, userOne), 'quitarpj', 'Owned Character')
  const releasedCharacter = (await readState(groupEight)).characters.find((character) => character.id === 'owned-character')
  assert.equal(releasedCharacter.owner, null, 'quitarpj deja el personaje disponible')
  assert.equal(Object.hasOwn(releasedCharacter, 'claimedAt'), false, 'quitarpj limpia la fecha de reclamo')
  const missingRecipient = groupMessage(groupEight, userTwo)
  await runCommand(conn, missingRecipient, 'regalarpj', 'Owned Character + @5491111111111')
  assert.match(replies.at(-1).text, /Mencioná/, 'regalarpj exige mencionar al destinatario')
  await runCommand(conn, groupMessage(groupOne), 'offmudae', '', { isOwner: true })
  assert.equal((await readState(groupOne)).enabled, false, 'offmudae debe persistir')
  await runCommand(conn, groupMessage(groupOne), 'toppj')
  assert.match(replies.at(-1).text, /desactivado/, 'los comandos se bloquean al apagar Mudae')

  console.log('Todos los tests de Mudae pasaron')
} finally {
  await fs.rm(testDataDirectory, { recursive: true, force: true })
}

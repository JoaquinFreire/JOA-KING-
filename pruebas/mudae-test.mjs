import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Jimp from 'jimp'

const testDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'joa-king-mudae-test-'))
process.env.MUDAE_DATA_DIR = testDataDirectory
process.env.MUDAE_CATALOG_FILE = path.join(testDataDirectory, 'catalog.json')
process.env.BOT_ADDITIONAL_OWNERS_FILE = path.join(testDataDirectory, 'additional-owners.json')
global.owner = ['5493513117202']
global.ownerPrincipal = '5493513117202'

const {
  default: handler,
  MUDAE_CONFIG,
  getCloudinaryCredentials,
  getGiftRollProbability,
  hasQuotedMudaeImage,
  hasQuotedMudaeGif,
  scheduleGuessGameTimeout,
  renderGuessChallengeCard,
  makeCharacterIdentity,
  normalizeMudaeIdentity,
  normalizeMudaeLabel,
  parseMudaeParts,
} = await import('../plugins/mudae.js')
const { default: animeInfoHandler } = await import('../plugins/anime-infoanime.js')
const { default: legacySeriesHandler } = await import('../plugins/gacha-serielist.js')
const { default: ownerManagementHandler } = await import('../plugins/owner-management.js')
const { default: ownerContactHandler } = await import('../plugins/main-owner.js')
const { getAllOwnerNumbers, removeAdditionalOwner } = await import('../lib/owner-management.js')

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
const guessGroup = '120363000000000022@g.us'
const guessTimeoutGroup = '120363000000000023@g.us'
const paginationGroup = '120363000000000020@g.us'
const gpjsGroup = '120363000000000021@g.us'
const tradeGroup = '120363000000000016@g.us'
const rankingTestGroups = Array.from({ length: 4 }, (_, index) =>
  `1203630000000000${11 + index}@g.us`
)
const noAvailableGroup = '120363000000000015@g.us'
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
const readCatalog = async () => JSON.parse(await fs.readFile(process.env.MUDAE_CATALOG_FILE, 'utf8'))
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
const runOwnerCommand = (conn, m, command, text = '', extra = {}) => ownerManagementHandler(m, {
  conn,
  command,
  text,
  usedPrefix: '%',
  isPrimaryOwner: true,
  participants: [],
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
const randomForCharacter = (state, characterId) => {
  const rankedCharacters = [...state.characters].sort((first, second) =>
    Number(second.value || 0) - Number(first.value || 0)
  )
  const rankById = new Map(rankedCharacters.map((character, rank) => [character.id, rank]))
  const activeCharacterIds = new Set(state.activeRolls.filter((roll) => roll.expiresAt > Date.now()).map((roll) => roll.characterId))
  const weightedCharacters = state.characters
    .filter((character) => !activeCharacterIds.has(character.id))
    .map((character) => ({
      character,
      rank: rankById.get(character.id),
      weight: rankById.get(character.id) === 0 ? 0.5 : rankById.get(character.id) < 10 ? 0.6 : rankById.get(character.id) < 30 ? 0.8 : 1,
    }))
    .sort((first, second) => first.rank - second.rank)
  const targetIndex = weightedCharacters.findIndex((item) => item.character.id === characterId)
  assert.notEqual(targetIndex, -1, `el personaje ${characterId} debe estar disponible para el roll`)
  const totalWeight = weightedCharacters.reduce((total, item) => total + item.weight, 0)
  const targetPosition = weightedCharacters.slice(0, targetIndex).reduce((total, item) => total + item.weight, 0) +
    weightedCharacters[targetIndex].weight / 2
  return targetPosition / totalWeight
}

try {
  assert.equal(MUDAE_CONFIG.ROLL_COOLDOWN, 5000)
  assert.equal(MUDAE_CONFIG.ROLL_WEIGHT_TOP_1, 0.5)
  assert.equal(MUDAE_CONFIG.ROLL_WEIGHT_TOP_10, 0.6)
  assert.equal(MUDAE_CONFIG.ROLL_WEIGHT_TOP_30, 0.8)
  assert.equal(MUDAE_CONFIG.CLAIM_COOLDOWN, 60 * 60 * 1000)
  assert.equal(MUDAE_CONFIG.CLAIM_DURATION, 60 * 1000)
  assert.equal(MUDAE_CONFIG.VOTE_COOLDOWN, 24 * 60 * 60 * 1000)
  assert.equal(MUDAE_CONFIG.VOTE_VALUE_INCREMENT, 125)
  assert.equal(MUDAE_CONFIG.CLAIMED_VOTE_VALUE_INCREMENT, 50)
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
  assert.equal(hasQuotedMudaeGif({
    quoted: {
      mtype: 'videoMessage',
      mimetype: 'video/mp4',
      gifPlayback: true,
      download: async () => Buffer.from('gif'),
    },
  }), true, 'debe reconocer un GIF de WhatsApp citado')
  assert.equal(hasQuotedMudaeGif({
    quoted: { mtype: 'videoMessage', mimetype: 'video/mp4', gifPlayback: false },
  }), false, 'un video normal no debe marcarse como GIF especial')
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
      owner: index < 2 ? userTwo : `5491000000${String(index).padStart(3, '0')}@s.whatsapp.net`,
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
  await fs.writeFile(filenameFor(gpjsGroup), JSON.stringify(createState(gpjsGroup, {
    characters: Array.from({ length: 25 }, (_, index) => ({
      ...available,
      id: `gpjs-character-${index}`,
      name: `GPJS Character ${index}`,
      value: (index + 100) * 1_000_000,
      owner: index % 2 ? userTwo : null,
    })),
  })), 'utf8')
  await fs.writeFile(filenameFor(groupSeven), JSON.stringify(createState(groupSeven, {
    enabled: false,
    characters: [{ ...available, id: 'retired-character', name: 'Retired Character' }],
  })), 'utf8')
  await fs.writeFile(filenameFor(guessGroup), JSON.stringify(createState(guessGroup, {
    characters: [{ ...available }],
    voteCooldowns: { [userOne]: Date.now() + 24 * 60 * 60 * 1000 },
    pendingVotes: { [userOne]: true },
    guessGame: {
      characterId: available.id,
      challengeMessageId: 'GUESS-CHALLENGE-WIN',
      expiresAt: Date.now() + 60_000,
      lives: {},
    },
  })), 'utf8')
  await fs.writeFile(filenameFor(guessTimeoutGroup), JSON.stringify(createState(guessTimeoutGroup, {
    characters: [{ ...available }],
    guessGame: {
      characterId: available.id,
      challengeMessageId: 'GUESS-CHALLENGE-TIMEOUT',
      expiresAt: Date.now() - 1,
      lives: {},
    },
  })), 'utf8')
  await fs.writeFile(path.join(testDataDirectory, 'catalog.json'), JSON.stringify({
    version: 1,
    albums: [],
    characters: [],
    deletedCharacterIds: ['retired-character'],
  }), 'utf8')

  const { conn, sent, replies } = createConnection()
  const ownerCommandMessage = { chat: groupOne, sender: userOne, mentionedJid: [userTwo] }
  await runOwnerCommand(conn, ownerCommandMessage, 'addowner')
  assert.deepEqual(await getAllOwnerNumbers(), ['5493513117202', '5491222222222'])
  await ownerContactHandler(ownerCommandMessage, { conn, command: 'owners' })
  assert.equal(sent.at(-1).content.contacts.contacts.length, 2, '%owners debe enviar el contacto de cada owner')
  assert.ok(sent.at(-1).content.contacts.contacts.some(({ vcard }) => vcard.includes('waid=5493513117202')))
  assert.ok(sent.at(-1).content.contacts.contacts.some(({ vcard }) => vcard.includes('waid=5491222222222')))
  ownerCommandMessage.mentionedJid = ['5493513117202@s.whatsapp.net']
  await runOwnerCommand(conn, ownerCommandMessage, 'delowner')
  assert.match(replies.at(-1).text, /owner principal no se puede quitar/i)
  assert.ok((await getAllOwnerNumbers()).includes('5493513117202'), 'el owner principal nunca se debe poder quitar')
  ownerCommandMessage.mentionedJid = [userTwo]
  await runOwnerCommand(conn, ownerCommandMessage, 'delowner')
  assert.deepEqual(await getAllOwnerNumbers(), ['5493513117202'])
  await runOwnerCommand(conn, ownerCommandMessage, 'addowner', '', { isPrimaryOwner: false })
  assert.match(replies.at(-1).text, /Solo el owner principal/)
  assert.deepEqual(await getAllOwnerNumbers(), ['5493513117202'], 'solo el owner principal puede administrar owners')
  await runCommand(conn, groupMessage(groupSeven), 'rw')
  assert.match(replies.at(-1).text, /desactivado/, 'Mudae debe comenzar apagado')
  assert.ok(!(await readState(groupSeven)).characters.some((character) => character.id === 'retired-character'), 'un personaje borrado no debe volver desde un estado antiguo')
  await runCommand(conn, groupMessage(groupSeven), 'menumudae')
  assert.match(replies.at(-1).text, /%addpj/)
  assert.match(replies.at(-1).text, /%suertepj/)
  assert.match(replies.at(-1).text, /%cambiarpj <tuyo> \+ <del otro>/)
  assert.match(replies.at(-1).text, /%aceptarcambio/)
  assert.doesNotMatch(replies.at(-1).text, /variante/i)
  assert.match(replies.at(-1).text, /%votarpj/)
  assert.match(replies.at(-1).text, /%gpjs/)
  assert.match(replies.at(-1).text, /GIF especiales sin reclamar aparecen bloqueados/)
  assert.match(replies.at(-1).text, /%wishremove/)
  assert.match(replies.at(-1).text, /%addpj <álbum> \+ <nombre>/)
  assert.match(replies.at(-1).text, /imagen normal para agregar \(no acepta GIFs\)/)
  assert.doesNotMatch(replies.at(-1).text, /GIF para un especial/)
  assert.match(replies.at(-1).text, /125.*50.*ya está reclamado/)
  assert.match(replies.at(-1).text, /%overpj <nombre>/)
  assert.ok(handler.command.includes('toppj'))
  assert.ok(handler.command.includes('gpjs'))
  assert.ok(handler.command.includes('overpj'))
  assert.ok(handler.command.includes('ainfo'))
  assert.ok(handler.command.includes('editimpj'), 'editimpj debe funcionar como alias de editimgpj')
  assert.ok(!animeInfoHandler.command.includes('ainfo'))
  assert.ok(animeInfoHandler.command.includes('animedata'))
  assert.ok(!legacySeriesHandler.command.includes('ainfo'))
  assert.ok(!handler.command.includes('top'))
  assert.ok(handler.command.includes('menumudae'))
  assert.ok(handler.command.includes('adivinarpj'))
  assert.ok(!handler.command.includes('adivinardb'))
  assert.equal(MUDAE_CONFIG.GUESS_GAME_DURATION, 10 * 60 * 1000)
  const placeholderSilhouette = await Jimp.create(80, 80, 0xff101827)
  placeholderSilhouette.scan(20, 10, 40, 60, (_x, _y, index) => {
    placeholderSilhouette.bitmap.data[index] = 245
    placeholderSilhouette.bitmap.data[index + 1] = 245
    placeholderSilhouette.bitmap.data[index + 2] = 245
  })
  const challengeCard = await Jimp.read(await renderGuessChallengeCard(await placeholderSilhouette.getBufferAsync(Jimp.MIME_PNG)))
  assert.equal(challengeCard.bitmap.width, 900, 'el reto debe generar una tarjeta visual diseñada')
  assert.equal(challengeCard.bitmap.height, 1100)

  const winningGuess = groupMessage(guessGroup)
  winningGuess.text = 'Trunks'
  winningGuess.quoted = { id: 'GUESS-CHALLENGE-WIN' }
  await handler.all.call(conn, winningGuess, {})
  assert.equal((await readState(guessGroup)).guessVoteCredits[userOne], 1, 'ganar la ronda debe habilitar un voto extra')
  await runCommand(conn, groupMessage(guessGroup), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /VOTO REGISTRADO/, 'el crédito de la ronda permite votar durante el cooldown')
  assert.equal((await readState(guessGroup)).guessVoteCredits[userOne], undefined, 'el crédito se consume al emitir el voto')

  const expiredGuessState = await readState(guessTimeoutGroup)
  scheduleGuessGameTimeout(conn, expiredGuessState, expiredGuessState.guessGame)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal((await readState(guessTimeoutGroup)).guessGame, null, 'el temporizador cierra una ronda vencida sin esperar otra respuesta')
  assert.ok(sent.some(({ jid, content }) => jid === guessTimeoutGroup && /Trunks/.test(content.caption || '')), 'al vencer debe revelar el personaje en el grupo')

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
  assert.match(replies.at(-1).text, /1\.250/)
  assert.equal((await readState(groupTwo)).pendingVotes[userOne], true, 'un voto válido habilita una tirada')
  await runCommand(conn, groupMessage(groupTwo), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /voto pendiente/, 'no permite acumular votos pendientes')
  await runCommand(conn, groupMessage(groupTwo, userTwo), 'votarpj', 'Trunks')
  assert.match(replies.at(-1).text, /1\.375/, 'otro usuario puede emitir su propio voto')
  assert.equal((await readState(groupTwo)).characters[0].value, 1375)
  assert.equal(
    (await readCatalog()).characters.find((character) => character.id === 'character-1').value,
    1375,
    'los votos deben guardar el valor en el catálogo compartido'
  )
  await runCommand(conn, groupMessage(groupOne), 'addalbum', 'Dragon Ball Z', { isAdmin: true })
  assert.match(replies.at(-1).text, /ya existe/, 'debe rechazar álbum duplicado ignorando case')
  assert.deepEqual((await readState(groupOne)).albums, ['Dragon Ball Z'])
  await runCommand(conn, groupMessage(groupOne), 'addalbum', 'Other Album', { isAdmin: true })
  await runCommand(conn, groupMessage(groupOne), 'ainfo', 'Dragon Ball Z')
  assert.match(replies.at(-1).text, /PERSONAJES DE DRAGON BALL Z/)
  assert.match(replies.at(-1).text, /Trunks/, 'ainfo debe mostrar los personajes normales aunque no estén reclamados')
  assert.match(replies.at(-1).text, /\$1\.375/, 'ainfo debe mostrar el valor actualizado globalmente')
  assert.doesNotMatch(replies.at(-1).text, /Aún sin desbloquear/, 'ainfo no debe mostrar el estado de desbloqueo para personajes normales')
  assert.match(replies.at(-1).text, /Goku/)
  assert.match(replies.at(-1).text, /\$1\.500/, 'ainfo debe mostrar el valor de los personajes desbloqueados')
  assert.match(replies.at(-1).text, /👑 = reclamado/, 'ainfo debe explicar el indicador de dueño')
  assert.match(replies.at(-1).text, /Goku.*👑 5491222222222/, 'ainfo debe mostrar el número real después de la corona, sin etiquetar')
  assert.doesNotMatch(replies.at(-1).text, /Lo tiene:|@5491222222222/, 'ainfo no debe etiquetar al dueño')
  const originalGetName = conn.getName
  conn.getName = async (jid) => jid === userTwo ? 'Dueño de Goku' : originalGetName(jid)
  await runCommand(conn, groupMessage(groupOne), 'ainfo', 'Dragon Ball Z')
  assert.match(replies.at(-1).text, /Goku.*👑 Dueño de Goku/, 'ainfo debe mostrar el nombre del dueño después de la corona cuando está disponible')
  assert.doesNotMatch(replies.at(-1).text, /@5491222222222/, 'ainfo no debe mencionar al dueño aunque tenga nombre')
  conn.getName = originalGetName
  await runCommand(conn, groupMessage(groupOne), 'ainfo', 'Drágon Báll Z')
  assert.match(replies.at(-1).text, /PERSONAJES DE DRAGON BALL Z/, 'ainfo debe encontrar álbumes aunque la consulta tenga tildes')
  await runCommand(conn, groupMessage(groupOne), 'albumespj')
  assert.match(replies.at(-1).text, /Dragon Ball Z.*2 personajes/)
  assert.match(replies.at(-1).text, /Other Album.*0 personajes/)
  await runCommand(conn, groupMessage(groupOne), 'votarpj', 'Goku')
  assert.match(replies.at(-1).text, /VOTO REGISTRADO/)
  assert.match(replies.at(-1).text, /\(\+\$50, ya reclamado\)/, 'un personaje reclamado solo recibe 50 por voto')
  assert.equal(
    (await readState(groupOne)).characters.find((character) => character.id === 'character-2').value,
    1550,
    'el voto debe guardar el nuevo valor del personaje reclamado'
  )
  assert.equal(
    (await readCatalog()).characters.find((character) => character.id === 'character-2').value,
    1550,
    'los votos a personajes reclamados también deben actualizar el catálogo'
  )
  const bonusGroup = '120363000000000024@g.us'
  const acceptedSuggestion = {
    id: 'accepted-bonus-character',
    name: 'Accepted Bonus Character',
    album: 'Dragon Ball Z',
    value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
    imageUrl: 'https://res.cloudinary.com/example/image/upload/accepted-bonus.jpg',
    cloudinaryPublicId: 'mudae/test/accepted-bonus',
    mediaType: 'image',
    isGift: false,
    suggestedBy: userTwo,
    suggestedAt: Date.now(),
  }
  await fs.writeFile(filenameFor(bonusGroup), JSON.stringify(createState(bonusGroup, {
    characters: [secondCharacter],
    pendingCharacterSuggestions: [acceptedSuggestion],
  })), 'utf8')
  const suggestionDisplayGroup = '120363000000000025@g.us'
  const suggestedByLid = '207511361687632@lid'
  const originalGroupMetadata = conn.groupMetadata
  conn.groupMetadata = async () => ({
    participants: [{
      id: suggestedByLid,
      jid: `${userTwo}`,
      lid: suggestedByLid,
      phoneNumber: userTwo.split('@')[0],
    }],
  })
  await fs.writeFile(filenameFor(suggestionDisplayGroup), JSON.stringify(createState(suggestionDisplayGroup, {
    pendingCharacterSuggestions: [{
      ...acceptedSuggestion,
      suggestedBy: suggestedByLid,
    }],
  })), 'utf8')
  const originalSuggestionGetName = conn.getName
  conn.getName = async (jid) => jid === userTwo ? 'Usuario Sugeridor' : originalSuggestionGetName(jid)
  const sentBeforeSuggestions = sent.length
  await runCommand(conn, groupMessage(suggestionDisplayGroup), 'sugpj', '', { isOwner: true })
  const suggestionMessage = sent.slice(sentBeforeSuggestions).find(({ content }) => content.text?.includes('SUGERENCIAS PENDIENTES'))
  assert.match(suggestionMessage.content.text, /Sugirio: @5491222222222 \(Usuario Sugeridor\)/, 'sugpj debe mostrar el nombre y etiquetar al sugeridor')
  assert.deepEqual(suggestionMessage.content.mentions, [userTwo], 'sugpj debe mencionar al sugeridor de verdad')
  assert.doesNotMatch(suggestionMessage.content.text, /207511361687632/, 'sugpj no debe mostrar el LID')
  conn.getName = originalSuggestionGetName
  conn.groupMetadata = originalGroupMetadata
  await runCommand(conn, groupMessage(bonusGroup), 'aceptarpj', acceptedSuggestion.name, { isOwner: true })
  assert.equal(
    (await readCatalog()).characters.find((character) => character.id === 'character-2').value,
    1619,
    'el bonus de +69 por aceptar un personaje debe actualizar el catálogo'
  )
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
  const quotedGifCommand = groupMessage(groupOne)
  quotedGifCommand.quoted = {
    mtype: 'videoMessage',
    mimetype: 'video/mp4',
    gifPlayback: true,
    download: async () => Buffer.from('test gif'),
  }
  await runCommand(conn, quotedGifCommand, 'addpj', 'Dragon Ball Z + Special GIF', { isAdmin: true })
  assert.match(replies.at(-1).text, /no acepta GIFs/, 'addpj no debe aceptar GIFs aunque lo use un admin')
  await runCommand(conn, quotedGifCommand, 'addpj', 'Dragon Ball Z + Special GIF', { isOwner: true })
  assert.match(replies.at(-1).text, /no acepta GIFs/, 'addpj debe rechazar GIFs incluso para el owner')
  const repliedImageCommand = groupMessage(groupOne)
  repliedImageCommand.quoted = {
    mtype: 'imageMessage',
    mimetype: 'image/jpeg',
    download: async () => Buffer.from('test image'),
  }
  await runCommand(conn, repliedImageCommand, 'addpj', 'Other Album + Trunks', { isOwner: true })
  assert.match(replies.at(-1).text, /nombres deben ser unicos/, 'no permite repetir el nombre en otro álbum')
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
  assert.match(replies.at(-1).text, /\$1\.619/, 'pjs debe reflejar los aumentos compartidos desde otros grupos')
  await runCommand(conn, mentionedUser, 'pjs', '@5491222222222')
  assert.match(replies.at(-1).text, /PERSONAJES DE/)
  assert.match(replies.at(-1).text, /Goku/, 'pjs debe consultar la colección de la persona mencionada')
  assert.doesNotMatch(replies.at(-1).text, /T###|Trunks/, 'pjs solo debe listar los personajes que ya tiene esa persona')
  const formattedPhoneMention = groupMessage(groupOne)
  formattedPhoneMention.mentionedJid = Promise.resolve([])
  await runCommand(conn, formattedPhoneMention, 'pjs', '@+54 9 1222-222222')
  assert.match(replies.at(-1).text, /Goku/, 'pjs debe normalizar menciones numéricas argentinas con + y separadores')
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
  assert.match(replies.at(-1).text, /No encontre ese personaje/, 'un fragmento ambiguo debe responder que no encontró el personaje')
  await runCommand(conn, groupMessage(groupFour), 'verpj', 'Dragon Ball Z Kai + Trunks')
  assert.match(sent.at(-1).content.caption, /\*Trunks\*/, 'debe permitir resolver la ambigüedad')
  await runCommand(conn, groupMessage(groupFive), 'wish', 'tella')
  assert.match(replies.at(-1).text, /AGREGADO A TU WISHLIST/, 'wish debe aceptar una palabra parcial que no esté al comienzo del nombre')
  await runCommand(conn, groupMessage(groupTen), 'wish', 'Roll')
  assert.match(replies.at(-1).text, /No encontré ese personaje/, 'wish debe rechazar un fragmento que coincide con varios personajes')
  await runCommand(conn, groupMessage(groupTen), 'verpj', 'Roll')
  assert.match(replies.at(-1).text, /No encontre ese personaje/, 'verpj debe rechazar un fragmento que coincide con varios personajes')
  await runCommand(conn, groupMessage(groupOne), 'wish', 'Goku')
  assert.match(replies.at(-1).text, /WISHLIST/)
  await runCommand(conn, groupMessage(groupNine), 'cd')
  assert.match(replies.at(-1).text, /Tiradas RW: 10\/10 · necesitás votar/, 'cd debe conservar la cuenta real aunque falte votar')
  await runCommand(conn, groupMessage(groupOne), 'wishlist')
  assert.match(replies.at(-1).text, /Goku/)
  await runCommand(conn, groupMessage(groupSix), 'toppj')
  const rankMessage = sent.at(-1)
  assert.match(rankMessage.content.text, /TOP 10 JUGADORES/)
  assert.match(rankMessage.content.text, /Ranking por valor total/)
  assert.match(rankMessage.content.text, /👑 quien tiene más personajes/)
  assert.ok(
    rankMessage.content.text.indexOf('@5491000000011') < rankMessage.content.text.indexOf('@5491222222222'),
    'el ranking debe ordenar por valor total antes que cantidad de personajes'
  )
  assert.match(
    rankMessage.content.text.split('\n').find((line) => line.includes('@5491222222222')),
    /👑/,
    'el usuario con más personajes debe quedar resaltado aunque el ranking sea por valor'
  )
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
  const groupTenStateForRoll = await readState(groupTen)
  const groupTenAvailable = groupTenStateForRoll.characters.filter((character) => !character.owner)
  const originalRandom = Math.random
  Math.random = () => randomForCharacter(groupTenStateForRoll, 'wanted-roll')
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
  await runCommand(conn, groupMessage(groupTen), 'cd')
  assert.match(replies.at(-1).text, /Tiradas RW: 8\/10/, 'cd debe descontar cada tirada antes de agotar el cupo')
  const valueBeforeRepeatVote = groupTenStateAfterSecondRoll.characters.find((character) => character.id === 'wanted-roll').value
  await runCommand(conn, groupMessage(groupTen), 'votarpj', 'Wanted Roll')
  assert.match(replies.at(-1).text, /Ya votaste en las últimas 24 horas/, 'el cooldown del voto se mantiene aunque permita varias tiradas')
  assert.equal((await readState(groupTen)).characters.find((character) => character.id === 'wanted-roll').value, valueBeforeRepeatVote)

  const beforeRollMessages = sent.length
  const groupOneBeforeFirstRoll = await readState(groupOne)
  Math.random = () => randomForCharacter(groupOneBeforeFirstRoll, 'character-1')
  await runCommand(conn, groupMessage(groupOne), 'rw')
  Math.random = originalRandom
  assert.equal(sent.length, beforeRollMessages + 1, 'debe publicar roll con imagen')
  const rollMessage = sent.at(-1)
  assert.ok(rollMessage.content.image.url.includes('cloudinary.com'))
  const firstRollCharacterId = (await readState(groupOne)).activeRolls[0].characterId
  const firstRollCharacter = (await readState(groupOne)).characters.find((character) => character.id === firstRollCharacterId)
  assert.match(rollMessage.content.caption, new RegExp(firstRollCharacter.name))
  assert.match(rollMessage.content.caption, new RegExp(`\\*${firstRollCharacter.name}\\*`))
  assert.doesNotMatch(rollMessage.content.caption, /variante/i)
  assert.match((await readState(groupOne)).activeRolls[0].messageId, /^ROLL-/)

  const secondGroupOneCharacter = (await readState(groupOne)).characters.find((character) =>
    !character.owner && character.id !== 'character-1'
  )
  const groupOneBeforeSecondRoll = await readState(groupOne)
  Math.random = () => randomForCharacter(groupOneBeforeSecondRoll, secondGroupOneCharacter.id)
  await runCommandAfterRollCooldown(conn, groupMessage(groupOne), 'rw')
  Math.random = originalRandom
  const groupOneAfterSecondRoll = await readState(groupOne)
  assert.equal(groupOneAfterSecondRoll.activeRolls.length, 2, 'el grupo puede mostrar más de un personaje activo')
  assert.notEqual(groupOneAfterSecondRoll.activeRolls[1].characterId, groupOneAfterSecondRoll.activeRolls[0].characterId, 'un personaje activo no debe volver a salir inmediatamente')

  await handler.all.call(conn, groupMessage(groupOne))
  const reactionListener = conn.ev.listeners.get('messages.reaction')?.[0]
  assert.equal(typeof reactionListener, 'function', 'debe conectar el evento de reacciones')
  const subBotConnection = createConnection()
  subBotConnection.conn.user.jid = '5491333333333@s.whatsapp.net'
  global.conn = { user: { jid: botJid } }
  await handler.all.call(subBotConnection.conn, groupMessage(groupOne))
  assert.equal(
    subBotConnection.conn.ev.listeners.get('messages.reaction')?.length || 0,
    0,
    'los subbots no deben registrar listeners para responder reclamos'
  )
  delete global.conn

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
  assert.equal((await readState(groupOne)).characters.find((character) => character.id === firstRollCharacterId).owner, null, 'una reacción fromMe del bot no puede reclamar el roll')
  await reactionListener([{
    key: { remoteJid: groupOne, id: activeRollId, participant: botJid },
    reaction: { text: '❤️', key: { participant: botJid } },
  }])
  assert.equal((await readState(groupOne)).characters.find((character) => character.id === firstRollCharacterId).owner, null, 'el bot no puede reclamar aunque fromMe no esté marcado')
  await reactionListener([{
    key: { remoteJid: groupOne, id: activeRollId, participant: botJid },
    reaction: { text: '❤️', key: {} },
  }])
  assert.equal((await readState(groupOne)).characters.find((character) => character.id === firstRollCharacterId).owner, null, 'el autor del mensaje objetivo no debe confundirse con quien reaccionó')
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
  const claimedRollCharacter = claimed.characters.find((character) => character.id === firstRollCharacterId)
  assert.ok([userOne, userTwo].includes(claimedRollCharacter.owner), 'debe asignar el personaje a un ganador')
  assert.equal(claimed.activeRolls.length, 1, 'reclamar un personaje debe conservar otros rolls activos del grupo')
  assert.equal(claimed.activeRolls[0].characterId, groupOneAfterSecondRoll.activeRolls[1].characterId)
  assert.equal(claimed.activeRoll, null, 'debe cerrar el roll inmediatamente al reclamar')
  assert.equal(Object.keys(claimed.claimCounts).length, 1, 'solamente un usuario debe quedar registrado como ganador')
  assert.equal(Object.values(claimed.claimCounts)[0], 1, 'el ganador debe consumir un reclamo')
  const claimMessage = sent.find((message) => /¡Reclamado!/.test(message.content.text || ''))
  assert.ok(claimMessage, 'debe confirmar el reclamo')
  assert.ok(claimMessage.content.text.includes(`*${firstRollCharacter.name}*`))
  assert.match(claimMessage.content.text, /Dragon Ball Z/)
  assert.doesNotMatch(claimMessage.content.text, /variante/i)
  await runCommand(conn, groupMessage(groupOne, claimedRollCharacter.owner), 'cd')
  assert.match(replies.at(-1).text, /Reclamos: 1\/2/, 'cd debe contar el primer reclamo antes de activar el cooldown')
  assert.doesNotMatch(replies.at(-1).text, /Próxima tirada del grupo/, 'cd no debe mostrar el cooldown grupal de la próxima tirada')

  await runCommand(conn, groupMessage(groupOne), 'personajes')
  assert.ok(replies.at(-1).text.includes(firstRollCharacter.name))

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
  giftMessage.msg = { contextInfo: { mentionedJid: [userOne] } }
  await runCommand(conn, giftMessage, 'regalarpj', 'Owned Character')
  assert.match(sent.at(-1).content.text, /PERSONAJE REGALADO/, 'regalarpj debe aceptar una palabra parcial dentro del nombre')
  assert.equal((await readState(groupEight)).characters.find((character) => character.id === 'owned-character').owner, userOne, 'regalarpj transfiere la propiedad al mencionado')
  assert.deepEqual(sent.at(-1).content.mentions, [userOne], 'el regalo etiqueta al destinatario')

  const stateBeforeTrade = await readState(groupEight)
  const freeCharacterBeforeTrade = stateBeforeTrade.characters.find((character) => !character.owner)
  assert.ok(freeCharacterBeforeTrade, 'debe haber un personaje libre para probar el cambio')
  const originalTradeRandom = Math.random
  Math.random = () => 0
  await runCommand(conn, groupMessage(groupEight, userOne), 'suertepj', 'wned')
  Math.random = originalTradeRandom
  const tradedState = await readState(groupEight)
  assert.equal(tradedState.characters.find((character) => character.id === 'owned-character').owner, null, 'el personaje descartado debe quedar libre')
  assert.equal(tradedState.characters.find((character) => character.id === freeCharacterBeforeTrade.id).owner, userOne, 'el usuario debe recibir el personaje libre al azar')
  assert.equal(sent.at(-1).content.image.url, freeCharacterBeforeTrade.imageUrl, 'suertepj debe mostrar la imagen del nuevo personaje')
  assert.match(sent.at(-1).content.caption, new RegExp(freeCharacterBeforeTrade.name), 'suertepj debe anunciar el personaje recibido')
  assert.ok(tradedState.tradeCooldowns[userOne] > Date.now(), 'el cambio debe iniciar un cooldown de 12 horas')
  await runCommand(conn, groupMessage(groupEight, userOne), 'suertepj', freeCharacterBeforeTrade.name)
  assert.match(replies.at(-1).text, /volver a usar %suertepj/, 'el segundo cambio por suerte debe respetar el cooldown')

  await runCommand(conn, groupMessage(groupEight, userOne), 'quitarpj', 'Owned Character')
  const releasedCharacter = (await readState(groupEight)).characters.find((character) => character.id === 'owned-character')
  assert.equal(releasedCharacter.owner, null, 'quitarpj deja el personaje disponible')
  assert.equal(Object.hasOwn(releasedCharacter, 'claimedAt'), false, 'quitarpj limpia la fecha de reclamo')
  const missingRecipient = groupMessage(groupEight, userTwo)
  await runCommand(conn, missingRecipient, 'regalarpj', 'Owned Character')
  assert.match(replies.at(-1).text, /Mencioná/, 'regalarpj exige mencionar al destinatario')

  const tradeCharacters = [
    { ...available, id: 'trade-goku', name: 'Trade Goku', owner: userOne },
    { ...available, id: 'trade-vegeta', name: 'Trade Vegeta', owner: userTwo },
    { ...available, id: 'trade-open', name: 'Trade Open', owner: null },
  ]
  await fs.writeFile(filenameFor(tradeGroup), JSON.stringify(createState(tradeGroup, {
    characters: tradeCharacters,
  })), 'utf8')
  await runCommand(conn, groupMessage(tradeGroup), 'cambiarpj', 'Trade Goku + Trade Vegeta')
  assert.match(sent.at(-1).content.text, /PROPUESTA DE INTERCAMBIO/)
  assert.deepEqual(sent.at(-1).content.mentions, [userOne, userTwo], 'la propuesta debe mencionar a ambos dueños')
  const pendingTradeBeforeAttempt = (await readState(tradeGroup)).pendingTrade
  const responseCountBeforeUnauthorizedAccept = replies.length
  await runCommand(conn, groupMessage(tradeGroup, botJid), 'aceptarcambio')
  assert.equal(replies.length, responseCountBeforeUnauthorizedAccept, 'un usuario distinto al destinatario debe ignorarse silenciosamente')
  await runCommand(conn, groupMessage(tradeGroup, userTwo), 'cambiarpj', 'Trade Vegeta + Trade Goku')
  assert.match(replies.at(-1).text, /Ya hay un intercambio pendiente/, 'no se permite más de una propuesta simultánea')
  await runCommand(conn, groupMessage(tradeGroup, userTwo), 'aceptarcambio')
  const acceptedTrade = await readState(tradeGroup)
  assert.equal(acceptedTrade.characters.find((character) => character.id === 'trade-goku').owner, userTwo)
  assert.equal(acceptedTrade.characters.find((character) => character.id === 'trade-vegeta').owner, userOne)
  assert.equal(acceptedTrade.pendingTrade, null, 'aceptar debe cerrar la propuesta')
  assert.match(sent.at(-1).content.text, /INTERCAMBIO ACEPTADO/)

  await runCommand(conn, groupMessage(tradeGroup), 'cambiarpj', 'Trade Vegeta + Trade Goku')
  const nowBeforeTradeExpiry = Date.now
  Date.now = () => nowBeforeTradeExpiry() + 31 * 1000
  try {
    await runCommand(conn, groupMessage(tradeGroup, userTwo), 'aceptarcambio')
  } finally {
    Date.now = nowBeforeTradeExpiry
  }
  assert.equal((await readState(tradeGroup)).pendingTrade, null, 'una propuesta expirada debe eliminarse al intentar aceptarla')
  assert.match(replies.at(-1).text, /No hay una propuesta de intercambio vigente/)

  await runCommand(conn, groupMessage(tradeGroup), 'cambiarpj', 'Trade Vegeta + Trade Open')
  assert.match(replies.at(-1).text, /no tiene dueño/, 'no se puede intercambiar por un personaje sin dueño')
  assert.equal((await readState(tradeGroup)).pendingTrade, null, 'un personaje sin dueño no debe crear una propuesta')

  await runCommand(conn, groupMessage(groupOne), 'offmudae', '', { isOwner: true })
  assert.equal((await readState(groupOne)).enabled, false, 'offmudae debe persistir')
  await runCommand(conn, groupMessage(groupOne), 'toppj')
  assert.match(replies.at(-1).text, /desactivado/, 'los comandos se bloquean al apagar Mudae')

  const rankedCharacters = Array.from({ length: 35 }, (_, index) => ({
    ...available,
    id: `voted-character-${index + 1}`,
    name: `Ranked ${String(index + 1).padStart(2, '0')}`,
    value: 3500 - index * 10,
  }))
  for (const groupId of rankingTestGroups) {
    await fs.writeFile(filenameFor(groupId), JSON.stringify(createState(groupId, {
      characters: rankedCharacters,
      voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
    })), 'utf8')
  }
  const originalRankRandom = Math.random
  try {
    Math.random = () => 0
    await runCommand(conn, groupMessage(rankingTestGroups[0]), 'rw')
    assert.match(sent.at(-1).content.caption, /Ranked 01/, 'el puesto 1 debe usar su peso reducido')
    const rankedState = await readState(rankingTestGroups[0])
    const rankedForTest = [...rankedState.characters].sort((first, second) =>
      Number(second.value || 0) - Number(first.value || 0)
    )
    const weightByRank = rankedForTest.map((_, rank) => rank === 0 ? 0.5 : rank < 10 ? 0.6 : rank < 30 ? 0.8 : 1)
    const totalRankedWeight = weightByRank.reduce((total, weight) => total + weight, 0)
    const rankSelectionCases = [2, 11, 31]
    for (const [index, rank] of rankSelectionCases.entries()) {
      const position = weightByRank.slice(0, rank - 1).reduce((total, weight) => total + weight, 0) +
        weightByRank[rank - 1] / 2
      Math.random = () => position / totalRankedWeight
      await runCommand(conn, groupMessage(rankingTestGroups[index + 1]), 'rw')
      assert.match(
        sent.at(-1).content.caption,
        new RegExp(`Ranked ${String(rank).padStart(2, '0')}`),
        `el puesto ${rank} debe usar su peso de sorteo correspondiente`
      )
    }
  } finally {
    Math.random = originalRankRandom
  }

  const noAvailableCatalog = JSON.parse(await fs.readFile(process.env.MUDAE_CATALOG_FILE, 'utf8'))
  await fs.writeFile(filenameFor(noAvailableGroup), JSON.stringify(createState(noAvailableGroup, {
    characters: noAvailableCatalog.characters.map((character) => ({ ...character, owner: userTwo })),
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
  })), 'utf8')
  await runCommand(conn, groupMessage(noAvailableGroup), 'cd')
  assert.match(replies.at(-1).text, /Tiradas RW: 10\/10/, 'CD debe permitir tiradas cuando solo quedan personajes reclamados')
  const randomBeforeClaimedRoll = Math.random
  Math.random = () => 0
  await runCommand(conn, groupMessage(noAvailableGroup), 'rw')
  Math.random = randomBeforeClaimedRoll
  const claimedRollMessage = sent.at(-1)
  assert.match(claimedRollMessage.content.caption, /Reclamado por:/, 'el roll debe indicar quién tiene el personaje')
  assert.match(claimedRollMessage.content.caption, /no se puede reclamar/, 'un personaje reclamado debe salir sin poder reclamarse')
  assert.doesNotMatch(claimedRollMessage.content.caption, /vence en 1 minuto/i, 'un personaje reclamado no debe mostrar espera para reclamarlo')
  const claimedRollState = await readState(noAvailableGroup)
  const claimedRollCharacterId = claimedRollState.activeRolls.at(-1).characterId
  const previousClaimCount = claimedRollState.claimCounts[userOne] || 0
  await handler.processReaction(conn, {
    key: { remoteJid: noAvailableGroup, id: claimedRollState.activeRolls.at(-1).messageId },
    reaction: { text: '❤️', key: { participant: userOne } },
  })
  const afterClaimedRollReaction = await readState(noAvailableGroup)
  assert.equal(afterClaimedRollReaction.characters.find((character) => character.id === claimedRollCharacterId).owner, userTwo, 'una reacción no debe transferir un personaje ya reclamado')
  assert.equal(afterClaimedRollReaction.claimCounts[userOne] || 0, previousClaimCount, 'un roll ya reclamado no debe consumir un reclamo')
  assert.equal(afterClaimedRollReaction.activeRolls.length, 0, 'la reacción a un personaje ya reclamado debe cerrar el roll')

  const sharedCatalog = JSON.parse(await fs.readFile(process.env.MUDAE_CATALOG_FILE, 'utf8'))
  sharedCatalog.albums.push('Shared Sync Test')
  sharedCatalog.characters.push({
    id: 'shared-sync-character',
    name: 'Shared Sync Character',
    album: 'Shared Sync Test',
    value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
    imageUrl: 'https://res.cloudinary.com/example/image/upload/shared-sync.jpg',
    cloudinaryPublicId: 'mudae/test/shared-sync',
    createdAt: Date.now(),
  })
  await fs.writeFile(process.env.MUDAE_CATALOG_FILE, JSON.stringify(sharedCatalog), 'utf8')
  await runCommand(conn, groupMessage(groupTwo), 'ainfo', 'Shared Sync Test')
  assert.match(replies.at(-1).text, /Shared Sync Character/, 'un personaje normal debe aparecer en el álbum aunque no esté reclamado')
  assert.equal(
    (await readState(groupTwo)).characters.find((character) => character.id === 'shared-sync-character').owner,
    null,
    'sincronizar el catálogo no debe mezclar los reclamos entre grupos'
  )

  const gifCatalog = JSON.parse(await fs.readFile(process.env.MUDAE_CATALOG_FILE, 'utf8'))
  gifCatalog.albums.push('Special GIF Album')
  gifCatalog.characters.push({
    id: 'special-gif-character',
    name: 'Special GIF Character',
    album: 'Special GIF Album',
    value: 2_000_000,
    imageUrl: 'https://res.cloudinary.com/example/video/upload/special-gif.mp4',
    cloudinaryPublicId: 'mudae/test/special-gif',
    mediaType: 'video',
    isGift: true,
    createdAt: Date.now(),
  })
  await fs.writeFile(process.env.MUDAE_CATALOG_FILE, JSON.stringify(gifCatalog), 'utf8')
  const giftGroup = '120363000000000017@g.us'
  const otherGiftGroup = '120363000000000022@g.us'
  await fs.writeFile(filenameFor(giftGroup), JSON.stringify(createState(giftGroup, {
    characters: [{
      ...available,
      id: 'gift-group-regular',
      name: 'Gift Group Regular',
      value: 999999,
    }],
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
  })), 'utf8')
  await fs.writeFile(filenameFor(otherGiftGroup), JSON.stringify(createState(otherGiftGroup)), 'utf8')
  await runCommand(conn, groupMessage(giftGroup), 'ainfo', 'Special GIF Album')
  assert.match(replies.at(-1).text, /🔒 \*Bloqueado\* — GIF oculto/, 'ainfo debe ocultar los gifts que todavía no fueron reclamados')
  assert.doesNotMatch(replies.at(-1).text, /Special GIF Character/, 'ainfo no debe revelar el nombre de un gift bloqueado')
  await runCommand(conn, groupMessage(giftGroup), 'gpjs')
  assert.match(replies.at(-1).text, /1\. 🔒 \*Bloqueado\*.*\$2\.000\.000/, 'gpjs debe conservar el puesto por valor y ocultar el nombre del gift disponible')
  assert.doesNotMatch(replies.at(-1).text, /Special GIF Character/, 'gpjs no debe revelar el nombre del gift disponible')
  await runCommand(conn, groupMessage(otherGiftGroup), 'ainfo', 'Special GIF Album')
  assert.match(replies.at(-1).text, /🔒 \*Bloqueado\* — GIF oculto/, 'cada grupo empieza viendo el gift bloqueado')
  assert.doesNotMatch(replies.at(-1).text, /Special GIF Character/)
  assert.equal(MUDAE_CONFIG.GIFT_ROLL_PROBABILITY, 0.01)
  assert.equal(MUDAE_CONFIG.GIFT_CHARACTER_VALUE, 6767)
  const totalGiftChance = getGiftRollProbability(3)
  assert.equal(totalGiftChance, 0.01, 'el grupo de GIFs tiene un tope total de 1%')
  assert.equal(getGiftRollProbability(100), MUDAE_CONFIG.GIFT_ROLL_PROBABILITY, 'el chance total de GIFs nunca supera 1%')
  assert.equal(getGiftRollProbability(3, 0), totalGiftChance, 'la chance especial no depende de los personajes normales libres')
  assert.equal(getGiftRollProbability(0), 0, 'sin GIFs no debe reservarse probabilidad especial')
  await runCommand(conn, groupMessage(giftGroup), 'verpj', 'Special GIF Character')
  assert.match(replies.at(-1).text, /GIF está oculto hasta que alguien lo reclame/)
  assert.match(replies.at(-1).text, /\$2\.000\.000/)
  await runCommand(conn, groupMessage(giftGroup), 'overpj', 'Special GIF Character')
  assert.match(replies.at(-1).text, /Solo el owner/, 'un usuario normal no puede usar overpj')
  await runCommand(conn, groupMessage(giftGroup), 'overpj', 'Special GIF Character', { isOwner: true })
  assert.equal(sent.at(-1).content.video.url, 'https://res.cloudinary.com/example/video/upload/special-gif.mp4')
  assert.equal(sent.at(-1).content.gifPlayback, true)
  const originalGiftRandom = Math.random
  const originalGiftTimeout = global.setTimeout
  Math.random = () => 0.001
  global.setTimeout = (callback, milliseconds, ...args) =>
    originalGiftTimeout(callback, milliseconds === MUDAE_CONFIG.GIFT_REVEAL_DELAY ? 0 : milliseconds, ...args)
  try {
    const sentBeforeGiftRoll = sent.length
    await runCommand(conn, groupMessage(giftGroup), 'rw')
    assert.equal(sent.length, sentBeforeGiftRoll + 2, 'el GIF debe anunciarse y revelarse en dos mensajes')
    assert.match(sent.at(-2).content.text, /PERSONAJE CON IMAGEN OCULTA DESBLOQUEADO/)
    assert.match(sent.at(-2).content.text, /5 segundos/)
    assert.equal(sent.at(-1).content.video.url, 'https://res.cloudinary.com/example/video/upload/special-gif.mp4')
    assert.match(sent.at(-1).content.caption, /\$2\.000\.000/)
  } finally {
    Math.random = originalGiftRandom
    global.setTimeout = originalGiftTimeout
  }
  const giftRoll = (await readState(giftGroup)).activeRolls.at(-1)
  await handler.processReaction(conn, {
    key: { remoteJid: giftGroup, id: giftRoll.messageId },
    reaction: { text: '❤️', key: { participant: userOne } },
  })
  assert.equal(
    (await readState(giftGroup)).characters.find((character) => character.id === 'special-gif-character').owner,
    userOne,
    'la reacción debe reclamar el GIF asociado al mensaje que revela el video'
  )
  assert.equal(
    (await readState(otherGiftGroup)).characters.find((character) => character.id === 'special-gif-character').owner,
    null,
    'reclamar un GIF en un grupo no debe desbloquearlo en otro grupo'
  )
  await runCommand(conn, groupMessage(otherGiftGroup), 'ainfo', 'Special GIF Album')
  assert.match(replies.at(-1).text, /🔒 \*Bloqueado\* — GIF oculto/)
  assert.doesNotMatch(replies.at(-1).text, /Special GIF Character/)
  await runCommand(conn, groupMessage(otherGiftGroup), 'gpjs')
  assert.match(replies.at(-1).text, /🔒 \*Bloqueado\*.*\$2\.000\.000/)
  assert.doesNotMatch(replies.at(-1).text, /Special GIF Character/)
  await runCommand(conn, groupMessage(giftGroup), 'verpj', 'Special GIF Character')
  assert.equal(sent.at(-1).content.video.url, 'https://res.cloudinary.com/example/video/upload/special-gif.mp4')

  const regularRollGroup = '120363000000000018@g.us'
  await fs.writeFile(filenameFor(regularRollGroup), JSON.stringify(createState(regularRollGroup, {
    characters: [{ ...available, id: 'regular-roll-character', name: 'Regular Roll Character', value: 12000 }],
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
  })), 'utf8')
  Math.random = () => 0.5
  try {
    await runCommand(conn, groupMessage(regularRollGroup), 'rw')
  } finally {
    Math.random = originalGiftRandom
  }
  assert.ok(sent.at(-1).content.image, 'la rama normal debe seguir enviando imágenes estáticas')
  assert.doesNotMatch(sent.at(-1).content.caption, /Special GIF Character/, 'los GIF deben quedar fuera del ranking normal')

  const onlyActiveRegularGroup = '120363000000000019@g.us'
  const normalCharactersForAvailabilityTest = (await readState(regularRollGroup)).characters
    .filter((character) => !character.isGift && character.mediaType !== 'video')
  await fs.writeFile(filenameFor(onlyActiveRegularGroup), JSON.stringify(createState(onlyActiveRegularGroup, {
    characters: [
      ...normalCharactersForAvailabilityTest.map((character) => ({ ...character, owner: userTwo })),
      {
        id: 'waiting-special-gif',
        name: 'Waiting Special GIF',
        album: 'Special GIF Album',
        value: MUDAE_CONFIG.GIFT_CHARACTER_VALUE,
        imageUrl: 'https://res.cloudinary.com/example/video/upload/waiting-gif.mp4',
        cloudinaryPublicId: 'mudae/test/waiting-gif',
        mediaType: 'video',
        isGift: true,
      },
    ],
    activeRolls: [
      ...normalCharactersForAvailabilityTest.map((character, index) => ({
        messageId: `ACTIVE-CATALOG-ROLL-${index}`,
        characterId: character.id,
        expiresAt: Date.now() + MUDAE_CONFIG.CLAIM_DURATION,
      })),
    ],
    voteCooldowns: { [userOne]: Date.now() + MUDAE_CONFIG.VOTE_COOLDOWN },
  })), 'utf8')
  const beforeNoRegularRoll = sent.length
  const originalNoStandardRandom = Math.random
  const originalNoStandardTimeout = global.setTimeout
  let noStandardRandomCalls = 0
  Math.random = () => noStandardRandomCalls++ === 0 ? 0.005 : 0
  global.setTimeout = (callback, milliseconds, ...args) =>
    originalNoStandardTimeout(callback, milliseconds === MUDAE_CONFIG.GIFT_REVEAL_DELAY ? 0 : milliseconds, ...args)
  try {
    await runCommand(conn, groupMessage(onlyActiveRegularGroup), 'rw')
  } finally {
    Math.random = originalNoStandardRandom
    global.setTimeout = originalNoStandardTimeout
  }
  assert.equal(sent.length, beforeNoRegularRoll + 2, 'un GIF mantiene su probabilidad reducida aunque los personajes normales estén activos')
  assert.equal(sent.at(-1).content.video.url, 'https://res.cloudinary.com/example/video/upload/special-gif.mp4')

  const paginatedCharacters = Array.from({ length: 205 }, (_, index) => ({
    id: `page-character-${String(index + 1).padStart(3, '0')}`,
    name: `Character ${String(index + 1).padStart(3, '0')}`,
    album: 'Pagination Album',
    value: 1000,
    imageUrl: `https://res.cloudinary.com/example/image/upload/character-${index + 1}.jpg`,
    owner: '207511361687632@lid',
  }))
  await fs.writeFile(filenameFor(paginationGroup), JSON.stringify(createState(paginationGroup, {
    albums: ['Pagination Album'],
    characters: paginatedCharacters,
  })))
  const paginationMessage = groupMessage(paginationGroup)
  paginationMessage.mentionedJid = ['207511361687632@lid']
  const repliesBeforeFirstPage = replies.length
  await runCommand(conn, paginationMessage, 'pjs', '@5491222222222')
  assert.equal(replies.length, repliesBeforeFirstPage + 1, 'una consulta debe enviar solo una parte por mensaje')
  assert.match(replies.at(-1).text, /Parte 1 de 3/)
  assert.match(replies.at(-1).text, /Character 100/)
  assert.doesNotMatch(replies.at(-1).text, /Character 101/)
  assert.match(replies.at(-1).text, /%pjs 2 @5491222222222/, 'la primera parte debe indicar cómo pedir la siguiente para esa persona')
  assert.match(replies.at(-1).text, /PERSONAJES DE 5491222222222/, 'pjs debe mostrar el número real en vez del identificador LID')
  assert.doesNotMatch(replies.at(-1).text, /207511361687632/, 'pjs no debe mostrar el identificador LID en el nombre')
  assert.doesNotMatch(replies.at(-1).text, /@207511361687632/, 'la paginación no debe exponer el identificador interno tipo LID')
  await runCommand(conn, paginationMessage, 'personajes', '2 @5491222222222')
  assert.match(replies.at(-1).text, /Parte 2 de 3/)
  assert.match(replies.at(-1).text, /Character 101/)
  assert.match(replies.at(-1).text, /Character 200/)
  assert.doesNotMatch(replies.at(-1).text, /Character 201/)
  await runCommand(conn, paginationMessage, 'pjs', '3 @5491222222222')
  assert.match(replies.at(-1).text, /Parte 3 de 3/)
  assert.match(replies.at(-1).text, /Character 201/)
  assert.match(replies.at(-1).text, /Character 205/)
  assert.equal(replies.at(-1).text.includes('%pjs 4'), false, 'la última parte no debe sugerir una página siguiente')

  await runCommand(conn, groupMessage(gpjsGroup), 'gpjs')
  const characterRanking = replies.at(-1).text
  assert.match(characterRanking, /TOP 20 PERSONAJES POR VALOR/)
  assert.match(characterRanking, /1\. \*Gpjs Character 24\*.*✨ Disponible/)
  assert.match(characterRanking, /2\. \*Gpjs Character 23\*.*🔒 Reclamado/)
  assert.match(characterRanking, /20\. \*Gpjs Character 5\*/)
  assert.doesNotMatch(characterRanking, /Gpjs Character 4\*/)
  assert.equal(
    characterRanking.split('\n').filter((line) => /^\d+\. \*/.test(line)).length,
    20,
    'gpjs debe mostrar exactamente los 20 personajes más valiosos, reclamados o disponibles'
  )

  console.log('Todos los tests de Mudae pasaron')
} finally {
  await fs.rm(testDataDirectory, { recursive: true, force: true })
}

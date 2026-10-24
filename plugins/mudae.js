import crypto from 'crypto'
import { readFileSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import fetch from 'node-fetch'
import { Blob, FormData } from 'formdata-node'
import Jimp from 'jimp'
import { beginCommandExecution } from '../lib/command-execution.js'

export const MUDAE_CONFIG = Object.freeze({
  ROLL_COOLDOWN: 5000,
  ROLL_LIMIT: 10,
  ROLL_EXHAUSTED_COOLDOWN: 30 * 60 * 1000,
  ROLL_WEIGHT_TOP_1: 0.5,
  ROLL_WEIGHT_TOP_10: 0.6,
  ROLL_WEIGHT_TOP_30: 0.8,
  CLAIM_LIMIT: 2,
  CLAIM_COOLDOWN: 60 * 60 * 1000,
  CLAIM_DURATION: 60 * 1000,
  GIFT_ROLL_PROBABILITY: 0.01,
  GIFT_CHARACTER_VALUE: 6767,
  GIFT_REVEAL_DELAY: 5000,
  TRADE_COOLDOWN: 12 * 60 * 60 * 1000,
  VOTE_COOLDOWN: 24 * 60 * 60 * 1000,
  VOTE_VALUE_INCREMENT: 125,
  CLAIMED_VOTE_VALUE_INCREMENT: 50,
  WISHLIST_LIMIT: 3,
  DEFAULT_CHARACTER_VALUE: 1000,
  GUESS_GAME_LIVES: 3,
  GUESS_GAME_DURATION: 10 * 60 * 1000,
})

const loadLocalEnv = () => {
  let pendingKey = ''
  try {
    for (const rawLine of readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (assignment) {
        pendingKey = assignment[1]
        if (process.env[pendingKey] === undefined) process.env[pendingKey] = assignment[2].replace(/^['"]|['"]$/g, '')
        continue
      }
      if (pendingKey && process.env[pendingKey] !== undefined) process.env[pendingKey] += line.replace(/^['"]|['"]$/g, '')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[MUDAE] No se pudo leer .env:', error?.message || error)
  }
}

loadLocalEnv()

const legacyDataDirectory = path.join(process.cwd(), 'data', 'mudae')
const configuredDataDirectory = process.env.MUDAE_DATA_DIR
const dataDirectory = configuredDataDirectory || path.join(legacyDataDirectory, 'instances', os.hostname().toLowerCase())
const catalogFile = process.env.MUDAE_CATALOG_FILE || (
  configuredDataDirectory
    ? path.join(dataDirectory, 'catalog.json')
    : path.join(legacyDataDirectory, 'catalog.json')
)
const migrateLegacyState = !configuredDataDirectory
const groupLocks = new Map()
const stateCache = new Map()
const stateLoads = new Map()
let catalogLock = Promise.resolve()
let catalogCache = null
let catalogFileSignature = null
let catalogLoad = null
const reactionListenerSymbol = Symbol.for('joa-king.mudae.reaction-listener')
const guessGameTimers = new Map()

export const normalizeMudaeIdentity = (value) => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('es')
export const normalizeMudaeLabel = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('es')
  .replace(/(^|\s)(\p{L})/gu, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase('es')}`)
const normalizeJid = (jid) => String(jid || '').trim().replace(/:\d+(?=@)/, '').toLowerCase()
const isGroupJid = (jid) => typeof jid === 'string' && jid.endsWith('@g.us')
const getStateFile = (groupId) => path.join(dataDirectory, `group-${crypto.createHash('sha256').update(groupId).digest('hex')}.json`)
const getLegacyStateFile = (groupId) => path.join(legacyDataDirectory, path.basename(getStateFile(groupId)))
const defaultState = (groupId) => ({
  groupId,
  enabled: false,
  albums: [],
  characters: [],
  pendingCharacterSuggestions: [],
  users: {},
  rollCounts: {},
  rollCooldowns: {},
  claimCounts: {},
  claimCooldowns: {},
  tradeCooldowns: {},
  voteCooldowns: {},
  pendingVotes: {},
  guessVoteCredits: {},
  lastRollAt: 0,
  activeRolls: [],
  pendingTrade: null,
  guessGame: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
const defaultCatalog = () => ({
  version: 1,
  albums: [],
  characters: [],
  deletedCharacterIds: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const withCatalogLock = async (operation) => {
  const previous = catalogLock
  let release
  catalogLock = new Promise((resolve) => { release = resolve })
  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
  }
}

const normalizeCatalogCharacter = (character) => {
  const name = normalizeMudaeLabel(character?.name || character?.nombre)
  const album = normalizeMudaeLabel(character?.album)
  const imageUrl = String(character?.imageUrl || character?.imagen || '').trim()
  const cloudinaryPublicId = String(character?.cloudinaryPublicId || '').trim()
  const mediaType = character?.mediaType === 'video' || character?.isGift ? 'video' : 'image'
  return {
    id: String(character?.id || crypto.randomUUID()),
    name,
    album,
    value: Number(character?.value || MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE),
    imageUrl,
    cloudinaryPublicId,
    mediaType,
    isGift: mediaType === 'video',
    createdAt: Number(character?.createdAt || Date.now()),
  }
}

const findCatalogCharacterIndex = (catalog, character) => {
  const identity = makeCharacterIdentity(character?.album, character?.name || character?.nombre)
  return catalog.characters.findIndex((item) => makeCharacterIdentity(item.album, item.name) === identity)
}

const loadCatalog = async () => {
  let fileSignature
  try {
    const stat = await fs.stat(catalogFile)
    fileSignature = `${stat.mtimeMs}:${stat.size}`
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`No se pudo revisar el catálogo global de Mudae: ${error.message}`)
    fileSignature = null
  }
  if (catalogCache && fileSignature === catalogFileSignature) return catalogCache
  if (catalogLoad) return catalogLoad
  catalogCache = null
  catalogLoad = (async () => {
    let catalog
    try {
      catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`No se pudo leer el catálogo global de Mudae: ${error.message}`)
      catalog = defaultCatalog()
    }
    catalog = { ...defaultCatalog(), ...catalog }
    if (!Array.isArray(catalog.albums) || !Array.isArray(catalog.characters)) {
      throw new Error('El catálogo global de Mudae no tiene una estructura válida.')
    }

    let migrated = false
    if (!Array.isArray(catalog.deletedCharacterIds)) {
      catalog.deletedCharacterIds = []
      migrated = true
    }
    const deletedCharacterIds = [...new Set(catalog.deletedCharacterIds.map((id) => String(id || '').trim()).filter(Boolean))]
    if (JSON.stringify(deletedCharacterIds) !== JSON.stringify(catalog.deletedCharacterIds)) migrated = true
    catalog.deletedCharacterIds = deletedCharacterIds
    const albums = []
    for (const album of catalog.albums) {
      const normalized = normalizeMudaeLabel(album)
      if (!normalized) {
        migrated = true
        continue
      }
      if (!albums.some((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(normalized))) {
        albums.push(normalized)
      } else {
        migrated = true
      }
      if (normalized !== album) migrated = true
    }

    const characters = []
    for (const character of catalog.characters) {
      const normalized = normalizeCatalogCharacter(character)
      if (!normalized.name || !normalized.album || !normalized.imageUrl) {
        migrated = true
        continue
      }
      if (!albums.some((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(normalized.album))) {
        albums.push(normalized.album)
        migrated = true
      }
      if (!characters.some((item) => makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(normalized.album, normalized.name))) {
        characters.push(normalized)
      } else {
        migrated = true
      }
      if (JSON.stringify(normalized) !== JSON.stringify(character)) migrated = true
    }

    catalog.albums = albums
    catalog.characters = characters
    if (migrated) await saveCatalog(catalog)
    else {
      catalogCache = catalog
      const stat = await fs.stat(catalogFile).catch((error) => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      catalogFileSignature = stat ? `${stat.mtimeMs}:${stat.size}` : null
    }
    return catalog
  })()
  try {
    return await catalogLoad
  } finally {
    if (catalogLoad) catalogLoad = null
  }
}

const saveCatalog = async (catalog) => {
  await fs.mkdir(path.dirname(catalogFile), { recursive: true })
  catalog.updatedAt = Date.now()
  const temporaryFile = `${catalogFile}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryFile, catalogFile)
    catalogCache = catalog
    const stat = await fs.stat(catalogFile)
    catalogFileSignature = `${stat.mtimeMs}:${stat.size}`
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {})
    catalogCache = null
    catalogFileSignature = null
    throw new Error(`No se pudo guardar el catálogo global de Mudae: ${error.message}`)
  }
}

const addCatalogAlbum = (catalog, album) => {
  const normalized = normalizeMudaeLabel(album)
  if (!normalized) return null
  const existing = catalog.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(normalized))
  if (existing) return existing
  catalog.albums.push(normalized)
  return normalized
}

const upsertCatalogCharacter = (catalog, character) => {
  const normalized = normalizeCatalogCharacter(character)
  if (!normalized.name || !normalized.album || !normalized.imageUrl) return { character: null, added: false }
  if (catalog.deletedCharacterIds.includes(normalized.id)) return { character: null, added: false }
  addCatalogAlbum(catalog, normalized.album)
  const index = findCatalogCharacterIndex(catalog, normalized)
  if (index >= 0) return { character: catalog.characters[index], added: false }
  catalog.characters.push(normalized)
  return { character: normalized, added: true }
}

const syncStateWithCatalog = (state, catalog) => {
  let migrated = false
  const previousCharacters = Array.isArray(state.characters) ? state.characters : []
  const previousById = new Map(previousCharacters.map((character) => [character.id, character]))
  const nextCharacters = []

  const previousAlbums = Array.isArray(state.albums) ? state.albums : []
  const nextAlbums = [...catalog.albums]
  if (
    previousAlbums.length !== nextAlbums.length ||
    previousAlbums.some((album, index) => normalizeMudaeIdentity(album) !== normalizeMudaeIdentity(nextAlbums[index]))
  ) migrated = true
  state.albums = nextAlbums

  for (const catalogCharacter of catalog.characters) {
    const previous = previousById.get(catalogCharacter.id) ||
      previousCharacters.find((character) =>
        makeCharacterIdentity(character.album, character.name) === makeCharacterIdentity(catalogCharacter.album, catalogCharacter.name)
      )
    const next = {
      ...catalogCharacter,
        value: Number(catalogCharacter.value || MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE),
      owner: previous?.owner ? normalizeJid(previous.owner) : null,
    }
    if (previous?.claimedAt) next.claimedAt = previous.claimedAt
    nextCharacters.push(next)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) migrated = true
  }

  if (previousCharacters.length !== nextCharacters.length) migrated = true
  state.characters = nextCharacters
  const validIds = new Set(nextCharacters.map((character) => character.id))
  for (const user of Object.values(state.users || {})) {
    if (!Array.isArray(user?.wishlist)) continue
    const nextWishlist = user.wishlist.filter((id) => validIds.has(id))
    if (nextWishlist.length !== user.wishlist.length) migrated = true
    user.wishlist = nextWishlist
  }
  const activeRolls = Array.isArray(state.activeRolls)
    ? state.activeRolls
    : state.activeRoll ? [state.activeRoll] : []
  const validRolls = activeRolls.filter((roll) => validIds.has(roll.characterId))
  if (validRolls.length !== activeRolls.length || !Array.isArray(state.activeRolls) || state.activeRoll) {
    state.activeRolls = validRolls
    delete state.activeRoll
    migrated = true
  }
  return migrated
}

const withGroupLock = async (groupId, operation) => {
  const previous = groupLocks.get(groupId) || Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  const tail = previous.catch(() => {}).then(() => current)
  groupLocks.set(groupId, tail)
  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
    if (groupLocks.get(groupId) === tail) groupLocks.delete(groupId)
  }
}

const loadState = async (groupId) => {
  const cached = stateCache.get(groupId)
  if (cached) {
    const catalog = await loadCatalog()
    if (syncStateWithCatalog(cached, catalog)) await saveState(cached)
    return cached
  }
  const pending = stateLoads.get(groupId)
  if (pending) return pending
  const loading = (async () => {
    let state
    let migrated = false
    try {
      state = JSON.parse(await fs.readFile(getStateFile(groupId), 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`No se pudo leer el estado de Mudae: ${error.message}`)
      if (migrateLegacyState) {
        try {
          state = JSON.parse(await fs.readFile(getLegacyStateFile(groupId), 'utf8'))
          migrated = true
        } catch (legacyError) {
          if (legacyError?.code !== 'ENOENT') {
            throw new Error(`No se pudo migrar el estado anterior de Mudae: ${legacyError.message}`)
          }
        }
      }
      if (!state) state = defaultState(groupId)
    }
    if (!state || typeof state !== 'object' || state.groupId !== groupId) {
      throw new Error('El archivo de Mudae tiene un grupo inválido o está dañado.')
    }
    state = { ...defaultState(groupId), ...state }
    if (!Array.isArray(state.pendingCharacterSuggestions)) {
      state.pendingCharacterSuggestions = []
      migrated = true
    }
    if (!Array.isArray(state.albums) || !Array.isArray(state.characters) || !state.users || typeof state.users !== 'object') {
      throw new Error('El archivo de Mudae no tiene una estructura válida.')
    }
    if (!Array.isArray(state.activeRolls) || (state.activeRoll && !state.activeRolls.length)) {
      state.activeRolls = state.activeRoll ? [state.activeRoll] : []
      delete state.activeRoll
      migrated = true
    }
    state.activeRolls = state.activeRolls
      .filter((roll) => roll && typeof roll.messageId === 'string' && typeof roll.characterId === 'string' && Number.isFinite(Number(roll.expiresAt)))
      .map((roll) => ({ ...roll, expiresAt: Number(roll.expiresAt) }))
    for (const key of ['rollCounts', 'rollCooldowns', 'claimCounts', 'claimCooldowns', 'tradeCooldowns', 'voteCooldowns', 'pendingVotes']) {
      if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
        state[key] = {}
        migrated = true
      }
    }
    state.lastRollAt = Number(state.lastRollAt || 0)
    state.albums = state.albums.map((album) => {
      const normalized = normalizeMudaeLabel(album)
      if (normalized !== album) migrated = true
      return normalized
    })
    state.characters = state.characters.map((character) => {
      const album = normalizeMudaeLabel(character.album)
      const name = normalizeMudaeLabel(character.name)
      const normalizedCharacter = { ...character, album, name }
      if (normalizedCharacter.owner) normalizedCharacter.owner = normalizeJid(normalizedCharacter.owner)
      if (album !== character.album || name !== character.name || Object.hasOwn(character, 'variant')) migrated = true
      delete normalizedCharacter.variant
      return normalizedCharacter
    })
    const catalog = await withCatalogLock(async () => {
      const currentCatalog = await loadCatalog()
      let catalogMigrated = false
      for (const album of state.albums) {
        const before = currentCatalog.albums.length
        addCatalogAlbum(currentCatalog, album)
        if (currentCatalog.albums.length !== before) catalogMigrated = true
      }
      for (const character of state.characters) {
        const result = upsertCatalogCharacter(currentCatalog, character)
        if (result.added) catalogMigrated = true
      }
      if (catalogMigrated) await saveCatalog(currentCatalog)
      return currentCatalog
    })
    if (syncStateWithCatalog(state, catalog)) migrated = true
    if (migrated) await saveState(state)
    else stateCache.set(groupId, state)
    return state
  })()
  stateLoads.set(groupId, loading)
  try {
    return await loading
  } finally {
    if (stateLoads.get(groupId) === loading) stateLoads.delete(groupId)
  }
}

const saveState = async (state) => {
  await fs.mkdir(dataDirectory, { recursive: true })
  state.updatedAt = Date.now()
  const file = getStateFile(state.groupId)
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryFile, file)
    stateCache.set(state.groupId, state)
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {})
    stateCache.delete(state.groupId)
    throw new Error(`No se pudo guardar el estado de Mudae: ${error.message}`)
  }
}

const formatMoney = (value) => `$${Number(value || 0).toLocaleString('es-AR')}`
export const makeCharacterIdentity = (album, name) => [album, name].map(normalizeMudaeIdentity).join('\u0000')
const getRollWeight = (rank) => rank === 0
  ? MUDAE_CONFIG.ROLL_WEIGHT_TOP_1
  : rank < 10
    ? MUDAE_CONFIG.ROLL_WEIGHT_TOP_10
    : rank < 30
      ? MUDAE_CONFIG.ROLL_WEIGHT_TOP_30
      : 1
export const getGiftRollProbability = (giftCount) =>
  Number(giftCount) > 0 ? MUDAE_CONFIG.GIFT_ROLL_PROBABILITY : 0
const findCharacter = (state, query) => {
  const parts = String(query || '').split('+').map((part) => part.trim())
  const normalized = normalizeMudaeIdentity(query)
  if (!normalized) return { character: null, matches: [] }
  const exactMatches = parts.length === 2 && parts.every(Boolean)
    ? state.characters.filter((character) =>
      makeCharacterIdentity(character.album, character.name) === makeCharacterIdentity(...parts)
    )
    : state.characters.filter((character) => normalizeMudaeIdentity(character.name) === normalized)
  if (exactMatches.length) {
    return { character: exactMatches.length === 1 ? exactMatches[0] : null, matches: exactMatches }
  }
  if (parts.length !== 1) return { character: null, matches: [] }
  const partialMatches = state.characters.filter((character) =>
    normalizeMudaeIdentity(character.name).includes(normalized)
  )
  return partialMatches.length === 1
    ? { character: partialMatches[0], matches: partialMatches }
    : { character: null, matches: [] }
}

const findPendingCharacterSuggestions = (state, query) => {
  const parts = String(query || '').split('+').map((part) => part.trim())
  const normalized = normalizeMudaeIdentity(query)
  if (!normalized) return []
  const suggestions = Array.isArray(state.pendingCharacterSuggestions) ? state.pendingCharacterSuggestions : []
  if (parts.length === 2 && parts.every(Boolean)) {
    return suggestions.filter((item) => makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(...parts))
  }
  const exact = suggestions.filter((item) => normalizeMudaeIdentity(item.name) === normalized)
  if (exact.length) return exact
  return suggestions.filter((item) => normalizeMudaeIdentity(item.name).includes(normalized))
}

const updateCatalogCharacterValue = async (state, characterId, amount) => withCatalogLock(async () => {
  const catalog = await loadCatalog()
  const catalogCharacter = catalog.characters.find((character) => character.id === characterId)
  if (!catalogCharacter) throw new Error('El personaje ya no existe en el catálogo global.')
  catalogCharacter.value = Number(catalogCharacter.value || 0) + amount
  await saveCatalog(catalog)
  syncStateWithCatalog(state, catalog)
  return state.characters.find((character) => character.id === characterId)
})

const adjustInventoryValue = async (state, jid, amount, chooseHighest) => {
  const owned = state.characters.filter((character) => normalizeJid(character.owner) === jid)
  if (!owned.length) return null
  owned.sort((left, right) => {
    const valueDifference = Number(left.value || 0) - Number(right.value || 0)
    if (valueDifference) return chooseHighest ? -valueDifference : valueDifference
    return left.name.localeCompare(right.name, 'es')
  })
  return updateCatalogCharacterValue(state, owned[0].id, amount)
}

export const getCloudinaryCredentials = () => {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim()
  const environmentCredentials = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    apiKey: process.env.CLOUDINARY_API_KEY?.trim(),
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim(),
  }
  let urlCredentials = {}
  if (cloudinaryUrl) {
    let parsed
    try {
      parsed = new URL(cloudinaryUrl)
    } catch {
      throw new Error('CLOUDINARY_URL no tiene un formato válido.')
    }
    if (parsed.protocol !== 'cloudinary:' || !parsed.hostname || !parsed.username || !parsed.password) {
      throw new Error('CLOUDINARY_URL debe tener el formato cloudinary://api_key:api_secret@cloud_name.')
    }
    urlCredentials = {
      cloudName: parsed.hostname,
      apiKey: decodeURIComponent(parsed.username),
      apiSecret: decodeURIComponent(parsed.password),
    }
  }
  const hasCompleteEnvironmentCredentials = Object.values(environmentCredentials).every(Boolean)
  const credentials = hasCompleteEnvironmentCredentials ? environmentCredentials : urlCredentials
  if (!credentials.cloudName || !credentials.apiKey || !credentials.apiSecret) {
    throw new Error('Configura CLOUDINARY_URL o CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET para administrar imágenes.')
  }
  return credentials
}

const makeCloudinarySignature = (parameters, apiSecret) => {
  const signedParameters = Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join('&')
  return crypto.createHash('sha1').update(`${signedParameters}${apiSecret}`).digest('hex')
}

const makeMudaeCloudinaryPublicId = (source = '') => {
  const hash = crypto.createHash('sha256').update(String(source || crypto.randomUUID())).digest('hex').slice(0, 32)
  return `catalog/${hash}`
}

const uploadCloudinaryMedia = async ({ file, mimeType, filename, publicId, mediaType = 'image' }) => {
  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials()
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'mudae'
  const resourceType = mediaType === 'video' ? 'video' : 'image'
  const parameters = { folder, public_id: publicId, timestamp }
  if (resourceType === 'image') parameters.format = 'webp'
  const signature = makeCloudinarySignature(parameters, apiSecret)
  const form = new FormData()
  if (Buffer.isBuffer(file)) {
    form.set('file', new Blob([file], { type: mimeType || (resourceType === 'video' ? 'video/mp4' : 'image/jpeg') }), filename || (resourceType === 'video' ? 'character-gif.mp4' : 'character-image'))
  } else {
    form.set('file', String(file || ''))
  }
  form.set('api_key', apiKey)
  form.set('timestamp', String(timestamp))
  form.set('folder', folder)
  if (resourceType === 'image') form.set('format', 'webp')
  form.set('public_id', publicId)
  form.set('signature', signature)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.secure_url || !result.public_id) {
    const message = result.error?.message || `Cloudinary rechazó el medio (HTTP ${response.status}).`
    if (/invalid signature/i.test(message)) {
      throw new Error(`${message} Verificá que CLOUDINARY_URL o las tres variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET pertenezcan a la misma cuenta, y que el API secret siga vigente.`)
    }
    throw new Error(message)
  }
  return { imageUrl: result.secure_url, cloudinaryPublicId: result.public_id }
}

const uploadCharacterImage = async (buffer, mimeType) => uploadCloudinaryMedia({
  file: buffer,
  mimeType,
  filename: 'character-image.webp',
  publicId: makeMudaeCloudinaryPublicId(),
})
const uploadCharacterGif = async (buffer, mimeType) => uploadCloudinaryMedia({
  file: buffer,
  mimeType: mimeType || 'video/mp4',
  filename: 'character-gif.mp4',
  publicId: makeMudaeCloudinaryPublicId(),
  mediaType: 'video',
})

export const uploadRemoteMudaeImage = async (imageUrl, source = imageUrl) => uploadCloudinaryMedia({
  file: imageUrl,
  publicId: makeMudaeCloudinaryPublicId(source),
})

const deleteCloudinaryMedia = async (publicId, mediaType = 'image') => {
  if (!publicId) return
  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials()
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = makeCloudinarySignature({ invalidate: true, public_id: publicId, timestamp }, apiSecret)
  const form = new URLSearchParams({
    public_id: publicId,
    invalidate: 'true',
    api_key: apiKey,
    timestamp: String(timestamp),
    signature,
  })
  const resourceType = mediaType === 'video' ? 'video' : 'image'
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !['ok', 'not found'].includes(result.result)) {
    const message = result.error?.message || `Cloudinary no pudo borrar ${publicId} (HTTP ${response.status}).`
    if (/invalid signature/i.test(message)) {
      throw new Error(`${message} Verificá que CLOUDINARY_URL o las tres variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET pertenezcan a la misma cuenta, y que el API secret siga vigente.`)
    }
    throw new Error(message)
  }
}

const quoteIsImage = (quoted) => {
  return quoted?.mtype === 'imageMessage' ||
    quoted?.mediaType === 'imageMessage' ||
    quoted?.mimetype?.startsWith('image/') ||
    quoted?.mediaMessage?.imageMessage?.mimetype?.startsWith('image/')
}

export const parseMudaeParts = (text, count) => {
  const parts = String(text || '').split('+').map((part) => normalizeMudaeLabel(part))
  return parts.length === count && parts.every(Boolean) ? parts : null
}

const getQuotedImage = (m) => {
  const quoted = m.quoted
  const quotedContent = quoted?.mediaMessage?.imageMessage
    ? { media: quoted.mediaMessage.imageMessage, download: () => quoted.download?.() }
    : quoteIsImage(quoted)
      ? { media: quoted, download: () => quoted.download?.() }
      : null
  if (quotedContent) return quotedContent

  let content = m.msg?.contextInfo?.quotedMessage ||
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.message?.imageMessage?.contextInfo?.quotedMessage
  while (content && typeof content === 'object') {
    if (content.imageMessage) {
      return { media: content.imageMessage, download: null }
    }
    const wrapper = content.ephemeralMessage || content.documentWithCaptionMessage
    if (!wrapper?.message) break
    content = wrapper.message
  }
  return null
}

const getMudaeImage = (m) => {
  const currentType = m?.mtype || m?.mediaType
  const currentImage = m?.msg?.imageMessage || m?.message?.imageMessage
  if (currentType === 'imageMessage' || currentImage) {
    return {
      media: currentImage || m.msg,
      download: () => m.download?.(),
    }
  }
  return getQuotedImage(m)
}

const makeMudaeSilhouette = async (imageUrl) => {
  let sourceUrl = String(imageUrl || '')
  try {
    const url = new URL(sourceUrl)
    if (url.hostname === 'res.cloudinary.com' && url.pathname.includes('/image/upload/')) {
      url.pathname = url.pathname.replace('/image/upload/', '/image/upload/f_png/').replace(/\.webp$/i, '.png')
      sourceUrl = url.toString()
    }
  } catch {}

  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`No se pudo descargar la imagen del personaje (HTTP ${response.status}).`)
  const buffer = await response.buffer()
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('La imagen supera el tamaño permitido para el juego.')

  const image = await Jimp.read(buffer)
  image.scaleToFit(640, 640)
  const { data, width, height } = image.bitmap
  const pixelCount = width * height
  const backgroundSamples = []
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    const offset = (y * width + x) * 4
    if (data[offset + 3] > 12) backgroundSamples.push([data[offset], data[offset + 1], data[offset + 2]])
  }
  const matchesBackground = (offset) => {
    if (data[offset + 3] <= 12) return true
    return backgroundSamples.some(([red, green, blue]) => {
      const dr = data[offset] - red
      const dg = data[offset + 1] - green
      const db = data[offset + 2] - blue
      return dr * dr + dg * dg + db * db <= 52 * 52 * 3
    })
  }

  const background = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let readIndex = 0
  let writeIndex = 0
  const addIfBackground = (pixel) => {
    if (pixel < 0 || pixel >= pixelCount || background[pixel]) return
    const offset = pixel * 4
    if (!matchesBackground(offset)) return
    background[pixel] = 1
    queue[writeIndex++] = pixel
  }
  for (let x = 0; x < width; x++) {
    addIfBackground(x)
    addIfBackground((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    addIfBackground(y * width)
    addIfBackground(y * width + width - 1)
  }
  while (readIndex < writeIndex) {
    const pixel = queue[readIndex++]
    const x = pixel % width
    if (x > 0) addIfBackground(pixel - 1)
    if (x + 1 < width) addIfBackground(pixel + 1)
    if (pixel >= width) addIfBackground(pixel - width)
    if (pixel + width < pixelCount) addIfBackground(pixel + width)
  }

  image.scan(0, 0, width, height, (x, y, offset) => {
    const pixel = y * width + x
    const isBackground = background[pixel] || data[offset + 3] <= 12
    const color = isBackground ? 0xff : 0x12
    data[offset] = color
    data[offset + 1] = color
    data[offset + 2] = color
    data[offset + 3] = 255
  })
  return image.getBufferAsync(Jimp.MIME_PNG)
}

export const renderGuessChallengeCard = async (silhouetteBuffer) => {
  const silhouette = await Jimp.read(silhouetteBuffer)
  const width = 900
  const height = 1100
  const card = await Jimp.create(width, height, 0xff101827)
  card.scan(0, 0, width, height, (_x, y, index) => {
    const blend = Math.round(18 + 34 * (y / height))
    card.bitmap.data[index] = 12 + blend / 3
    card.bitmap.data[index + 1] = 17 + blend / 2
    card.bitmap.data[index + 2] = 34 + blend
  })
  const accent = await Jimp.create(8, 170, 0xffc084fc)
  card.composite(accent, 70, 74)
  const titleFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE)
  const subtitleFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)
  card.print(titleFont, 105, 85, { text: '¿QUIÉN ES ESTE PERSONAJE?', alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT }, 700, 45)
  card.print(subtitleFont, 106, 145, 'ADIVINÁ · 3 VIDAS · 10 MINUTOS')

  const panel = await Jimp.create(760, 760, 0xff1b2638)
  card.composite(panel, 70, 260)
  silhouette.contain(650, 650)
  card.composite(silhouette, Math.round((width - silhouette.bitmap.width) / 2), 315)
  const footerFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)
  card.print(footerFont, 80, 1050, 'Respondé citando esta imagen · Si acertás, podés volver a votar', 740, 30)
  return card.getBufferAsync(Jimp.MIME_PNG)
}

const makeGuessChallengeCard = async (imageUrl) => renderGuessChallengeCard(await makeMudaeSilhouette(imageUrl))

const getQuotedMessageId = (m) => m?.quoted?.id || m?.quoted?.key?.id ||
  m?.msg?.contextInfo?.stanzaId || m?.message?.extendedTextMessage?.contextInfo?.stanzaId || ''

const revealGuessGame = async (conn, state, game, winner = '') => {
  const timer = guessGameTimers.get(state.groupId)
  if (timer) clearTimeout(timer)
  guessGameTimers.delete(state.groupId)
  const character = state.characters.find((item) => item.id === game.characterId)
  state.guessGame = null
  if (winner) {
    state.guessVoteCredits = state.guessVoteCredits && typeof state.guessVoteCredits === 'object' ? state.guessVoteCredits : {}
    state.guessVoteCredits[winner] = Number(state.guessVoteCredits[winner] || 0) + 1
  }
  await saveState(state)
  if (!character) return conn.reply(state.groupId, 'Terminó la ronda, pero el personaje ya no está en el catálogo.', null)
  const winLine = winner
    ? `🎉 @${winner.split('@')[0]} adivinó correctamente y ganó la ronda. Puede volver a votar con *%votarpj*.`
    : '⏰ Se terminó la ronda. ¡Acá está la respuesta:'
  return conn.sendMessage(state.groupId, {
    image: { url: character.imageUrl },
    caption: `${winLine}\n\n🎴 *${character.name}*\n📚 ${character.album}`,
    mentions: winner ? [winner] : [],
  })
}

export const scheduleGuessGameTimeout = (conn, state, game) => {
  const previous = guessGameTimers.get(state.groupId)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    withGroupLock(state.groupId, async () => {
      const current = await loadState(state.groupId)
      if (!current.guessGame || current.guessGame.challengeMessageId !== game.challengeMessageId) return
      if (Number(current.guessGame.expiresAt) > Date.now()) {
        scheduleGuessGameTimeout(conn, current, current.guessGame)
        return
      }
      await revealGuessGame(conn, current, current.guessGame)
    }).catch((error) => console.error('[MUDAE] No se pudo cerrar automáticamente la ronda:', error?.stack || error))
  }, Math.max(0, Number(game.expiresAt) - Date.now()))
  timer.unref?.()
  guessGameTimers.set(state.groupId, timer)
}

const startGuessGame = async (m, conn, state) => {
  const existing = state.guessGame
  if (existing && Number(existing.expiresAt) > Date.now()) {
    return conn.reply(m.chat, `Ya hay una ronda activa. Respondan a la imagen con su intento. Cada persona empieza con ${MUDAE_CONFIG.GUESS_GAME_LIVES} vidas.`, m)
  }
  if (existing) await revealGuessGame(conn, state, existing)

  const candidates = state.characters.filter((character) =>
    character?.imageUrl && !character.isGift && character.mediaType !== 'video'
  )
  if (!candidates.length) return conn.reply(m.chat, 'Todavía no hay personajes con imágenes normales para iniciar el juego.', m)
  const character = candidates[Math.floor(Math.random() * candidates.length)]
  const challengeImage = await makeGuessChallengeCard(character.imageUrl)
  const challenge = await conn.sendMessage(m.chat, {
    image: challengeImage,
    mimetype: 'image/png',
    caption: `🔎 *¿QUIÉN ES ESTE PERSONAJE?*\n\nRespondé a esta imagen con tu intento. Cada jugador tiene *${MUDAE_CONFIG.GUESS_GAME_LIVES} vidas*; cada error consume una.\n\n🏆 Quien acierte gana y puede volver a votar con *%votarpj*.\n⏳ Tenés *10 minutos* para adivinar.`,
  }, { quoted: m })
  state.guessGame = {
    characterId: character.id,
    challengeMessageId: challenge?.key?.id || '',
    startedAt: Date.now(),
    expiresAt: Date.now() + MUDAE_CONFIG.GUESS_GAME_DURATION,
    lives: {},
  }
  await saveState(state)
  scheduleGuessGameTimeout(conn, state, state.guessGame)
  return challenge
}

const processGuessGameMessage = async (conn, m) => {
  if (!isGroupJid(m?.chat) || m?.fromMe || m?.key?.fromMe || typeof m.text !== 'string') return
  if (/^[\u200e\u200f]*[%@&#]/.test(m.text.trim())) return
  const quotedMessageId = getQuotedMessageId(m)
  if (!quotedMessageId || !getActorJid(m)) return
  await withGroupLock(m.chat, async () => {
    const state = await loadState(m.chat)
    const game = state.guessGame
    if (!game || quotedMessageId !== game.challengeMessageId) return
    if (Number(game.expiresAt) <= Date.now()) {
      return revealGuessGame(conn, state, game)
    }

    const actor = getActorJid(m)
    const remainingLives = Number.isInteger(game.lives?.[actor])
      ? game.lives[actor]
      : MUDAE_CONFIG.GUESS_GAME_LIVES
    if (remainingLives <= 0) {
      return conn.reply(m.chat, `Te quedaste sin vidas en esta ronda. El resto puede seguir intentando.`, m)
    }

    const character = state.characters.find((item) => item.id === game.characterId)
    if (!character) {
      state.guessGame = null
      await saveState(state)
      return conn.reply(m.chat, 'Se canceló la ronda porque el personaje ya no está en el catálogo.', m)
    }
    if (normalizeMudaeIdentity(m.text) === normalizeMudaeIdentity(character.name)) {
      return revealGuessGame(conn, state, game, actor)
    }

    game.lives[actor] = remainingLives - 1
    await saveState(state)
    const remaining = game.lives[actor]
    const name = await getDisplayName(conn, actor)
    return conn.reply(m.chat, remaining
      ? `❌ *${name}*, no era ese. Te quedan *${remaining}/${MUDAE_CONFIG.GUESS_GAME_LIVES} vidas*.`
      : `❌ *${name}*, no era ese. Te quedaste sin vidas; el resto puede seguir intentando.`, m)
  })
}

export const hasQuotedMudaeImage = (m) => Boolean(getQuotedImage(m))

const getQuotedGif = (m) => {
  const quoted = m.quoted
  const quotedVideo = quoted?.mediaMessage?.videoMessage ||
    quoted?.videoMessage ||
    (quoted?.mtype === 'videoMessage' || quoted?.mediaType === 'videoMessage' || quoted?.mimetype?.startsWith('video/')
      ? quoted
      : null)
  if (quotedVideo?.gifPlayback) {
    return {
      media: quotedVideo,
      download: () => quoted?.download?.(),
    }
  }

  let content = m.msg?.contextInfo?.quotedMessage ||
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.message?.videoMessage?.contextInfo?.quotedMessage
  while (content && typeof content === 'object') {
    if (content.videoMessage?.gifPlayback) return { media: content.videoMessage, download: null }
    const wrapper = content.ephemeralMessage || content.documentWithCaptionMessage
    if (!wrapper?.message) break
    content = wrapper.message
  }
  return null
}

export const hasQuotedMudaeGif = (m) => Boolean(getQuotedGif(m))

const requireGroup = (m) => isGroupJid(m.chat)
const getActorJid = (m) => normalizeJid(m.sender || m.key?.participant || '')
const isAdminOrOwner = (isOwner, isAdmin) => Boolean(isOwner || isAdmin)
const getMentionedJids = async (m, conn, text) => {
  const directMentions = await m.mentionedJid
  const contextMentions = m.msg?.contextInfo?.mentionedJid ||
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    m.msg?.extendedTextMessage?.contextInfo?.mentionedJid ||
    []
  const parsedMentions = typeof conn.parseMention === 'function' ? conn.parseMention(text) : []
  return [...new Set([
    ...(Array.isArray(directMentions) ? directMentions : directMentions ? [directMentions] : []),
    ...(Array.isArray(contextMentions) ? contextMentions : []),
    ...(Array.isArray(parsedMentions) ? parsedMentions : []),
  ].map(normalizeJid).filter(Boolean))]
}
const getMentionTarget = async (m, conn, text) => {
  const mentions = await getMentionedJids(m, conn, text)
  if (mentions.length) return mentions[0]
  const number = String(text || '').match(/@(\+?[\d\s().-]{7,25})/)
  const digits = number?.[1].replace(/\D/g, '')
  return digits ? `${digits}@s.whatsapp.net` : getActorJid(m)
}

const getDisplayName = async (conn, jid, fallback = '') => {
  try {
    const name = await conn.getName?.(jid)
    if (name) return name
  } catch (error) {
    console.warn(`[MUDAE] No se pudo resolver el nombre de ${jid}:`, error?.message || error)
  }
  return fallback || jid.split('@')[0]
}

const isPhoneNumberLabel = (value) => {
  const label = String(value || '').trim()
  return /^\+?[\d\s().-]+$/.test(label) && label.replace(/\D/g, '').length >= 7
}

const getPhoneNumber = (value) => {
  const candidate = String(value || '').trim()
  if (candidate.includes('@') && !candidate.endsWith('@s.whatsapp.net')) return ''
  const digits = candidate.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15 ? digits : ''
}

const createGroupUserDisplayResolver = (conn, groupId) => {
  let participantsPromise
  const displayCache = new Map()
  const getParticipants = async () => {
    if (!participantsPromise) {
      participantsPromise = (async () => {
        if (typeof conn.groupMetadata !== 'function') return []
        try {
          const metadata = await conn.groupMetadata(groupId)
          return metadata?.participants || []
        } catch (error) {
          console.warn(`[MUDAE] No se pudieron resolver los participantes de ${groupId}:`, error?.message || error)
          return []
        }
      })()
    }
    return participantsPromise
  }

  return async (jid, fallbackPhone = '') => {
    const normalizedJid = normalizeJid(jid)
    if (displayCache.has(normalizedJid)) return displayCache.get(normalizedJid)

    let resolvedJid = normalizedJid
    if (normalizedJid.endsWith('@lid')) {
      const participants = await getParticipants()
      const participant = participants.find((item) =>
        [item.id, item.jid, item.lid].some((candidate) => normalizeJid(candidate) === normalizedJid)
      )
      const participantPhone = getPhoneNumber(participant?.phoneNumber) ||
        getPhoneNumber(participant?.jid) ||
        getPhoneNumber(participant?.id)
      if (participantPhone) {
        resolvedJid = `${participantPhone}@s.whatsapp.net`
      } else {
        try {
          const userInfo = global.lidResolver?.getUserInfo?.(normalizedJid.split('@')[0])
          const cachedJid = typeof userInfo?.jid === 'string' &&
            !userInfo.jid.endsWith('@lid') &&
            !userInfo.notFound &&
            !userInfo.error
            ? userInfo.jid
            : ''
          const resolved = cachedJid || await global.lidResolver?.resolveLid?.(normalizedJid, groupId, 2)
          if (resolved && !String(resolved).endsWith('@lid')) resolvedJid = normalizeJid(resolved)
        } catch (error) {
          console.warn(`[MUDAE] No se pudo resolver el número real de ${normalizedJid}:`, error?.message || error)
        }
      }
    }

    const phoneNumber = getPhoneNumber(resolvedJid) || getPhoneNumber(fallbackPhone)
    let name = ''
    for (const candidate of [normalizedJid, resolvedJid]) {
      if (!candidate) continue
      try {
        const value = await conn.getName?.(candidate)
        if (value && !isPhoneNumberLabel(value)) {
          name = String(value).trim()
          break
        }
      } catch (error) {
        console.warn(`[MUDAE] No se pudo resolver el nombre de ${candidate}:`, error?.message || error)
      }
    }

    const mentionJid = phoneNumber
      ? `${phoneNumber}@s.whatsapp.net`
      : resolvedJid.endsWith('@s.whatsapp.net') ? resolvedJid : ''
    const display = { label: name || phoneNumber || 'Usuario', phoneNumber, mentionJid }
    displayCache.set(normalizedJid, display)
    return display
  }
}

const sendLongText = async (conn, chat, text, quoted, mentions = []) => {
  const lines = text.split('\n')
  let chunk = ''
  const sendChunk = async (content) => {
    const chunkMentions = mentions.filter((jid) => content.includes(`@${jid.split('@')[0]}`))
    if (chunkMentions.length) {
      await conn.sendMessage(chat, { text: content, mentions: chunkMentions }, { quoted })
    } else {
      await conn.reply(chat, content, quoted)
    }
  }
  for (const line of lines) {
    const next = chunk ? `${chunk}\n${line}` : line
    if (next.length > 3500 && chunk) {
      await sendChunk(chunk)
      chunk = line
    } else {
      chunk = next
    }
  }
  if (chunk) await sendChunk(chunk)
}

const ensureEnabled = async (m, conn) => {
  const state = await loadState(m.chat)
  if (!state.enabled) {
    await conn.reply(m.chat, 'Mudae está desactivado en este grupo. Un owner puede activarlo con %onmudae.', m)
    return null
  }
  return state
}

const replyAmbiguous = async (conn, m, matches) => {
  const lines = matches.map((character) => `• *${character.name}* — ${character.album}`)
  return conn.reply(m.chat, `Coincide en más de un álbum. Indicá álbum y personaje:\n${lines.join('\n')}`, m)
}

const buildCharacterInfo = async (conn, character) => {
  const owner = character.owner ? await getDisplayName(conn, character.owner) : 'Disponible'
  return `🎴 *${character.name}*\n📚 *Álbum:* ${character.album}\n💰 *Valor:* ${formatMoney(character.value)}\n👑 *Dueño:* ${character.owner ? `@${character.owner.split('@')[0]}` : 'Disponible'}`
}

const getReactionSender = (conn, update) => {
  const reactionKey = update?.reaction?.key
  if (reactionKey?.fromMe) return ''
  const candidate = reactionKey?.participant || (
    reactionKey?.remoteJid && !reactionKey.remoteJid.endsWith('@g.us')
      ? reactionKey.remoteJid
      : ''
  )
  if (typeof candidate !== 'string' || !candidate || candidate.endsWith('@g.us')) return ''
  const botJids = [
    conn.user?.jid,
    conn.user?.id,
    conn.user?.lid,
    conn.decodeJid?.(conn.user?.jid),
    conn.decodeJid?.(conn.user?.id),
    conn.decodeJid?.(conn.user?.lid),
  ].filter(Boolean).map(normalizeJid)
  const senderJids = [candidate, conn.decodeJid?.(candidate)].filter(Boolean).map(normalizeJid)
  if (senderJids.some((jid) => botJids.includes(jid))) return ''
  return senderJids[0] || ''
}

const processReaction = async (conn, update) => {
  const primaryJid = normalizeJid(global.conn?.user?.jid)
  if (primaryJid && normalizeJid(conn?.user?.jid) !== primaryJid) return
  const groupId = update?.key?.remoteJid
  const messageId = update?.key?.id
  const reactionText = String(update?.reaction?.text || '').replace(/\uFE0F/g, '')
  const userJid = getReactionSender(conn, update)
  if (!isGroupJid(groupId) || !messageId || reactionText !== '\u2764' || !userJid) return

  await withGroupLock(groupId, async () => {
    const state = await loadState(groupId)
    const now = Date.now()
    const rollIndex = state.activeRolls.findIndex((item) => item.messageId === messageId)
    const roll = rollIndex >= 0 ? state.activeRolls[rollIndex] : null
    if (!state.enabled || !roll || roll.expiresAt <= now) {
      const remainingRolls = state.activeRolls.filter((item) => item.expiresAt > now)
      if (remainingRolls.length !== state.activeRolls.length) {
        state.activeRolls = remainingRolls
        await saveState(state)
      }
      return
    }
    const character = state.characters.find((item) => item.id === roll.characterId)
    if (!character || character.owner) {
      state.activeRolls.splice(rollIndex, 1)
      await saveState(state)
      return
    }
    const claimAvailableAt = Number(state.claimCooldowns[userJid] || 0)
    if (claimAvailableAt > now) return

    character.owner = userJid
    character.claimedAt = now
    const previousClaims = Number(state.claimCounts[userJid] || 0)
    const nextClaimCount = (claimAvailableAt > 0 ? 0 : previousClaims) + 1
    state.claimCounts[userJid] = nextClaimCount
    if (nextClaimCount >= MUDAE_CONFIG.CLAIM_LIMIT) {
      state.claimCooldowns[userJid] = now + MUDAE_CONFIG.CLAIM_COOLDOWN
    } else if (claimAvailableAt > 0) {
      delete state.claimCooldowns[userJid]
    }
    state.activeRolls.splice(rollIndex, 1)
    await saveState(state)

    const name = await getDisplayName(conn, userJid)
    await conn.sendMessage(groupId, {
      text: `🎉 *¡Reclamado!*\n\n🎴 *${character.name}*\n📚 ${character.album} · ${formatMoney(character.value)}\n👑 @${userJid.split('@')[0]}${nextClaimCount >= MUDAE_CONFIG.CLAIM_LIMIT ? '\n⏳ Agotaste tus 2 reclamos; podés reclamar de nuevo en 1 hora.' : ''}`,
      mentions: [userJid],
    })
    console.log(`[MUDAE] ${character.id} reclamado por ${userJid} en ${groupId} (${name})`)
  })
}

const registerReactionListener = (conn) => {
  const primaryJid = normalizeJid(global.conn?.user?.jid)
  if (primaryJid && normalizeJid(conn?.user?.jid) !== primaryJid) return
  if (!conn?.ev?.on || conn[reactionListenerSymbol]) return
  conn[reactionListenerSymbol] = true
  conn.ev.on('messages.reaction', async (updates) => {
    for (const update of updates || []) {
      try {
        const activePlugin = global.plugins?.['mudae.js']
        await (activePlugin?.processReaction || processReaction)(conn, update)
      } catch (error) {
        console.error('[MUDAE] Error procesando una reacción:', error?.stack || error)
      }
    }
  })
}

const handler = async (m, { conn, text, command, isOwner, isROwner, isAdmin, usedPrefix }) => {
  if (!requireGroup(m)) return conn.reply(m.chat, 'Los comandos de Mudae solo funcionan en grupos.', m)
  registerReactionListener(conn)

  const action = String(command || '').toLowerCase()
  const actor = getActorJid(m)

  if (action === 'onmudae' || action === 'offmudae') {
    if (!isROwner && !isOwner) return conn.reply(m.chat, 'Solo el owner del bot puede activar o desactivar Mudae.', m)
    return withGroupLock(m.chat, async () => {
      const state = await loadState(m.chat)
      state.enabled = action === 'onmudae'
      if (!state.enabled) {
        state.activeRolls = []
        state.guessGame = null
      }
      await saveState(state)
      return conn.reply(m.chat, `🎴 *MUDAE ${state.enabled ? 'ACTIVADO' : 'DESACTIVADO'}*\nEste grupo ${state.enabled ? 'ya puede jugar' : 'ya no puede jugar'}.`, m)
    })
  }

  if (action === 'menumudae') {
    return conn.reply(m.chat, `╭━━━〔 🎴 *MUDAE* 〕━━━╮\n\n*🎲 JUGAR*\n✦ *%rw* — después de votar, tirá personajes durante 24 h; reaccioná con ❤️ para reclamar. Si ya está reclamado, no hay que esperar.\n✦ *%cd* — consultar tus esperas\n✦ *%votarpj <nombre>* — sumar *125* al valor (*50* si ya está reclamado) y habilitar tiradas durante 24 h (un voto cada 24 h)\n\n*👑 TUS PERSONAJES*\n✦ *%personajes / %pjs [página] [@usuario]* — colección propia o de otra persona; cada parte muestra hasta 100 personajes (ej.: *%pjs 2* o *%pjs 2 @usuario*)\n✦ *%albumespj [página]* — álbumes y cantidad de personajes\n✦ *%quitarpj <nombre>* — liberá un personaje\n✦ *%regalarpj <nombre> @usuario* — regalá uno a otra persona\n✦ *%suertepj <nombre>* — cambiá uno propio por uno libre al azar (cada 12 h)\n✦ *%cambiarpj <tuyo> + <del otro>* — proponé un intercambio; el otro tiene 30 s para aceptar con *%aceptarcambio*\n✦ *%toppj* — ranking por valor total; 👑 marca a quien tiene más personajes\n✦ *%gpjs* — top 20 por valor; los GIF especiales sin reclamar aparecen bloqueados\n✦ *%verpj <nombre>* — ficha e imagen; los GIF especiales se revelan al reclamarlos\n✦ *%overpj <nombre>* — ver cualquier GIF especial (owner)\n✦ *%ainfo <álbum>* — muestra los nombres normales; los GIF especiales no reclamados aparecen bloqueados\n\n*💖 DESEOS*\n✦ *%wish <nombre>* — guardar (máximo 3)\n✦ *%wishremove <nombre>* — quitar de tu lista\n✦ *%wishlist* — ver tus deseados; te mencionamos cuando salgan\n\n*🛠️ ADMINISTRACIÓN · ADMINS*\n✦ *%addalbum <nombre>* — crear álbum\n✦ *%addpj <álbum> + <nombre>* — responder a una imagen normal para agregar (no acepta GIFs)\n\n*👑 NUEVOS PERSONAJES*\n- %addpj <album> + <nombre>: cualquiera puede proponer con imagen; el owner lo aprueba.\n- Admins y owner: alta inmediata; los demas usuarios esperan aprobacion.\n- %verpj <nombre>: consulta tambien personajes pendientes.\n- %sugpj: ver la lista de sugerencias (owner).\n- %aceptarpj <nombre>: aceptar una sugerencia (owner).\n- %denegarpj <nombre>: rechazar una sugerencia (owner).\n\n*OWNER*\n✦ *%editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>*\n✦ *%editimgpj <album> + <nombre>* — cambia la imagen (owner)\n✦ *%delpj <álbum> + <nombre>* — borrar personaje\n✦ *%delalbum <nombre>* — borrar álbum vacío\n✦ *%onmudae / %offmudae* — activar o desactivar\n╰━━━━━━━━━━━━━━━━━━━━╯`, m)
  }

  if (action === 'cd') {
    const current = await loadState(m.chat)
    const now = Date.now()
    const formatWait = (time) => {
      const totalSeconds = Math.ceil(Math.max(0, time) / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return minutes ? `${minutes} min ${seconds} s` : `${seconds} s`
    }
    const rollCooldownAt = Number(current.rollCooldowns[actor] || 0)
    const rollCooldown = rollCooldownAt - now
    const claimCooldownAt = Number(current.claimCooldowns[actor] || 0)
    const claimCooldown = claimCooldownAt - now
    const voteCooldown = Number(current.voteCooldowns[actor] || 0) - now
    const recordedRollCount = Number(current.rollCounts[actor] || 0)
    const rollCount = rollCooldownAt > 0 && rollCooldown <= 0 ? 0 : recordedRollCount
    const recordedClaimCount = Number(current.claimCounts[actor] || 0)
    const claimCount = claimCooldown > 0
      ? recordedClaimCount
      : claimCooldownAt > 0 || recordedClaimCount >= MUDAE_CONFIG.CLAIM_LIMIT
        ? 0
        : recordedClaimCount
    const activeRolls = current.activeRolls.filter((roll) => roll.expiresAt > now)
    const activeCharacterIds = new Set(activeRolls.map((roll) => roll.characterId))
    const hasAvailableCharacter = current.characters.some((character) => !activeCharacterIds.has(character.id))
    const hasActiveVote = voteCooldown > 0
    const remainingRolls = Math.max(0, MUDAE_CONFIG.ROLL_LIMIT - rollCount)
    const waits = [
      `🎲 Tiradas RW: ${remainingRolls}/${MUDAE_CONFIG.ROLL_LIMIT}${!hasAvailableCharacter ? ' · no hay personajes para tirar' : !hasActiveVote ? ' · necesitás votar' : rollCooldown > 0 ? ` · disponibles en ${formatWait(rollCooldown)}` : ''}`,
      `❤️ Reclamos: ${Math.max(0, MUDAE_CONFIG.CLAIM_LIMIT - claimCount)}/${MUDAE_CONFIG.CLAIM_LIMIT}${claimCooldown > 0 ? ` · disponibles en ${formatWait(claimCooldown)}` : ''}`,
      `🗳️ Voto: ${voteCooldown > 0 ? `nuevo voto disponible en ${formatWait(voteCooldown)} · tiradas habilitadas` : 'disponible'}`,
    ]
    if (activeRolls.length) {
      waits.push(`🎴 Personajes activos: ${activeRolls.map((roll) =>
        `${current.characters.find((character) => character.id === roll.characterId)?.name || 'Personaje'}: vence en ${formatWait(roll.expiresAt - now)}`
      ).join(' · ')}`)
    }
    return conn.reply(m.chat, `⏳ *TUS ESPERAS*\n${waits.join('\n')}`, m)
  }

  const state = await ensureEnabled(m, conn)
  if (!state) return

  if (action === 'sugpj') {
    if (!isOwner && !isROwner) return conn.reply(m.chat, 'Solo el owner del bot puede ver las sugerencias pendientes.', m)
    const suggestions = [...(state.pendingCharacterSuggestions || [])]
      .sort((left, right) => Number(left.suggestedAt || 0) - Number(right.suggestedAt || 0))
    if (!suggestions.length) return conn.reply(m.chat, 'No hay sugerencias de personajes pendientes en este grupo.', m)
    const getUserDisplay = createGroupUserDisplayResolver(conn, m.chat)
    const entries = await Promise.all(suggestions.map(async (item, index) => {
      const suggester = normalizeJid(item.suggestedBy)
      const { label: suggesterName, mentionJid } = await getUserDisplay(suggester)
      const date = new Date(Number(item.suggestedAt || Date.now())).toLocaleString('es-AR')
      const taggedSuggester = mentionJid ? `@${mentionJid.split('@')[0]} (${suggesterName})` : suggesterName
      return {
        line: `${index + 1}. *${item.name}*\n   Album: ${item.album}\n   Sugirio: ${taggedSuggester}\n   Fecha: ${date}`,
        mentionJid,
      }
    }))
    return sendLongText(
      conn,
      m.chat,
      `SUGERENCIAS PENDIENTES (${suggestions.length})\n\n${entries.map(({ line }) => line).join('\n\n')}\n\nAcepta con *${usedPrefix}aceptarpj <nombre>* o deniega con *${usedPrefix}denegarpj <nombre>*.`,
      m,
      [...new Set(entries.map(({ mentionJid }) => mentionJid).filter(Boolean))]
    )
  }

  if (action === 'aceptarpj') {
    if (!isOwner && !isROwner) return conn.reply(m.chat, 'Solo el owner del bot puede aceptar sugerencias.', m)
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}aceptarpj <nombre>`, m)
    const pendingMatches = findPendingCharacterSuggestions(state, query)
    if (pendingMatches.length > 1) return replyAmbiguous(conn, m, pendingMatches)
    if (!pendingMatches.length) return conn.reply(m.chat, 'No encontre una sugerencia pendiente con ese nombre.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      current.pendingCharacterSuggestions = Array.isArray(current.pendingCharacterSuggestions) ? current.pendingCharacterSuggestions : []
      const freshMatches = findPendingCharacterSuggestions(current, query)
      if (freshMatches.length > 1) return replyAmbiguous(conn, m, freshMatches)
      const suggestion = freshMatches[0]
      if (!suggestion) return conn.reply(m.chat, 'Esa sugerencia ya no esta pendiente.', m)
      const accepted = { ...suggestion, owner: null }
      const identity = normalizeMudaeIdentity(accepted.name)
      await withCatalogLock(async () => {
        const catalog = await loadCatalog()
        if (catalog.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
          throw new Error('Ya existe un personaje con ese nombre en el catalogo global.')
        }
        catalog.characters.push(normalizeCatalogCharacter(accepted))
        addCatalogAlbum(catalog, accepted.album)
        await saveCatalog(catalog)
        syncStateWithCatalog(current, catalog)
      })
      current.pendingCharacterSuggestions = current.pendingCharacterSuggestions.filter((item) => item.id !== suggestion.id)
      const suggester = normalizeJid(suggestion.suggestedBy)
      const bonusCharacter = await adjustInventoryValue(current, suggester, 69, false)
      await saveState(current)
      const reward = bonusCharacter
        ? `\n\n*${bonusCharacter.name}* subio +${formatMoney(69)} y ahora vale *${formatMoney(bonusCharacter.value)}*. Felicitaciones!`
        : '\n\nNo se pudo aplicar el aumento porque todavia no tiene personajes reclamados.'
      return conn.sendMessage(m.chat, {
        text: `SUGERENCIA ACEPTADA\n\n*${accepted.name}*\nAlbum: ${accepted.album}${reward}\n\n@${suggester.split('@')[0]}, tu personaje fue aceptado.`,
        mentions: suggester ? [suggester] : [],
      }, { quoted: m })
    }).catch(async (error) => {
      console.error('[MUDAE] No se pudo aceptar una sugerencia:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo aceptar la sugerencia.\n> ${error.message}`, m)
    })
  }

  if (action === 'denegarpj') {
    if (!isOwner && !isROwner) return conn.reply(m.chat, 'Solo el owner del bot puede denegar sugerencias.', m)
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}denegarpj <nombre>`, m)
    const pendingMatches = findPendingCharacterSuggestions(state, query)
    if (pendingMatches.length > 1) return replyAmbiguous(conn, m, pendingMatches)
    if (!pendingMatches.length) return conn.reply(m.chat, 'No encontre una sugerencia pendiente con ese nombre.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      current.pendingCharacterSuggestions = Array.isArray(current.pendingCharacterSuggestions) ? current.pendingCharacterSuggestions : []
      const freshMatches = findPendingCharacterSuggestions(current, query)
      if (freshMatches.length > 1) return replyAmbiguous(conn, m, freshMatches)
      const suggestion = freshMatches[0]
      if (!suggestion) return conn.reply(m.chat, 'Esa sugerencia ya no esta pendiente.', m)
      current.pendingCharacterSuggestions = current.pendingCharacterSuggestions.filter((item) => item.id !== suggestion.id)
      const suggester = normalizeJid(suggestion.suggestedBy)
      const affectedCharacter = await adjustInventoryValue(current, suggester, -69, false)
      await saveState(current)
      try {
        await deleteCloudinaryMedia(suggestion.cloudinaryPublicId, suggestion.mediaType || 'image')
      } catch (error) {
        console.error('[MUDAE] Se rechazo la sugerencia, pero no se pudo borrar su imagen:', error?.stack || error)
      }
      const consequence = affectedCharacter
        ? `\n\n*${affectedCharacter.name}* bajo ${formatMoney(69)} y ahora vale *${formatMoney(affectedCharacter.value)}*.`
        : '\n\nNo se pudo aplicar la baja porque todavia no tiene personajes reclamados.'
      return conn.sendMessage(m.chat, {
        text: `SUGERENCIA DENEGADA\n\n*${suggestion.name}* no fue agregado al album *${suggestion.album}*.\n@${suggester.split('@')[0]}, tu sugerencia fue denegada.${consequence}`,
        mentions: suggester ? [suggester] : [],
      }, { quoted: m })
    }).catch(async (error) => {
      console.error('[MUDAE] No se pudo denegar una sugerencia:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo denegar la sugerencia.\n> ${error.message}`, m)
    })
  }

  if (action === 'adivinarpj') {
    const execution = beginCommandExecution(m, 'adivinarpj')
    if (!execution) return
    try {
      await m.react?.('⏳')
      if (normalizeMudaeIdentity(text) === 'terminar') {
        await withGroupLock(m.chat, async () => {
          const current = await loadState(m.chat)
          if (!current.guessGame) return conn.reply(m.chat, 'No hay una ronda de adivinar activa.', m)
          return revealGuessGame(conn, current, current.guessGame)
        })
      } else {
        await withGroupLock(m.chat, async () => {
          const current = await loadState(m.chat)
          return startGuessGame(m, conn, current)
        })
      }
      await m.react?.('✅')
    } catch (error) {
      await m.react?.('❌')
      console.error('[MUDAE] No se pudo iniciar adivinarpj:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo iniciar la ronda.\n> ${error.message}`, m)
    } finally {
      execution.finish()
    }
  }

  if (action === 'addalbum') {
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden crear álbumes.', m)
    const album = normalizeMudaeLabel(text)
    if (!album) return conn.reply(m.chat, `Uso: ${usedPrefix}addalbum <nombre>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const added = await withCatalogLock(async () => {
        const catalog = await loadCatalog()
        if (catalog.albums.some((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(album))) return false
        addCatalogAlbum(catalog, album)
        await saveCatalog(catalog)
        syncStateWithCatalog(current, catalog)
        return true
      })
      if (!added) return conn.reply(m.chat, 'Ese álbum ya existe en el catálogo global.', m)
      await saveState(current)
      return conn.reply(m.chat, `📚 *ÁLBUM CREADO PARA TODOS LOS GRUPOS*\n${album}`, m)
    })
  }

  if (action === 'addpj' || action === 'addchar') {
    const parts = parseMudaeParts(text, 2)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}addpj <album> + <nombre>\nResponde a una imagen normal o envia el comando como descripcion de la imagen.`, m)
    const quotedMedia = getMudaeImage(m)
    if (!quotedMedia) return conn.reply(m.chat, 'No detecte una imagen normal. %addpj no acepta GIFs; responde a una imagen o envia la imagen junto con %addpj <album> + <nombre>.', m)
    try {
      const mediaType = 'image'
      const media = typeof quotedMedia.download === 'function'
        ? await quotedMedia.download()
        : await conn.downloadM(quotedMedia.media, mediaType)
      if (!Buffer.isBuffer(media) || !media.length) throw new Error('No se pudo descargar la imagen citada.')
      return await withGroupLock(m.chat, async () => {
        const current = await loadState(m.chat)
        const catalog = await loadCatalog()
        const album = catalog.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(parts[0]))
        if (!album) return conn.reply(m.chat, `No existe el album "${parts[0]}". Crealo primero con %addalbum.`, m)
        const identity = normalizeMudaeIdentity(parts[1])
        if (catalog.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
          return conn.reply(m.chat, 'Ya existe un personaje con ese nombre en el catalogo global. Los nombres deben ser unicos.', m)
        }
        current.pendingCharacterSuggestions = Array.isArray(current.pendingCharacterSuggestions) ? current.pendingCharacterSuggestions : []
        if (current.pendingCharacterSuggestions.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
          return conn.reply(m.chat, 'Ya hay una sugerencia pendiente con ese nombre en este grupo.', m)
        }
        getCloudinaryCredentials()
        const mimeType = quotedMedia.media.mimetype || 'image/jpeg'
        const uploaded = await uploadCharacterImage(media, mimeType)
        const character = {
          id: crypto.randomUUID(),
          name: normalizeMudaeLabel(parts[1]),
          album,
          value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
          imageUrl: uploaded.imageUrl,
          cloudinaryPublicId: uploaded.cloudinaryPublicId,
          mediaType,
          isGift: false,
          owner: null,
          createdAt: Date.now(),
        }
        if (!isAdminOrOwner(isOwner, isAdmin)) {
          current.pendingCharacterSuggestions.push({
            ...normalizeCatalogCharacter(character),
            suggestedBy: actor,
            suggestedAt: Date.now(),
          })
          await saveState(current)
          return conn.reply(m.chat, `SUGERENCIA ENVIADA\n\n*${character.name}*\nAlbum: ${album}\nEl owner la revisara; podes verla con *${usedPrefix}verpj ${character.name}*.`, m)
        }
        try {
          await withCatalogLock(async () => {
            const lockedCatalog = await loadCatalog()
            if (lockedCatalog.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
              throw new Error('Ya existe un personaje con ese nombre en el catalogo global.')
            }
            lockedCatalog.characters.push(normalizeCatalogCharacter(character))
            addCatalogAlbum(lockedCatalog, album)
            await saveCatalog(lockedCatalog)
            syncStateWithCatalog(current, lockedCatalog)
          })
          await saveState(current)
        } catch (saveError) {
          try {
            await deleteCloudinaryMedia(uploaded.cloudinaryPublicId, mediaType)
          } catch (cleanupError) {
            console.error('[MUDAE] No se pudo limpiar de Cloudinary un medio sin registro:', cleanupError?.stack || cleanupError)
            throw new Error(`${saveError.message} El medio ${uploaded.cloudinaryPublicId} tambien debe eliminarse manualmente de Cloudinary.`)
          }
          throw saveError
        }
        const bonusCharacter = await adjustInventoryValue(current, actor, 69, false)
        await saveState(current)
        const bonusText = bonusCharacter
          ? `\n\n*${bonusCharacter.name}* subio +${formatMoney(69)} y ahora vale *${formatMoney(bonusCharacter.value)}*. Felicitaciones!`
          : '\n\nTodavia no tenes personajes reclamados para aplicar el aumento.'
        return conn.sendMessage(m.chat, {
          text: `PERSONAJE AGREGADO PARA TODOS LOS GRUPOS\n*${character.name}*\n${character.album}\n${formatMoney(character.value)}${bonusText}`,
          mentions: bonusCharacter ? [actor] : [],
        }, { quoted: m })
      })
    } catch (error) {
      console.error('[MUDAE] No se pudo agregar un personaje:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo agregar el personaje.\n> ${error.message}`, m)
    }
  }

  if (action === 'editpj' || action === 'editchar') {
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden editar personajes.', m)
    const parts = parseMudaeParts(text, 4)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const catalog = await loadCatalog()
      const original = catalog.characters.find((item) => makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(parts[0], parts[1]))
      if (!original) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      const album = catalog.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(parts[2]))
      if (!album) return conn.reply(m.chat, `No existe el álbum "${parts[2]}".`, m)
      if (catalog.characters.some((item) => item.id !== original.id && normalizeMudaeIdentity(item.name) === normalizeMudaeIdentity(parts[3]))) {
        return conn.reply(m.chat, 'Ya existe un personaje con ese nombre en el catálogo global; no se realizaron cambios.', m)
      }
      await withCatalogLock(async () => {
        const lockedCatalog = await loadCatalog()
        const lockedOriginal = lockedCatalog.characters.find((item) => item.id === original.id)
        if (!lockedOriginal) throw new Error('El personaje ya no existe en el catálogo global.')
        lockedOriginal.album = album
        lockedOriginal.name = normalizeMudaeLabel(parts[3])
        addCatalogAlbum(lockedCatalog, album)
        await saveCatalog(lockedCatalog)
        syncStateWithCatalog(current, lockedCatalog)
      })
      await saveState(current)
      return conn.reply(m.chat, `✅ *PERSONAJE ACTUALIZADO*\n🎴 *${original.name}*\n📚 ${original.album}`, m)
    })
  }

  if (action === 'editimgpj' || action === 'editimpj') {
    if (!isROwner && !isOwner) return conn.reply(m.chat, 'Solo el owner del bot puede cambiar imágenes de personajes.', m)
    const parts = parseMudaeParts(text, 2)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}editimgpj <álbum> + <nombre>\nResponde a una imagen o envíala junto con el comando.`, m)
    const imageMessage = getMudaeImage(m)
    if (!imageMessage) return conn.reply(m.chat, `No detecté una imagen. Responde a una imagen o envíala con ${usedPrefix}editimgpj <álbum> + <nombre>.`, m)

    try {
      const media = typeof imageMessage.download === 'function'
        ? await imageMessage.download()
        : await conn.downloadM(imageMessage.media, 'image')
      if (!Buffer.isBuffer(media) || !media.length) throw new Error('No se pudo descargar la imagen nueva.')
      const mimeType = imageMessage.media?.mimetype || 'image/jpeg'
      getCloudinaryCredentials()

      return await withGroupLock(m.chat, async () => {
        const current = await loadState(m.chat)
        const catalog = await loadCatalog()
        const matches = catalog.characters.filter((item) =>
          makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(parts[0], parts[1])
        )
        if (matches.length !== 1) {
          return conn.reply(m.chat, matches.length ? 'Hay personajes duplicados con ese álbum y nombre; no cambié ninguna imagen.' : 'No encontré ese personaje en el catálogo.', m)
        }
        const original = matches[0]
        if (original.isGift || original.mediaType === 'video') {
          return conn.reply(m.chat, 'Este comando solo cambia imágenes de personajes normales; los GIF especiales no se modificaron.', m)
        }

        const oldPublicId = original.cloudinaryPublicId
        const oldMediaType = original.mediaType
        const uploaded = await uploadCharacterImage(media, mimeType)
        let catalogSaved = false
        try {
          await withCatalogLock(async () => {
            const lockedCatalog = await loadCatalog()
            const lockedCharacter = lockedCatalog.characters.find((item) => item.id === original.id)
            if (!lockedCharacter) throw new Error('El personaje ya no existe en el catálogo global.')
            lockedCharacter.imageUrl = uploaded.imageUrl
            lockedCharacter.cloudinaryPublicId = uploaded.cloudinaryPublicId
            lockedCharacter.mediaType = 'image'
            lockedCharacter.isGift = false
            await saveCatalog(lockedCatalog)
            catalogSaved = true
            syncStateWithCatalog(current, lockedCatalog)
          })
          await saveState(current)
        } catch (error) {
          if (!catalogSaved) {
            try {
              await deleteCloudinaryMedia(uploaded.cloudinaryPublicId, 'image')
            } catch (cleanupError) {
              console.error('[MUDAE] No se pudo limpiar la nueva imagen de Cloudinary:', cleanupError?.stack || cleanupError)
              throw new Error(`${error.message} La nueva imagen ${uploaded.cloudinaryPublicId} también debe eliminarse manualmente de Cloudinary.`)
            }
          }
          throw error
        }

        try {
          await deleteCloudinaryMedia(oldPublicId, oldMediaType)
        } catch (error) {
          console.error('[MUDAE] La imagen nueva se guardó, pero no se pudo borrar la anterior de Cloudinary:', error?.stack || error)
          return conn.reply(m.chat, `La imagen de *${original.name}* ya se actualizó para todos los grupos, pero Cloudinary no pudo borrar la imagen anterior (${oldPublicId || 'sin public_id'}).\n> ${error.message}`, m)
        }
        return conn.reply(m.chat, `✅ *IMAGEN ACTUALIZADA*\n🎴 *${original.name}* — ${original.album}\nLa imagen anterior se eliminó de Cloudinary.`, m)
      })
    } catch (error) {
      console.error('[MUDAE] No se pudo cambiar la imagen de un personaje:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo cambiar la imagen del personaje.\n> ${error.message}`, m)
    }
  }

  if (action === 'delpj' || action === 'delchar') {
    if (!isROwner && !isOwner) return conn.reply(m.chat, 'Solo el owner del bot puede eliminar personajes.', m)
    const parts = parseMudaeParts(text, 2)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}delpj <álbum> + <nombre>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const catalog = await loadCatalog()
      const matchingIndexes = catalog.characters.flatMap((item, index) =>
        makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(parts[0], parts[1]) ? [index] : []
      )
      if (matchingIndexes.length > 1) {
        return conn.reply(m.chat, 'Hay personajes duplicados con ese álbum y nombre; no eliminé ninguno para preservar los datos.', m)
      }
      const index = matchingIndexes[0] ?? -1
      if (index < 0) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      const character = catalog.characters[index]
      await deleteCloudinaryMedia(character.cloudinaryPublicId, character.mediaType)
      await withCatalogLock(async () => {
        const lockedCatalog = await loadCatalog()
        const lockedIndex = lockedCatalog.characters.findIndex((item) => item.id === character.id)
        if (lockedIndex >= 0) lockedCatalog.characters.splice(lockedIndex, 1)
        if (!lockedCatalog.deletedCharacterIds.includes(character.id)) lockedCatalog.deletedCharacterIds.push(character.id)
        await saveCatalog(lockedCatalog)
        syncStateWithCatalog(current, lockedCatalog)
      })
      await saveState(current)
      return conn.reply(m.chat, `🗑️ *PERSONAJE ELIMINADO DEL CATÁLOGO GLOBAL*\n🎴 *${character.name}* — ${character.album}`, m)
    }).catch((error) => {
      console.error('[MUDAE] No se pudo eliminar un personaje:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo eliminar el personaje.\n> ${error.message}`, m)
    })
  }

  if (action === 'delalbum') {
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden eliminar álbumes.', m)
    const album = normalizeMudaeLabel(text)
    if (!album) return conn.reply(m.chat, `Uso: ${usedPrefix}delalbum <nombre>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const catalog = await loadCatalog()
      const index = catalog.albums.findIndex((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(album))
      if (index < 0) return conn.reply(m.chat, 'No encontré ese álbum en este grupo.', m)
      if (catalog.characters.some((character) => normalizeMudaeIdentity(character.album) === normalizeMudaeIdentity(catalog.albums[index]))) {
        return conn.reply(m.chat, 'No se puede eliminar un álbum que todavía tiene personajes. Eliminá o mové esos personajes primero.', m)
      }
      const [deletedAlbum] = catalog.albums.splice(index, 1)
      await saveCatalog(catalog)
      syncStateWithCatalog(current, catalog)
      await saveState(current)
      return conn.reply(m.chat, `🗑️ *ÁLBUM ELIMINADO DEL CATÁLOGO GLOBAL*\n${deletedAlbum}`, m)
    })
  }

  if (action === 'albumespj') {
    if (!state.albums.length) return conn.reply(m.chat, '📚 Todavía no hay álbumes en este grupo.', m)
    const pageText = String(text || '').trim()
    const page = pageText ? Number(pageText) : 1
    if (!/^\d+$/.test(pageText || '1') || !Number.isInteger(page) || page < 1) {
      return conn.reply(m.chat, `Uso: ${usedPrefix}albumespj [página]`, m)
    }
    const lines = state.albums
      .map((album) => {
        const count = state.characters.filter((character) =>
          normalizeMudaeIdentity(character.album) === normalizeMudaeIdentity(album)
        ).length
        return `📚 *${album}* — ${count} ${count === 1 ? 'personaje' : 'personajes'}`
      })
      .sort((first, second) => first.localeCompare(second, 'es'))
    const pageSize = 40
    const totalPages = Math.ceil(lines.length / pageSize)
    if (page > totalPages) {
      return conn.reply(m.chat, `Esa página no existe. Hay ${totalPages}; usa ${usedPrefix}albumespj 1 para empezar.`, m)
    }
    const pageLines = lines.slice((page - 1) * pageSize, page * pageSize)
    const nextPageHint = page < totalPages ? `\n➡️ Siguiente página: ${usedPrefix}albumespj ${page + 1}` : ''
    return sendLongText(
      conn,
      m.chat,
      `📚 *ÁLBUMES DE PERSONAJES*\n📄 Página ${page} de ${totalPages}\n\n${pageLines.join('\n')}\n\nÁlbumes: ${lines.length} · Personajes: ${state.characters.length}${nextPageHint}`,
      m
    )
  }

  if (action === 'quitarpj' || action === 'regalarpj') {
    const gifting = action === 'regalarpj'
    const parts = parseMudaeParts(text, gifting ? 2 : 1)
    const mentions = gifting ? await getMentionedJids(m, conn, text) : []
    if (!parts && !gifting) {
      return conn.reply(m.chat, `Uso: ${usedPrefix}quitarpj <nombre>`, m)
    }

    const textualMention = /@(\d{7,16})/.exec(String(text || ''))?.[1]
    const recipient = mentions[0] || (textualMention ? `${textualMention}@s.whatsapp.net` : '')
    const characterName = gifting
      ? parts
        ? (parts[0].includes('@') ? parts[1] : parts[0])
        : String(text || '').replace(/@\d{7,16}/g, '').replace(/\+/g, ' ').trim()
      : parts[0]
    if (!characterName) return conn.reply(m.chat, `Uso: ${usedPrefix}regalarpj <nombre> @usuario`, m)
    if (gifting && !recipient) return conn.reply(m.chat, 'Mencioná a la persona que va a recibir el personaje.', m)
    if (gifting && recipient === actor) return conn.reply(m.chat, 'No podés regalarte un personaje a vos mismo.', m)

    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const { character, matches } = findCharacter(current, characterName)
      if (matches.length > 1) return conn.reply(m.chat, 'Hay personajes con ese nombre repetido en los datos anteriores; no cambié ningún propietario.', m)
      if (!character) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      if (!actor || !character.owner || normalizeJid(character.owner) !== actor) {
        return conn.reply(m.chat, 'Solo quien tiene el personaje puede liberarlo o regalarlo.', m)
      }

      if (gifting) {
        character.owner = recipient
        character.claimedAt = Date.now()
        current.activeRolls = current.activeRolls.filter((roll) => roll.characterId !== character.id)
        await saveState(current)
        return conn.sendMessage(m.chat, {
          text: `🎁 *PERSONAJE REGALADO*\n🎴 *${character.name}* — ${character.album}\n👑 Ahora pertenece a @${recipient.split('@')[0]}.`,
          mentions: [recipient],
        }, { quoted: m })
      }

      character.owner = null
      delete character.claimedAt
      current.activeRolls = current.activeRolls.filter((roll) => roll.characterId !== character.id)
      await saveState(current)
      return conn.reply(m.chat, `🔓 *PERSONAJE LIBERADO*\n🎴 *${character.name}* — ${character.album}\nAhora cualquiera puede reclamarlo con %rw.`, m)
    }).catch((error) => {
      console.error(`[MUDAE] No se pudo ${gifting ? 'regalar' : 'liberar'} un personaje:`, error?.stack || error)
      return conn.reply(m.chat, `No se pudo ${gifting ? 'regalar' : 'liberar'} el personaje.\n> ${error.message}`, m)
    })
  }

  if (action === 'cambiarpj') {
    const parts = parseMudaeParts(text, 2)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}cambiarpj <tu personaje> + <personaje del otro>`, m)
    if (!actor) return conn.reply(m.chat, 'No pude identificar tu usuario para proponer el cambio.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const now = Date.now()
      const pending = current.pendingTrade
      if (pending?.expiresAt > now) {
        return conn.reply(m.chat, '⏳ Ya hay un intercambio pendiente en este grupo. Esperen a que lo acepten o venza.', m)
      }
      if (pending) current.pendingTrade = null

      const first = findCharacter(current, parts[0])
      const second = findCharacter(current, parts[1])
      if (first.matches.length > 1) return replyAmbiguous(conn, m, first.matches)
      if (second.matches.length > 1) return replyAmbiguous(conn, m, second.matches)
      if (!first.character || !second.character) return conn.reply(m.chat, 'No encontré uno de los personajes en este grupo.', m)
      if (first.character.id === second.character.id) return conn.reply(m.chat, 'Elegí dos personajes distintos para el intercambio.', m)
      if (normalizeJid(first.character.owner) !== actor) {
        return conn.reply(m.chat, 'El primer personaje tiene que pertenecerte.', m)
      }
      const recipient = normalizeJid(second.character.owner)
      if (!recipient) return conn.reply(m.chat, 'El segundo personaje no tiene dueño; ambos personajes deben pertenecer a alguien para intercambiarlos.', m)
      if (recipient === actor) return conn.reply(m.chat, 'El segundo personaje debe pertenecer a otra persona.', m)

      current.pendingTrade = {
        proposer: actor,
        recipient,
        offeredCharacterId: first.character.id,
        requestedCharacterId: second.character.id,
        expiresAt: now + 30 * 1000,
      }
      await saveState(current)
      return conn.sendMessage(m.chat, {
        text: `🔄 *PROPUESTA DE INTERCAMBIO*\n👤 @${actor.split('@')[0]} te propone cambiar *${first.character.name}* por *${second.character.name}*.\n\n@${recipient.split('@')[0]}, respondé *${usedPrefix}aceptarcambio* dentro de 30 segundos para aceptar.`,
        mentions: [actor, recipient],
      }, { quoted: m })
    }).catch((error) => {
      console.error('[MUDAE] No se pudo proponer un intercambio:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo proponer el intercambio.\n> ${error.message}`, m)
    })
  }

  if (action === 'aceptarcambio') {
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const pending = current.pendingTrade
      if (!pending || pending.expiresAt <= Date.now()) {
        if (pending) {
          current.pendingTrade = null
          await saveState(current)
        }
        return conn.reply(m.chat, 'No hay una propuesta de intercambio vigente en este grupo.', m)
      }
      if (normalizeJid(pending.recipient) !== actor) return

      const offered = current.characters.find((character) => character.id === pending.offeredCharacterId)
      const requested = current.characters.find((character) => character.id === pending.requestedCharacterId)
      if (
        !offered ||
        !requested ||
        normalizeJid(offered.owner) !== normalizeJid(pending.proposer) ||
        normalizeJid(requested.owner) !== normalizeJid(pending.recipient)
      ) {
        current.pendingTrade = null
        await saveState(current)
        return conn.reply(m.chat, 'La propuesta ya no es válida porque cambió la propiedad de uno de los personajes.', m)
      }

      const now = Date.now()
      offered.owner = pending.recipient
      offered.claimedAt = now
      requested.owner = pending.proposer
      requested.claimedAt = now
      current.pendingTrade = null
      current.activeRolls = current.activeRolls.filter((roll) =>
        roll.characterId !== offered.id && roll.characterId !== requested.id
      )
      await saveState(current)
      return conn.sendMessage(m.chat, {
        text: `✅ *INTERCAMBIO ACEPTADO*\n🎴 *${offered.name}* ahora pertenece a @${pending.recipient.split('@')[0]}.\n🎴 *${requested.name}* ahora pertenece a @${pending.proposer.split('@')[0]}.`,
        mentions: [normalizeJid(pending.proposer), normalizeJid(pending.recipient)],
      }, { quoted: m })
    }).catch((error) => {
      console.error('[MUDAE] No se pudo aceptar un intercambio:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo aceptar el intercambio.\n> ${error.message}`, m)
    })
  }

  if (action === 'suertepj') {
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}suertepj <nombre>`, m)
    if (!actor) return conn.reply(m.chat, 'No pude identificar tu usuario para cambiar el personaje.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const now = Date.now()
      const availableAt = Number(current.tradeCooldowns[actor] || 0)
      if (availableAt > now) {
        const hours = Math.ceil((availableAt - now) / (60 * 60 * 1000))
        return conn.reply(m.chat, `⏳ Ya usaste la suerte hace poco. Podés volver a usar %suertepj en aproximadamente ${hours} h.`, m)
      }

      const { character: unwanted, matches } = findCharacter(current, query)
      if (matches.length > 1) return replyAmbiguous(conn, m, matches)
      if (!unwanted) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      if (normalizeJid(unwanted.owner) !== actor) {
        return conn.reply(m.chat, 'Solo podés cambiar un personaje que te pertenezca.', m)
      }

      current.activeRolls = current.activeRolls.filter((roll) => roll.expiresAt > now)
      const activeCharacterIds = new Set(current.activeRolls.map((roll) => roll.characterId))
      const availableCharacters = current.characters.filter((character) =>
        !character.owner && !activeCharacterIds.has(character.id)
      )
      if (!availableCharacters.length) {
        return conn.reply(m.chat, '🎴 No hay personajes libres para hacer el cambio. Tu personaje no se modificó.', m)
      }

      const replacement = availableCharacters[Math.floor(Math.random() * availableCharacters.length)]
      unwanted.owner = null
      delete unwanted.claimedAt
      replacement.owner = actor
      replacement.claimedAt = now
      current.tradeCooldowns[actor] = now + MUDAE_CONFIG.TRADE_COOLDOWN
      await saveState(current)
      const replacementIsGift = replacement.isGift || replacement.mediaType === 'video'
      return conn.sendMessage(
        m.chat,
        replacementIsGift
          ? {
            video: { url: replacement.imageUrl },
            mimetype: 'video/mp4',
            gifPlayback: true,
            caption: `🍀 *CAMBIO POR SUERTE*\n🎴 *${unwanted.name}* — ${unwanted.album} quedó libre.\n✨ Recibiste *${replacement.name}* — ${replacement.album} (${formatMoney(replacement.value)}).\n⏳ Podés volver a usar %suertepj en 12 horas.`,
          }
          : {
            image: { url: replacement.imageUrl },
            caption: `🍀 *CAMBIO POR SUERTE*\n🎴 *${unwanted.name}* — ${unwanted.album} quedó libre.\n✨ Recibiste *${replacement.name}* — ${replacement.album} (${formatMoney(replacement.value)}).\n⏳ Podés volver a usar %suertepj en 12 horas.`,
          },
        { quoted: m }
      )
    }).catch((error) => {
      console.error('[MUDAE] No se pudo cambiar un personaje:', error?.stack || error)
      return conn.reply(m.chat, `No se pudo cambiar el personaje.\n> ${error.message}`, m)
    })
  }

  if (action === 'rw') {
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      if (!current.enabled) return conn.reply(m.chat, 'Mudae está desactivado en este grupo.', m)
      const now = Date.now()
      if (Number(current.voteCooldowns[actor] || 0) <= now) {
        return conn.reply(m.chat, `🗳️ Para tirar *%rw*, primero tenés que votar por un personaje.\nUsá *${usedPrefix}votarpj <nombre>*; por ejemplo: *${usedPrefix}votarpj Goku*.`, m)
      }
      current.activeRolls = current.activeRolls.filter((roll) => roll.expiresAt > now)
      if (now < Number(current.lastRollAt || 0) + MUDAE_CONFIG.ROLL_COOLDOWN) return
      const availableAt = Number(current.rollCooldowns[actor] || 0)
      if (availableAt > now) {
        const seconds = Math.ceil((availableAt - now) / 1000)
        const minutes = Math.floor(seconds / 60)
        return conn.reply(
          m.chat,
          `⏳ Agotaste tus ${MUDAE_CONFIG.ROLL_LIMIT} tiradas RW. Podés volver a tirar en ${minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`}.`,
          m
        )
      }
      if (availableAt > 0) {
        current.rollCounts[actor] = 0
        delete current.rollCooldowns[actor]
      }
      const rollCount = Number(current.rollCounts[actor] || 0)
      if (rollCount >= MUDAE_CONFIG.ROLL_LIMIT) {
        current.rollCooldowns[actor] = now + MUDAE_CONFIG.ROLL_EXHAUSTED_COOLDOWN
        await saveState(current)
        return conn.reply(
          m.chat,
          `⏳ Agotaste tus ${MUDAE_CONFIG.ROLL_LIMIT} tiradas RW. Podés volver a tirar en 30 min.`,
          m
        )
      }
      const activeCharacterIds = new Set(current.activeRolls.map((roll) => roll.characterId))
      const availableCharacters = current.characters.filter((character) => !activeCharacterIds.has(character.id))
      if (!availableCharacters.length) {
        await saveState(current)
        return conn.reply(m.chat, '🎴 *NO HAY PERSONAJES PARA TIRAR*\nProbá de nuevo cuando termine otro roll.', m)
      }
      const giftCharacters = availableCharacters.filter((character) => character.isGift || character.mediaType === 'video')
      const standardCharacters = availableCharacters.filter((character) => !character.isGift && character.mediaType !== 'video')
      const rankedCharacters = current.characters
        .filter((character) => !character.isGift && character.mediaType !== 'video')
        .sort((first, second) =>
        Number(second.value || 0) - Number(first.value || 0)
      )
      const rankById = new Map(rankedCharacters.map((character, rank) => [character.id, rank]))
      const weightedCharacters = standardCharacters.map((character) => ({
        character,
        weight: getRollWeight(rankById.get(character.id)),
      })).sort((first, second) =>
        rankById.get(first.character.id) - rankById.get(second.character.id)
      )
      const totalStandardWeight = weightedCharacters.reduce((total, item) => total + item.weight, 0)
      const giftRollProbability = getGiftRollProbability(giftCharacters.length)
      let character
      if (giftCharacters.length && Math.random() < giftRollProbability) {
        character = giftCharacters[Math.floor(Math.random() * giftCharacters.length)]
      } else {
        if (!standardCharacters.length) {
          await saveState(current)
          return conn.reply(m.chat, '🎴 *NO HAY PERSONAJES PARA TIRAR*\nProbá de nuevo cuando termine otro roll.', m)
        }
        let randomWeight = Math.random() * totalStandardWeight
        character = weightedCharacters.at(-1).character
        for (const item of weightedCharacters) {
          randomWeight -= item.weight
          if (randomWeight < 0) {
            character = item.character
            break
          }
        }
      }
      const expiresAt = now + MUDAE_CONFIG.CLAIM_DURATION
      const wishers = Object.entries(current.users)
        .filter(([, user]) => Array.isArray(user?.wishlist) && user.wishlist.includes(character.id))
        .map(([jid]) => normalizeJid(jid))
      const wishLine = wishers.length
        ? `\n💖 *Deseado por:* ${wishers.map((jid) => `@${jid.split('@')[0]}`).join(', ')}`
        : ''
      const owner = normalizeJid(character.owner)
      const ownershipLine = owner
        ? `\n👑 *Reclamado por:* @${owner.split('@')[0]}\n🚫 Este personaje ya no se puede reclamar.`
        : '\nReaccioná con ❤️ para reclamarlo.'
      const mentions = [...new Set([...wishers, ...(owner ? [owner] : [])])]
      let sent
      try {
        const caption = `❤️ *PERSONAJE*\n\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}${wishLine}${ownershipLine}${owner ? '' : '\n⏱️ Vence en 1 minuto.'}${rollCount + 1 >= MUDAE_CONFIG.ROLL_LIMIT ? '\n⏳ Agotaste tus 10 tiradas RW; podés volver a tirar en 30 minutos.' : ''}`
        if (character.isGift || character.mediaType === 'video') {
          await conn.sendMessage(m.chat, {
            text: `🎁 *PERSONAJE CON IMAGEN OCULTA DESBLOQUEADO*\n\n🎴 *${character.name}* apareció...\n⏳ En 5 segundos revelamos su GIF. ¡Atentos!`,
            mentions: wishers,
          }, { quoted: m })
          await new Promise((resolve) => setTimeout(resolve, MUDAE_CONFIG.GIFT_REVEAL_DELAY))
          sent = await conn.sendMessage(m.chat, {
            video: { url: character.imageUrl },
            mimetype: 'video/mp4',
            gifPlayback: true,
            caption,
            mentions,
          }, { quoted: m })
        } else {
          sent = await conn.sendMessage(m.chat, {
            image: { url: character.imageUrl },
            caption,
            mentions,
          }, { quoted: m })
        }
        if (!sent?.key?.id) throw new Error('WhatsApp no devolvió el ID del mensaje del roll.')
        current.activeRolls.push({ messageId: sent.key.id, characterId: character.id, expiresAt })
        current.rollCounts[actor] = rollCount + 1
        delete current.pendingVotes[actor]
        current.lastRollAt = now
        if (rollCount + 1 >= MUDAE_CONFIG.ROLL_LIMIT) {
          current.rollCooldowns[actor] = now + MUDAE_CONFIG.ROLL_EXHAUSTED_COOLDOWN
        }
        await saveState(current)
        return sent
      } catch (error) {
        current.activeRolls = current.activeRolls.filter((roll) => roll.messageId !== sent?.key?.id)
        await saveState(current)
        throw error
      }
    }).catch((error) => {
      console.error('[MUDAE] No se pudo generar un roll:', error?.stack || error)
      return conn.reply(m.chat, `⚠️ *NO SE PUDO GENERAR EL ROLL*\n> ${error.message}`, m)
    })
  }

  if (action === 'personajes' || action === 'pjs') {
    const rawText = String(text || '').trim()
    const pageMatch = /^(\d+)(?:\s+|$)/.exec(rawText)
    const page = pageMatch ? Number(pageMatch[1]) : 1
    const targetText = pageMatch ? rawText.slice(pageMatch[0].length).trim() : rawText
    const target = await getMentionTarget(m, conn, targetText)
    const getUserDisplay = createGroupUserDisplayResolver(conn, m.chat)
    const targetFallbackPhone = getPhoneNumber(targetText.match(/@(\+?[\d\s().-]{7,25})/)?.[1])
    const targetDisplay = await getUserDisplay(target, targetFallbackPhone)
    const pushName = String(m.pushName || '').trim()
    const ownerName = target === actor && pushName && !isPhoneNumberLabel(pushName)
      ? pushName
      : targetDisplay.label
    const targetArgument = target === actor
      ? ''
      : ` @${targetDisplay.phoneNumber || (target.endsWith('@lid') ? 'usuario' : getPhoneNumber(target) || 'usuario')}`
    const collection = state.characters.filter((character) => normalizeJid(character.owner) === target)
    if (!collection.length) return conn.reply(m.chat, `👑 *${ownerName} todavía no tiene personajes en este grupo.*`, m)
    const total = collection.reduce((sum, character) => sum + Number(character.value || 0), 0)
    const pageSize = 100
    const grouped = new Map()
    for (const character of collection) {
      const key = normalizeMudaeIdentity(character.album)
      const group = grouped.get(key) || { album: character.album, characters: [] }
      group.characters.push(character)
      grouped.set(key, group)
    }
    const pages = []
    let pageGroups = []
    let pageCharacterCount = 0
    for (const group of grouped.values()) {
      let offset = 0
      while (offset < group.characters.length) {
        const availableSlots = pageSize - pageCharacterCount
        const characters = group.characters.slice(offset, offset + availableSlots)
        pageGroups.push({ album: group.album, characters })
        pageCharacterCount += characters.length
        offset += characters.length
        if (pageCharacterCount === pageSize) {
          pages.push(pageGroups)
          pageGroups = []
          pageCharacterCount = 0
        }
      }
    }
    if (pageGroups.length) pages.push(pageGroups)
    const totalPages = pages.length
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      return conn.reply(m.chat, `📄 Página no válida. ${ownerName} tiene ${totalPages} ${totalPages === 1 ? 'página' : 'páginas'}; usá ${usedPrefix}pjs 1${targetArgument}.`, m)
    }
    const currentPageGroups = pages[page - 1]
    let number = pages.slice(0, page - 1).reduce((sum, groups) =>
      sum + groups.reduce((count, group) => count + group.characters.length, 0), 0) + 1
    const currentPageCount = currentPageGroups.reduce((sum, group) => sum + group.characters.length, 0)
    const details = currentPageGroups.map(({ album, characters }) =>
      `📚 *${album}*\n${characters.map((character) => `${number++}. *${character.name}* — ${formatMoney(character.value)}`).join('\n')}`
    ).join('\n\n')
    const nextPageHint = page < totalPages
      ? `\n➡️ Siguiente parte: ${usedPrefix}pjs ${page + 1}${targetArgument}`
      : ''
    return conn.reply(
      m.chat,
      `👑 *PERSONAJES DE ${ownerName.toLocaleUpperCase('es')}*\n📄 Parte ${page} de ${totalPages} · ${currentPageCount} personajes\n\n${details}\n\n🎴 Personajes: ${collection.length}\n💰 Valor total: ${formatMoney(total)}${nextPageHint}`,
      m
    )
  }

  if (action === 'ainfo') {
    const albumQuery = normalizeMudaeIdentity(text)
    if (!albumQuery) return conn.reply(m.chat, `Uso: ${usedPrefix}ainfo <álbum>`, m)
    const album = state.albums.find((item) => normalizeMudaeIdentity(item) === albumQuery)
    if (!album) return conn.reply(m.chat, `No encontré el álbum "${String(text).trim()}".`, m)
    const characters = state.characters
      .filter((character) => normalizeMudaeIdentity(character.album) === albumQuery)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    if (!characters.length) return conn.reply(m.chat, `📚 *${album}* todavía no tiene personajes.`, m)
    const getUserDisplay = createGroupUserDisplayResolver(conn, m.chat)
    const lines = await Promise.all(characters.map(async (character, index) => {
      if (!character.owner && (character.isGift || character.mediaType === 'video')) {
        return `${index + 1}. 🔒 *Bloqueado* — GIF oculto`
      }
      const owner = character.owner ? await getUserDisplay(character.owner) : null
      return `${index + 1}. *${character.name}* — ${formatMoney(character.value)}${owner ? ` · 👑 ${owner.label}` : ''}`
    }))
    return sendLongText(conn, m.chat, `📚 *PERSONAJES DE ${album.toLocaleUpperCase('es')}* (👑 = reclamado)\n${lines.join('\n')}\n🎴 Total: ${characters.length}`, m)
  }

  if (action === 'toppj') {
    const ranking = new Map()
    for (const character of state.characters) {
      if (!character.owner) continue
      const owner = normalizeJid(character.owner)
      const current = ranking.get(owner) || { count: 0, value: 0 }
      current.count += 1
      current.value += Number(character.value || 0)
      ranking.set(owner, current)
    }
    const sorted = [...ranking].sort((a, b) => b[1].value - a[1].value || b[1].count - a[1].count || a[0].localeCompare(b[0]))
    if (!sorted.length) return conn.reply(m.chat, '🏆 *TODAVÍA NO HAY RECLAMOS*\n¡Sé el primero en conseguir un personaje!', m)
    const medals = ['🥇', '🥈', '🥉']
    const top = sorted.slice(0, 10)
    const mostCharacters = Math.max(...sorted.map(([, score]) => score.count))
    const lines = await Promise.all(top.map(async ([jid, score], index) =>
      `${medals[index] || `*${index + 1}.*`}${score.count === mostCharacters ? ' 👑' : ''} @${jid.split('@')[0]}  ·  🎴 ${score.count}  ·  💰 ${formatMoney(score.value)}`
    ))
    return conn.sendMessage(m.chat, {
      text: `🏆 *TOP 10 JUGADORES*\n_Ranking por valor total · 👑 quien tiene más personajes_\n\n${lines.join('\n')}`,
      mentions: top.map(([jid]) => jid),
    }, { quoted: m })
  }

  if (action === 'gpjs') {
    const top = [...state.characters]
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || a.name.localeCompare(b.name, 'es'))
      .slice(0, 20)
    if (!top.length) return conn.reply(m.chat, '🎴 *TODAVÍA NO HAY PERSONAJES*', m)
    const lines = top.map((character, index) => {
      const isLockedGift = !character.owner && (character.isGift || character.mediaType === 'video')
      const label = isLockedGift ? '🔒 *Bloqueado*' : `*${character.name}*`
      return `${index + 1}. ${label} · 💰 ${formatMoney(character.value)} · ${character.owner ? '🔒 Reclamado' : '✨ Disponible'}`
    })
    return conn.reply(m.chat, `🏆 *TOP 20 PERSONAJES POR VALOR*\n\n${lines.join('\n')}`, m)
  }

  if (action === 'verpj' || action === 'overpj') {
    const ownerView = action === 'overpj'
    if (ownerView && !isOwner && !isROwner) {
      return conn.reply(m.chat, 'Solo el owner del bot puede usar %overpj para ver personajes especiales antes de reclamarlos.', m)
    }
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}${action} <personaje>`, m)
    const { character, matches } = findCharacter(state, query)
    if (matches.length > 1) return replyAmbiguous(conn, m, matches)
    if (!character && action === 'verpj') {
      const pending = findPendingCharacterSuggestions(state, query)
      if (pending.length > 1) return replyAmbiguous(conn, m, pending)
      if (pending.length === 1) {
        const suggestion = pending[0]
        const suggestedBy = normalizeJid(suggestion.suggestedBy)
        const suggestedName = await getDisplayName(conn, suggestedBy)
        return conn.sendMessage(m.chat, {
          image: { url: suggestion.imageUrl },
          caption: `PERSONAJE PENDIENTE DE APROBACION\n\n*${suggestion.name}*\nAlbum: ${suggestion.album}\nSugerido por: @${suggestedBy.split('@')[0]} (${suggestedName})\n\nTodavia no esta agregado al catalogo ni puede salir en tiradas o reclamarse.`,
          mentions: suggestedBy ? [suggestedBy] : [],
        }, { quoted: m })
      }
    }
    if (!character) return conn.reply(m.chat, 'No encontre ese personaje en este grupo.', m)
    const info = await buildCharacterInfo(conn, character)
    const isGift = character.isGift || character.mediaType === 'video'
    if (isGift && !character.owner && !ownerView) {
      return conn.reply(m.chat, `🎁 *PERSONAJE ESPECIAL*\n\n🎴 *${character.name}*\n📚 *Álbum:* ${character.album}\n💰 *Valor:* ${formatMoney(character.value)}\n🔒 Su GIF está oculto hasta que alguien lo reclame.`, m)
    }
    if (isGift) {
      return conn.sendMessage(m.chat, {
        video: { url: character.imageUrl },
        mimetype: 'video/mp4',
        gifPlayback: true,
        caption: info,
        mentions: character.owner ? [character.owner] : [],
      }, { quoted: m })
    }
    return conn.sendMessage(m.chat, {
      image: { url: character.imageUrl },
      caption: info,
      mentions: character.owner ? [character.owner] : [],
    }, { quoted: m })
  }

  if (action === 'votarpj') {
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}votarpj <nombre>`, m)
    if (!actor) return conn.reply(m.chat, 'No pude identificar tu usuario para registrar el voto.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const { character, matches } = findCharacter(current, query)
      if (matches.length > 1) return replyAmbiguous(conn, m, matches)
      if (!character) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      const now = Date.now()
      const availableAt = Number(current.voteCooldowns?.[actor] || 0)
      const guessVoteCredits = current.guessVoteCredits && typeof current.guessVoteCredits === 'object' ? current.guessVoteCredits : (current.guessVoteCredits = {})
      const hasGuessVoteCredit = Number(guessVoteCredits[actor] || 0) > 0
      if (availableAt > now && current.pendingVotes[actor] && !hasGuessVoteCredit) {
        return conn.reply(m.chat, `Ya tenés un voto pendiente. Usá *${usedPrefix}rw* para tirar antes de volver a votar.`, m)
      }
      if (availableAt > now && !hasGuessVoteCredit) {
        const remainingHours = Math.ceil((availableAt - now) / (60 * 60 * 1000))
        return conn.reply(m.chat, `⏳ Ya votaste en las últimas 24 horas. Podés volver a votar en aproximadamente ${remainingHours} h.`, m)
      }
      if (hasGuessVoteCredit) {
        guessVoteCredits[actor] -= 1
        if (guessVoteCredits[actor] <= 0) delete guessVoteCredits[actor]
      }
      delete current.pendingVotes[actor]
      const increment = character.owner
        ? MUDAE_CONFIG.CLAIMED_VOTE_VALUE_INCREMENT
        : MUDAE_CONFIG.VOTE_VALUE_INCREMENT
      const updatedCharacter = await updateCatalogCharacterValue(current, character.id, increment)
      current.voteCooldowns[actor] = now + MUDAE_CONFIG.VOTE_COOLDOWN
      current.pendingVotes[actor] = true
      await saveState(current)
      return conn.reply(m.chat, `🗳️ *VOTO REGISTRADO*\n🎴 *${updatedCharacter.name}* ahora vale *${formatMoney(updatedCharacter.value)}* (+${formatMoney(increment)}${updatedCharacter.owner ? ', ya reclamado' : ''}).\nPodés tirar con *%rw* durante las próximas 24 horas y votar de nuevo después.`, m)
    })
  }

  if (action === 'wish') {
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}wish <personaje>`, m)
    const { character, matches } = findCharacter(state, query)
    if (matches.length > 1) return replyAmbiguous(conn, m, matches)
    if (!character) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const user = current.users[actor] || (current.users[actor] = { wishlist: [] })
      user.wishlist = Array.isArray(user.wishlist) ? user.wishlist : []
      if (user.wishlist.includes(character.id)) return conn.reply(m.chat, `✨ *${character.name}* ya está en tu wishlist.`, m)
      if (user.wishlist.length >= MUDAE_CONFIG.WISHLIST_LIMIT) {
        return conn.reply(m.chat, `💖 Tu wishlist ya llegó al límite de ${MUDAE_CONFIG.WISHLIST_LIMIT} personajes. Quitá uno con %wishremove <nombre> antes de agregar otro.`, m)
      }
      user.wishlist.push(character.id)
      await saveState(current)
      return conn.reply(m.chat, `💖 *AGREGADO A TU WISHLIST*\n🎴 *${character.name}* — ${character.album}`, m)
    })
  }

  if (action === 'wishremove') {
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}wishremove <nombre>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const user = current.users[actor]
      if (!Array.isArray(user?.wishlist) || !user.wishlist.length) {
        return conn.reply(m.chat, '💖 Tu wishlist está vacía.', m)
      }
      const { character, matches } = findCharacter(current, query)
      if (matches.length > 1) return replyAmbiguous(conn, m, matches)
      if (!character) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      if (!user.wishlist.includes(character.id)) {
        return conn.reply(m.chat, `*${character.name}* no está en tu wishlist.`, m)
      }
      user.wishlist = user.wishlist.filter((id) => id !== character.id)
      await saveState(current)
      return conn.reply(m.chat, `💔 *DESEADO ELIMINADO*\n🎴 *${character.name}* ya no está en tu wishlist.`, m)
    })
  }

  if (action === 'wishlist') {
    const user = state.users[actor]
    const wishlist = (user?.wishlist || []).map((id) => state.characters.find((character) => character.id === id)).filter(Boolean)
    if (!wishlist.length) return conn.reply(m.chat, '💖 *TU WISHLIST ESTÁ VACÍA*\nUsá %wish <personaje> para agregar uno.', m)
    const lines = wishlist.map((character, index) =>
      `${index + 1}. *${character.name}* — ${character.album}${character.owner ? ' · 🔒 Reclamado' : ' · ✨ Disponible'}`
    )
    return sendLongText(conn, m.chat, `✨ *TU WISHLIST*\n\n${lines.join('\n')}`, m)
  }
}

handler.all = async function (m) {
  if (isGroupJid(m?.chat)) {
    registerReactionListener(this)
    await processGuessGameMessage(this, m)
  }
}

handler.init = registerReactionListener
handler.processReaction = processReaction
handler.hasQuotedImage = hasQuotedMudaeImage
handler.hasQuotedGif = hasQuotedMudaeGif
handler.help = [
  'onmudae', 'offmudae',
  'menumudae', 'adivinarpj (responde a la imagen para adivinar)', 'adivinarpj terminar', 'addalbum <nombre>', 'addpj <álbum> + <nombre> (con imagen o respondiendo)',
  'sugpj (owner)', 'aceptarpj <nombre> (owner)', 'denegarpj <nombre> (owner)',
  'editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>',
  'editimgpj <álbum> + <nombre> (alias: editimpj; responde a una imagen nueva; owner)',
  'delpj <álbum> + <nombre>', 'delalbum <nombre>',
  'rw', 'cd', 'quitarpj <nombre>', 'regalarpj <nombre> @usuario',
  'cambiarpj <tuyo> + <del otro>', 'aceptarcambio', 'suertepj <nombre>',
  'personajes [página] [@usuario]', 'pjs [página] [@usuario]', 'albumespj [página]', 'ainfo <álbum>', 'toppj', 'gpjs', 'verpj <personaje>', 'overpj <personaje>', 'votarpj <personaje>',
  'wish <personaje>', 'wishremove <personaje>', 'wishlist',
]
handler.tags = ['mudae']
handler.command = [
  'onmudae', 'offmudae', 'menumudae', 'adivinarpj', 'addalbum', 'addpj', 'sugpj', 'aceptarpj', 'denegarpj', 'editpj', 'editimgpj', 'editimpj', 'delpj',
  'addchar', 'editchar', 'delchar', 'delalbum',
  'rw', 'cd', 'quitarpj', 'regalarpj', 'cambiarpj', 'aceptarcambio', 'suertepj',
  'personajes', 'pjs', 'albumespj', 'ainfo', 'toppj', 'gpjs', 'verpj', 'overpj', 'votarpj',
  'wish', 'wishremove', 'wishlist',
]
handler.group = true

export default handler

import crypto from 'crypto'
import { readFileSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import fetch from 'node-fetch'
import { Blob, FormData } from 'formdata-node'

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
  TRADE_COOLDOWN: 12 * 60 * 60 * 1000,
  VOTE_COOLDOWN: 24 * 60 * 60 * 1000,
  VOTE_VALUE_INCREMENT: 125,
  WISHLIST_LIMIT: 3,
  DEFAULT_CHARACTER_VALUE: 1000,
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
  users: {},
  rollCounts: {},
  rollCooldowns: {},
  claimCounts: {},
  claimCooldowns: {},
  tradeCooldowns: {},
  voteCooldowns: {},
  pendingVotes: {},
  lastRollAt: 0,
  activeRolls: [],
  pendingTrade: null,
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
  return {
    id: String(character?.id || crypto.randomUUID()),
    name,
    album,
    value: Number(character?.value || MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE),
    imageUrl,
    cloudinaryPublicId,
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
      previousCharacters.find((character) => normalizeMudaeIdentity(character.name) === normalizeMudaeIdentity(catalogCharacter.name))
    const next = {
      ...catalogCharacter,
      value: Number(previous?.value || catalogCharacter.value || MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE),
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

const uploadCloudinaryImage = async ({ file, mimeType, filename, publicId }) => {
  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials()
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'mudae'
  const parameters = { folder, format: 'webp', public_id: publicId, timestamp }
  const signature = makeCloudinarySignature(parameters, apiSecret)
  const form = new FormData()
  if (Buffer.isBuffer(file)) {
    form.set('file', new Blob([file], { type: mimeType || 'image/jpeg' }), filename || 'character-image')
  } else {
    form.set('file', String(file || ''))
  }
  form.set('api_key', apiKey)
  form.set('timestamp', String(timestamp))
  form.set('folder', folder)
  form.set('format', 'webp')
  form.set('public_id', publicId)
  form.set('signature', signature)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body: form,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.secure_url || !result.public_id) {
    const message = result.error?.message || `Cloudinary rechazó la imagen (HTTP ${response.status}).`
    if (/invalid signature/i.test(message)) {
      throw new Error(`${message} Verificá que CLOUDINARY_URL o las tres variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET pertenezcan a la misma cuenta, y que el API secret siga vigente.`)
    }
    throw new Error(message)
  }
  return { imageUrl: result.secure_url, cloudinaryPublicId: result.public_id }
}

const uploadCharacterImage = async (buffer, mimeType) => uploadCloudinaryImage({
  file: buffer,
  mimeType,
  filename: 'character-image.webp',
  publicId: makeMudaeCloudinaryPublicId(),
})

export const uploadRemoteMudaeImage = async (imageUrl, source = imageUrl) => uploadCloudinaryImage({
  file: imageUrl,
  publicId: makeMudaeCloudinaryPublicId(source),
})

const deleteCloudinaryImage = async (publicId) => {
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
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, {
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

export const hasQuotedMudaeImage = (m) => Boolean(getQuotedImage(m))

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

const sendLongText = async (conn, chat, text, quoted) => {
  const lines = text.split('\n')
  let chunk = ''
  for (const line of lines) {
    const next = chunk ? `${chunk}\n${line}` : line
    if (next.length > 3500 && chunk) {
      await conn.reply(chat, chunk, quoted)
      chunk = line
    } else {
      chunk = next
    }
  }
  if (chunk) await conn.reply(chat, chunk, quoted)
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
      if (!state.enabled) state.activeRolls = []
      await saveState(state)
      return conn.reply(m.chat, `🎴 *MUDAE ${state.enabled ? 'ACTIVADO' : 'DESACTIVADO'}*\nEste grupo ${state.enabled ? 'ya puede jugar' : 'ya no puede jugar'}.`, m)
    })
  }

  if (action === 'menumudae') {
    return conn.reply(m.chat, `╭━━━〔 🎴 *MUDAE* 〕━━━╮\n\n*🎲 JUGAR*\n✦ *%rw* — después de votar, tirá personajes durante 24 h; reaccioná con ❤️ para reclamar. Si ya está reclamado, no hay que esperar.\n✦ *%cd* — consultar tus esperas\n✦ *%votarpj <nombre>* — sumar *125* al valor y habilitar tiradas durante 24 h (un voto cada 24 h)\n\n*👑 TUS PERSONAJES*\n✦ *%personajes / %pjs [@usuario]* — colección propia o de otra persona\n✦ *%albumespj* — álbumes y cantidad de personajes\n✦ *%quitarpj <nombre>* — liberá un personaje\n✦ *%regalarpj <nombre> @usuario* — regalá uno a otra persona\n✦ *%suertepj <nombre>* — cambiá uno propio por uno libre al azar (cada 12 h)\n✦ *%cambiarpj <tuyo> + <del otro>* — proponé intercambio; el otro tiene 30 s para aceptar con *%aceptarcambio*\n✦ *%toppj* — ranking del grupo (top 10)\n✦ *%verpj <nombre>* — ficha, imagen y dueño\n✦ *%ainfo <álbum>* — personajes y valores del álbum\n\n*💖 DESEOS*\n✦ *%wish <nombre>* — guardar (máximo 3)\n✦ *%wishremove <nombre>* — quitar de tu lista\n✦ *%wishlist* — ver tus deseados; te mencionamos cuando salgan\n\n*🛠️ ADMINISTRACIÓN · ADMINS*\n✦ *%addalbum <nombre>* — crear álbum\n✦ *%addpj <álbum> + <nombre>* — responder a una imagen para agregar\n✦ *%editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>*\n✦ *%delpj <álbum> + <nombre>* — borrar personaje (owner del bot)\n✦ *%delalbum <nombre>* — borrar álbum vacío\n✦ *%onmudae / %offmudae* — activar o desactivar (owner)\n╰━━━━━━━━━━━━━━━━━━━━╯`, m)
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
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden agregar personajes.', m)
    const parts = parseMudaeParts(text, 2)
    if (!parts) return conn.reply(m.chat, `Uso: ${usedPrefix}addpj <álbum> + <nombre>\nRespondé al mensaje de una imagen con ese comando.`, m)
    const quotedImage = getQuotedImage(m)
    if (!quotedImage) return conn.reply(m.chat, 'No detecté la imagen respondida. Respondé directamente al mensaje que contiene la imagen y usá %addpj <álbum> + <nombre>.', m)
    try {
      const image = typeof quotedImage.download === 'function'
        ? await quotedImage.download()
        : await conn.downloadM(quotedImage.media, 'image')
      if (!Buffer.isBuffer(image) || !image.length) throw new Error('No se pudo descargar la imagen citada.')
      return await withGroupLock(m.chat, async () => {
        const current = await loadState(m.chat)
        const catalog = await loadCatalog()
        const album = catalog.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(parts[0]))
        if (!album) return conn.reply(m.chat, `No existe el álbum "${parts[0]}". Crealo primero con %addalbum.`, m)
        const identity = normalizeMudaeIdentity(parts[1])
        if (catalog.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
          return conn.reply(m.chat, 'Ya existe un personaje con ese nombre en el catálogo global. Los nombres deben ser únicos.', m)
        }
        getCloudinaryCredentials()
        const mimeType = quotedImage.media.mimetype || 'image/jpeg'
        const uploaded = await uploadCharacterImage(image, mimeType)
        const character = {
          id: crypto.randomUUID(),
          name: normalizeMudaeLabel(parts[1]),
          album,
          value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
          imageUrl: uploaded.imageUrl,
          cloudinaryPublicId: uploaded.cloudinaryPublicId,
          owner: null,
          createdAt: Date.now(),
        }
        try {
          await withCatalogLock(async () => {
            const lockedCatalog = await loadCatalog()
            if (lockedCatalog.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
              throw new Error('Ya existe un personaje con ese nombre en el catálogo global.')
            }
            lockedCatalog.characters.push(normalizeCatalogCharacter(character))
            addCatalogAlbum(lockedCatalog, album)
            await saveCatalog(lockedCatalog)
            syncStateWithCatalog(current, lockedCatalog)
          })
          await saveState(current)
        } catch (saveError) {
          try {
            await deleteCloudinaryImage(uploaded.cloudinaryPublicId)
          } catch (cleanupError) {
            console.error('[MUDAE] No se pudo limpiar de Cloudinary una imagen sin registro:', cleanupError?.stack || cleanupError)
            throw new Error(`${saveError.message} La imagen ${uploaded.cloudinaryPublicId} también debe eliminarse manualmente de Cloudinary.`)
          }
          throw saveError
        }
        return conn.reply(m.chat, `✅ *PERSONAJE AGREGADO PARA TODOS LOS GRUPOS*\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}`, m)
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
      await deleteCloudinaryImage(character.cloudinaryPublicId)
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
    const lines = state.albums
      .map((album) => {
        const count = state.characters.filter((character) =>
          normalizeMudaeIdentity(character.album) === normalizeMudaeIdentity(album)
        ).length
        return `📚 *${album}* — ${count} ${count === 1 ? 'personaje' : 'personajes'}`
      })
      .sort((first, second) => first.localeCompare(second, 'es'))
    return sendLongText(
      conn,
      m.chat,
      `📚 *ÁLBUMES DE PERSONAJES*\n\n${lines.join('\n')}\n\nÁlbumes: ${lines.length} · Personajes: ${state.characters.length}`,
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
      return conn.sendMessage(
        m.chat,
        {
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
      const rankedCharacters = [...current.characters].sort((first, second) =>
        Number(second.value || 0) - Number(first.value || 0)
      )
      const rankById = new Map(rankedCharacters.map((character, rank) => [character.id, rank]))
      const weightedCharacters = availableCharacters.map((character) => ({
        character,
        weight: getRollWeight(rankById.get(character.id)),
      })).sort((first, second) =>
        rankById.get(first.character.id) - rankById.get(second.character.id)
      )
      const totalWeight = weightedCharacters.reduce((total, item) => total + item.weight, 0)
      let randomWeight = Math.random() * totalWeight
      let character = weightedCharacters.at(-1).character
      for (const item of weightedCharacters) {
        randomWeight -= item.weight
        if (randomWeight < 0) {
          character = item.character
          break
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
        sent = await conn.sendMessage(m.chat, {
          image: { url: character.imageUrl },
          caption: `❤️ *PERSONAJE*\n\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}${wishLine}${ownershipLine}${owner ? '' : '\n⏱️ Vence en 1 minuto.'}${rollCount + 1 >= MUDAE_CONFIG.ROLL_LIMIT ? '\n⏳ Agotaste tus 10 tiradas RW; podés volver a tirar en 30 minutos.' : ''}`,
          mentions,
        })
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
    const target = await getMentionTarget(m, conn, text)
    const collection = state.characters.filter((character) => normalizeJid(character.owner) === target)
    const ownerName = target === actor ? (m.pushName || await getDisplayName(conn, target)) : await getDisplayName(conn, target)
    if (!collection.length) return conn.reply(m.chat, `👑 *${ownerName} todavía no tiene personajes en este grupo.*`, m)
    const total = collection.reduce((sum, character) => sum + Number(character.value || 0), 0)
    const grouped = new Map()
    for (const character of collection) {
      const albumCharacters = grouped.get(character.album) || []
      albumCharacters.push(character)
      grouped.set(character.album, albumCharacters)
    }
    let number = 1
    const details = [...grouped].map(([album, characters]) =>
      `📚 *${album}*\n${characters.map((character) => `${number++}. *${character.name}* — ${formatMoney(character.value)}`).join('\n')}`
    ).join('\n\n')
    return sendLongText(conn, m.chat, `👑 *PERSONAJES DE ${ownerName.toLocaleUpperCase('es')}*\n${details}\n\n🎴 Personajes: ${collection.length}\n💰 Valor total: ${formatMoney(total)}`, m)
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
    const lines = characters.map((character, index) => `${index + 1}. *${character.name}* — ${formatMoney(character.value)}`)
    return sendLongText(conn, m.chat, `📚 *PERSONAJES DE ${album.toLocaleUpperCase('es')}*\n${lines.join('\n')}\n🎴 Total: ${characters.length}`, m)
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
    const sorted = [...ranking].sort((a, b) => b[1].count - a[1].count || b[1].value - a[1].value || a[0].localeCompare(b[0]))
    if (!sorted.length) return conn.reply(m.chat, '🏆 *TODAVÍA NO HAY RECLAMOS*\n¡Sé el primero en conseguir un personaje!', m)
    const medals = ['🥇', '🥈', '🥉']
    const top = sorted.slice(0, 10)
    const lines = await Promise.all(top.map(async ([jid, score], index) =>
      `${medals[index] || `*${index + 1}.*`} @${jid.split('@')[0]}  ·  🎴 ${score.count}  ·  💰 ${formatMoney(score.value)}`
    ))
    return conn.sendMessage(m.chat, {
      text: `🏆 *TOP 10 PERSONAJES*\n_Ranking por cantidad de personajes · desempate por valor_\n\n${lines.join('\n')}`,
      mentions: top.map(([jid]) => jid),
    }, { quoted: m })
  }

  if (action === 'verpj') {
    const query = String(text || '').trim()
    if (!query) return conn.reply(m.chat, `Uso: ${usedPrefix}verpj <personaje>`, m)
    const { character, matches } = findCharacter(state, query)
    if (matches.length > 1) return replyAmbiguous(conn, m, matches)
    if (!character) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
    const info = await buildCharacterInfo(conn, character)
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
      if (availableAt > now && current.pendingVotes[actor]) {
        return conn.reply(m.chat, `Ya tenés un voto pendiente. Usá *${usedPrefix}rw* para tirar antes de volver a votar.`, m)
      }
      if (availableAt > now) {
        const remainingHours = Math.ceil((availableAt - now) / (60 * 60 * 1000))
        return conn.reply(m.chat, `⏳ Ya votaste en las últimas 24 horas. Podés volver a votar en aproximadamente ${remainingHours} h.`, m)
      }
      delete current.pendingVotes[actor]
      character.value = Number(character.value || 0) + MUDAE_CONFIG.VOTE_VALUE_INCREMENT
      current.voteCooldowns[actor] = now + MUDAE_CONFIG.VOTE_COOLDOWN
      current.pendingVotes[actor] = true
      await saveState(current)
      return conn.reply(m.chat, `🗳️ *VOTO REGISTRADO*\n🎴 *${character.name}* ahora vale *${formatMoney(character.value)}* (+${formatMoney(MUDAE_CONFIG.VOTE_VALUE_INCREMENT)}).\nPodés tirar con *%rw* durante las próximas 24 horas y votar de nuevo después.`, m)
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
  if (isGroupJid(m?.chat)) registerReactionListener(this)
}

handler.init = registerReactionListener
handler.processReaction = processReaction
handler.hasQuotedImage = hasQuotedMudaeImage
handler.help = [
  'onmudae', 'offmudae',
  'menumudae', 'addalbum <nombre>', 'addpj <álbum> + <nombre>',
  'editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>',
  'delpj <álbum> + <nombre>', 'delalbum <nombre>',
  'rw', 'cd', 'quitarpj <nombre>', 'regalarpj <nombre> @usuario',
  'cambiarpj <tuyo> + <del otro>', 'aceptarcambio', 'suertepj <nombre>',
  'personajes [@usuario]', 'pjs [@usuario]', 'albumespj', 'ainfo <álbum>', 'toppj', 'verpj <personaje>', 'votarpj <personaje>',
  'wish <personaje>', 'wishremove <personaje>', 'wishlist',
]
handler.tags = ['mudae']
handler.command = [
  'onmudae', 'offmudae', 'menumudae', 'addalbum', 'addpj', 'editpj', 'delpj',
  'addchar', 'editchar', 'delchar', 'delalbum',
  'rw', 'cd', 'quitarpj', 'regalarpj', 'cambiarpj', 'aceptarcambio', 'suertepj',
  'personajes', 'pjs', 'albumespj', 'ainfo', 'toppj', 'verpj', 'votarpj',
  'wish', 'wishremove', 'wishlist',
]
handler.group = true

export default handler

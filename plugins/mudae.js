import crypto from 'crypto'
import { readFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import fetch from 'node-fetch'
import { Blob, FormData } from 'formdata-node'

export const MUDAE_CONFIG = Object.freeze({
  ROLL_COOLDOWN: 5000,
  ROLL_LIMIT: 10,
  ROLL_EXHAUSTED_COOLDOWN: 30 * 60 * 1000,
  CLAIM_LIMIT: 2,
  CLAIM_COOLDOWN: 60 * 60 * 1000,
  CLAIM_DURATION: 60 * 1000,
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

const dataDirectory = process.env.MUDAE_DATA_DIR || path.join(process.cwd(), 'data', 'mudae')
const catalogFile = process.env.MUDAE_CATALOG_FILE || path.join(dataDirectory, 'catalog.json')
const groupLocks = new Map()
const stateCache = new Map()
const stateLoads = new Map()
let catalogLock = Promise.resolve()
let catalogCache = null
let catalogLoad = null
const reactionListenerSymbol = Symbol.for('joa-king.mudae.reaction-listener')

export const normalizeMudaeIdentity = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
export const normalizeMudaeLabel = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('es')
  .replace(/(^|\s)(\p{L})/gu, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase('es')}`)
const normalizeJid = (jid) => String(jid || '').trim().replace(/:\d+(?=@)/, '').toLowerCase()
const isGroupJid = (jid) => typeof jid === 'string' && jid.endsWith('@g.us')
const getStateFile = (groupId) => path.join(dataDirectory, `group-${crypto.createHash('sha256').update(groupId).digest('hex')}.json`)
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
  voteCooldowns: {},
  lastRollAt: 0,
  activeRolls: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
const defaultCatalog = () => ({
  version: 1,
  albums: [],
  characters: [],
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
  const name = normalizeMudaeIdentity(character?.name || character?.nombre)
  return catalog.characters.findIndex((item) => normalizeMudaeIdentity(item.name) === name)
}

const loadCatalog = async () => {
  if (catalogCache) return catalogCache
  if (catalogLoad) return catalogLoad
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
      if (!characters.some((item) => normalizeMudaeIdentity(item.name) === normalizeMudaeIdentity(normalized.name))) {
        characters.push(normalized)
      } else {
        migrated = true
      }
      if (JSON.stringify(normalized) !== JSON.stringify(character)) migrated = true
    }

    catalog.albums = albums
    catalog.characters = characters
    if (migrated) await saveCatalog(catalog)
    else catalogCache = catalog
    return catalog
  })()
  try {
    return await catalogLoad
  } finally {
    if (catalogLoad) catalogLoad = null
  }
}

const saveCatalog = async (catalog) => {
  await fs.mkdir(dataDirectory, { recursive: true })
  catalog.updatedAt = Date.now()
  const temporaryFile = `${catalogFile}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryFile, catalogFile)
    catalogCache = catalog
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {})
    catalogCache = null
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
  if (cached) return cached
  const pending = stateLoads.get(groupId)
  if (pending) return pending
  const loading = (async () => {
    let state
    try {
      state = JSON.parse(await fs.readFile(getStateFile(groupId), 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`No se pudo leer el estado de Mudae: ${error.message}`)
      state = defaultState(groupId)
    }
    if (!state || typeof state !== 'object' || state.groupId !== groupId) {
      throw new Error('El archivo de Mudae tiene un grupo inválido o está dañado.')
    }
    state = { ...defaultState(groupId), ...state }
    if (!Array.isArray(state.albums) || !Array.isArray(state.characters) || !state.users || typeof state.users !== 'object') {
      throw new Error('El archivo de Mudae no tiene una estructura válida.')
    }
    let migrated = false
    if (!Array.isArray(state.activeRolls) || (state.activeRoll && !state.activeRolls.length)) {
      state.activeRolls = state.activeRoll ? [state.activeRoll] : []
      delete state.activeRoll
      migrated = true
    }
    state.activeRolls = state.activeRolls
      .filter((roll) => roll && typeof roll.messageId === 'string' && typeof roll.characterId === 'string' && Number.isFinite(Number(roll.expiresAt)))
      .map((roll) => ({ ...roll, expiresAt: Number(roll.expiresAt) }))
    for (const key of ['rollCounts', 'rollCooldowns', 'claimCounts', 'claimCooldowns', 'voteCooldowns']) {
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
const findCharacter = (state, query) => {
  const parts = String(query || '').split('+').map((part) => part.trim())
  const normalized = normalizeMudaeIdentity(query)
  if (!normalized) return { character: null, matches: [] }
  const matches = parts.length === 2 && parts.every(Boolean)
    ? state.characters.filter((character) =>
      makeCharacterIdentity(character.album, character.name) === makeCharacterIdentity(...parts)
    )
    : state.characters.filter((character) => normalizeMudaeIdentity(character.name) === normalized)
  return { character: matches.length === 1 ? matches[0] : null, matches }
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
    throw new Error(result.error?.message || `Cloudinary rechazó la imagen (HTTP ${response.status}).`)
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
  const signature = makeCloudinarySignature({ public_id: publicId, timestamp }, apiSecret)
  const form = new URLSearchParams({
    public_id: publicId,
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
const getMentionTarget = (m, text) => {
  const mention = m.mentionedJid?.[0]
  if (mention) return normalizeJid(mention)
  const number = String(text || '').match(/@(\d{7,16})/)
  return number ? `${number[1]}@s.whatsapp.net` : getActorJid(m)
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
    return conn.reply(m.chat, `╭━━━〔 🎴 *MUDAE* 〕━━━╮\n\n*🎲 JUGAR*\n        ✦ *%rw* — personaje aleatorio; reaccioná con ❤️ para reclamarlo (vence al minuto)
    ✦ *%cd* — consultar tus esperas\n✦ *%votarpj <nombre>* — sumar *125* al valor (un voto cada 24 h)\n\n*👑 TUS PERSONAJES*\n✦ *%personajes [@usuario]* — colección y valor total\n✦ *%quitarpj <nombre>* — liberá un personaje\n✦ *%regalarpj <nombre> + @usuario* — regalá uno a otra persona\n✦ *%toppj* — ranking del grupo (top 10)\n✦ *%verpj <nombre>* — ficha, imagen y dueño\n\n*💖 DESEOS*\n✦ *%wish <nombre>* — guardar (máximo 3)\n✦ *%wishremove <nombre>* — quitar de tu lista\n✦ *%wishlist* — ver tus deseados; te mencionamos cuando salgan\n\n*🛠️ ADMINISTRACIÓN · ADMINS*\n✦ *%addalbum <nombre>* — crear álbum\n✦ *%addpj <álbum> + <nombre>* — responder a una imagen para agregar\n✦ *%editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>*\n✦ *%delpj <álbum> + <nombre>* — borrar personaje\n✦ *%delalbum <nombre>* — borrar álbum vacío\n✦ *%onmudae / %offmudae* — activar o desactivar (owner)\n╰━━━━━━━━━━━━━━━━━━━━╯`, m)
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
    const rollCooldown = Number(current.rollCooldowns[actor] || 0) - now
    const claimCooldown = Number(current.claimCooldowns[actor] || 0) - now
    const voteCooldown = Number(current.voteCooldowns[actor] || 0) - now
    const groupCooldown = Number(current.lastRollAt || 0) + MUDAE_CONFIG.ROLL_COOLDOWN - now
    const rollCount = rollCooldown > 0 ? Number(current.rollCounts[actor] || 0) : 0
    const claimCount = claimCooldown > 0 ? Number(current.claimCounts[actor] || 0) : 0
    const waits = [
      `🎲 Tiradas RW: ${Math.max(0, MUDAE_CONFIG.ROLL_LIMIT - rollCount)}/${MUDAE_CONFIG.ROLL_LIMIT}${rollCooldown > 0 ? ` · disponibles en ${formatWait(rollCooldown)}` : ''}`,
      `❤️ Reclamos: ${Math.max(0, MUDAE_CONFIG.CLAIM_LIMIT - claimCount)}/${MUDAE_CONFIG.CLAIM_LIMIT}${claimCooldown > 0 ? ` · disponibles en ${formatWait(claimCooldown)}` : ''}`,
      `🗳️ Voto: ${voteCooldown > 0 ? `disponible en ${formatWait(voteCooldown)}` : 'disponible'}`,
      `⏱️ Próxima tirada del grupo: ${groupCooldown > 0 ? `en ${formatWait(groupCooldown)}` : 'disponible'}`,
    ]
    const activeRolls = current.activeRolls.filter((roll) => roll.expiresAt > now)
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
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden eliminar personajes.', m)
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

  if (action === 'quitarpj' || action === 'regalarpj') {
    const gifting = action === 'regalarpj'
    const parts = parseMudaeParts(text, gifting ? 2 : 1)
    if (!parts) {
      const usage = gifting
        ? `Uso: ${usedPrefix}regalarpj <nombre> + @usuario`
        : `Uso: ${usedPrefix}quitarpj <nombre>`
      return conn.reply(m.chat, usage, m)
    }

    const recipient = m.mentionedJid?.[0] ? normalizeJid(m.mentionedJid[0]) : ''
    const characterName = gifting
      ? (parts[0].includes('@') ? parts[1] : parts[0])
      : parts[0]
    if (gifting && !recipient) return conn.reply(m.chat, 'Mencioná a la persona que va a recibir el personaje.', m)
    if (gifting && recipient === actor) return conn.reply(m.chat, 'No podés regalarte un personaje a vos mismo.', m)

    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      const matches = current.characters.filter((item) =>
        normalizeMudaeIdentity(item.name) === normalizeMudaeIdentity(characterName)
      )
      if (matches.length > 1) return conn.reply(m.chat, 'Hay personajes con ese nombre repetido en los datos anteriores; no cambié ningún propietario.', m)
      const character = matches[0]
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

  if (action === 'rw') {
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      if (!current.enabled) return conn.reply(m.chat, 'Mudae está desactivado en este grupo.', m)
      const now = Date.now()
      current.activeRolls = current.activeRolls.filter((roll) => roll.expiresAt > now)
      if (now < Number(current.lastRollAt || 0) + MUDAE_CONFIG.ROLL_COOLDOWN) return
      const availableAt = Number(current.rollCooldowns[actor] || 0)
      if (availableAt > now) return
      if (availableAt > 0) {
        current.rollCounts[actor] = 0
        delete current.rollCooldowns[actor]
      }
      const rollCount = Number(current.rollCounts[actor] || 0)
      if (rollCount >= MUDAE_CONFIG.ROLL_LIMIT) return
      const activeCharacterIds = new Set(current.activeRolls.map((roll) => roll.characterId))
      const availableCharacters = current.characters.filter((character) => !character.owner && !activeCharacterIds.has(character.id))
      if (!availableCharacters.length) {
        await saveState(current)
        return conn.reply(m.chat, '🎴 *NO HAY PERSONAJES DISPONIBLES*\nProbá de nuevo cuando agreguen más personajes.', m)
      }
      const character = availableCharacters[Math.floor(Math.random() * availableCharacters.length)]
      const expiresAt = now + MUDAE_CONFIG.CLAIM_DURATION
      const wishers = Object.entries(current.users)
        .filter(([, user]) => Array.isArray(user?.wishlist) && user.wishlist.includes(character.id))
        .map(([jid]) => normalizeJid(jid))
      const wishLine = wishers.length
        ? `\n💖 *Deseado por:* ${wishers.map((jid) => `@${jid.split('@')[0]}`).join(', ')}`
        : ''
      let sent
      try {
        sent = await conn.sendMessage(m.chat, {
          image: { url: character.imageUrl },
          caption: `❤️ *PERSONAJE*\n\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}${wishLine}\n\nReaccioná con ❤️ para reclamarlo.\n⏱️ Vence en 1 minuto.${rollCount + 1 >= MUDAE_CONFIG.ROLL_LIMIT ? '\n⏳ Agotaste tus 10 tiradas RW; podés volver a tirar en 30 minutos.' : ''}`,
          mentions: wishers,
        })
        if (!sent?.key?.id) throw new Error('WhatsApp no devolvió el ID del mensaje del roll.')
        current.activeRolls.push({ messageId: sent.key.id, characterId: character.id, expiresAt })
        current.rollCounts[actor] = rollCount + 1
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

  if (action === 'personajes') {
    const target = getMentionTarget(m, text)
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
    return sendLongText(conn, m.chat, `👑 *PERSONAJES DE ${ownerName.toLocaleUpperCase('es')}*\n\n${details}\n\n🎴 Personajes: ${collection.length}\n💰 Valor total: ${formatMoney(total)}`, m)
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
      if (availableAt > now) {
        const remainingHours = Math.ceil((availableAt - now) / (60 * 60 * 1000))
        return conn.reply(m.chat, `⏳ Ya votaste en las últimas 24 horas. Podés volver a votar en aproximadamente ${remainingHours} h.`, m)
      }
      character.value = Number(character.value || 0) + MUDAE_CONFIG.VOTE_VALUE_INCREMENT
      current.voteCooldowns[actor] = now + MUDAE_CONFIG.VOTE_COOLDOWN
      await saveState(current)
      return conn.reply(m.chat, `🗳️ *VOTO REGISTRADO*\n🎴 *${character.name}* ahora vale *${formatMoney(character.value)}* (+${formatMoney(MUDAE_CONFIG.VOTE_VALUE_INCREMENT)}).\nPodés votar de nuevo en 24 horas.`, m)
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
  'rw', 'cd', 'quitarpj <nombre>', 'regalarpj <nombre> + @usuario',
  'personajes [@usuario]', 'toppj', 'verpj <personaje>', 'votarpj <personaje>',
  'wish <personaje>', 'wishremove <personaje>', 'wishlist',
]
handler.tags = ['mudae']
handler.command = [
  'onmudae', 'offmudae', 'menumudae', 'addalbum', 'addpj', 'editpj', 'delpj',
  'addchar', 'editchar', 'delchar', 'delalbum',
  'rw', 'cd', 'quitarpj', 'regalarpj', 'personajes', 'toppj', 'verpj', 'votarpj',
  'wish', 'wishremove', 'wishlist',
]
handler.group = true

export default handler

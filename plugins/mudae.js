import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import fetch from 'node-fetch'
import { Blob, FormData } from 'formdata-node'

export const MUDAE_CONFIG = Object.freeze({
  ROLL_COOLDOWN: 5000,
  CLAIM_COOLDOWN: 20 * 60 * 1000,
  CLAIM_DURATION: 60 * 1000,
  VOTE_COOLDOWN: 24 * 60 * 60 * 1000,
  VOTE_VALUE_INCREMENT: 125,
  WISHLIST_LIMIT: 3,
  DEFAULT_CHARACTER_VALUE: 1000,
})

const dataDirectory = process.env.MUDAE_DATA_DIR || path.join(process.cwd(), 'data', 'mudae')
const groupLocks = new Map()
const stateCache = new Map()
const stateLoads = new Map()
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
  rollCooldowns: {},
  claimCooldowns: {},
  voteCooldowns: {},
  activeRoll: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

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
    state.albums = state.albums.map((album) => {
      const normalized = normalizeMudaeLabel(album)
      if (normalized !== album) migrated = true
      return normalized
    })
    state.characters = state.characters.map((character) => {
      const album = normalizeMudaeLabel(character.album)
      const name = normalizeMudaeLabel(character.name)
      const normalizedCharacter = { ...character, album, name }
      if (album !== character.album || name !== character.name || Object.hasOwn(character, 'variant')) migrated = true
      delete normalizedCharacter.variant
      return normalizedCharacter
    })
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
  const credentials = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || urlCredentials.cloudName,
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() || urlCredentials.apiKey,
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() || urlCredentials.apiSecret,
  }
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

const uploadCharacterImage = async (buffer, mimeType, groupId) => {
  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials()
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'mudae'
  const publicId = `${crypto.createHash('sha256').update(groupId).digest('hex').slice(0, 20)}/${crypto.randomUUID()}`
  const signature = makeCloudinarySignature({ folder, public_id: publicId, timestamp }, apiSecret)
  const form = new FormData()
  form.set('file', new Blob([buffer], { type: mimeType || 'image/jpeg' }), 'character-image')
  form.set('api_key', apiKey)
  form.set('timestamp', String(timestamp))
  form.set('folder', folder)
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
    throw new Error(result.error?.message || `Cloudinary no pudo borrar ${publicId} (HTTP ${response.status}).`)
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
    const roll = state.activeRoll
    if (!state.enabled || !roll || roll.messageId !== messageId || roll.expiresAt <= Date.now()) {
      if (roll && roll.expiresAt <= Date.now()) {
        state.activeRoll = null
        await saveState(state)
      }
      return
    }
    const character = state.characters.find((item) => item.id === roll.characterId)
    if (!character || character.owner) {
      state.activeRoll = null
      await saveState(state)
      return
    }
    const now = Date.now()
    const claimAvailableAt = Number(state.claimCooldowns[userJid] || 0)
    if (claimAvailableAt > now) {
      const remainingMinutes = Math.ceil((claimAvailableAt - now) / 60000)
      await conn.sendMessage(groupId, { text: `Todavía tenés cooldown para reclamar: ${remainingMinutes} min. El personaje sigue disponible para este grupo.` })
      return
    }

    character.owner = userJid
    character.claimedAt = now
    state.claimCooldowns[userJid] = now + MUDAE_CONFIG.CLAIM_COOLDOWN
    state.activeRoll = null
    await saveState(state)

    const name = await getDisplayName(conn, userJid)
    await conn.sendMessage(groupId, {
      text: `🎉 *¡Reclamado!*\n\n🎴 *${character.name}*\n📚 ${character.album} · ${formatMoney(character.value)}\n👑 @${userJid.split('@')[0]}`,
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
      if (!state.enabled) state.activeRoll = null
      await saveState(state)
      return conn.reply(m.chat, `🎴 *MUDAE ${state.enabled ? 'ACTIVADO' : 'DESACTIVADO'}*\nEste grupo ${state.enabled ? 'ya puede jugar' : 'ya no puede jugar'}.`, m)
    })
  }

  if (action === 'menumudae') {
    return conn.reply(m.chat, `╭━━━〔 🎴 *MUDAE* 〕━━━╮\n\n*🎲 JUGAR*\n✦ *%rw* — personaje aleatorio; reaccioná con ❤️ para reclamarlo\n✦ *%votarpj <nombre>* — sumar *125* al valor (un voto cada 24 h)\n\n*👑 TUS PERSONAJES*\n✦ *%personajes [@usuario]* — colección y valor total\n✦ *%quitarpj <nombre>* — liberá un personaje\n✦ *%regalarpj <nombre> + @usuario* — regalá uno a otra persona\n✦ *%toppj* — ranking del grupo (top 10)\n✦ *%verpj <nombre>* — ficha, imagen y dueño\n\n*💖 DESEOS*\n✦ *%wish <nombre>* — guardar (máximo 3)\n✦ *%wishremove <nombre>* — quitar de tu lista\n✦ *%wishlist* — ver tus deseados; te mencionamos cuando salgan\n\n*🛠️ ADMINISTRACIÓN · ADMINS*\n✦ *%addalbum <nombre>* — crear álbum\n✦ *%addpj <álbum> + <nombre>* — responder a una imagen para agregar\n✦ *%editpj <álbum actual> + <nombre actual> + <álbum nuevo> + <nombre nuevo>*\n✦ *%delpj <álbum> + <nombre>* — borrar personaje\n✦ *%delalbum <nombre>* — borrar álbum vacío\n✦ *%onmudae / %offmudae* — activar o desactivar (owner)\n╰━━━━━━━━━━━━━━━━━━━━╯`, m)
  }

  const state = await ensureEnabled(m, conn)
  if (!state) return

  if (action === 'addalbum') {
    if (!isAdminOrOwner(isOwner, isAdmin)) return conn.reply(m.chat, 'Solo los administradores del grupo pueden crear álbumes.', m)
    const album = normalizeMudaeLabel(text)
    if (!album) return conn.reply(m.chat, `Uso: ${usedPrefix}addalbum <nombre>`, m)
    return withGroupLock(m.chat, async () => {
      const current = await loadState(m.chat)
      if (current.albums.some((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(album))) {
        return conn.reply(m.chat, 'Ese álbum ya existe en este grupo.', m)
      }
      current.albums.push(album)
      await saveState(current)
      return conn.reply(m.chat, `📚 *ÁLBUM CREADO*\n${album}`, m)
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
        const album = current.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(parts[0]))
        if (!album) return conn.reply(m.chat, `No existe el álbum "${parts[0]}". Crealo primero con %addalbum.`, m)
        const identity = normalizeMudaeIdentity(parts[1])
        if (current.characters.some((item) => normalizeMudaeIdentity(item.name) === identity)) {
          return conn.reply(m.chat, 'Ya existe un personaje con ese nombre en este grupo. Los nombres deben ser únicos.', m)
        }
        getCloudinaryCredentials()
        const mimeType = quotedImage.media.mimetype || 'image/jpeg'
        const uploaded = await uploadCharacterImage(image, mimeType, m.chat)
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
        current.characters.push(character)
        try {
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
        return conn.reply(m.chat, `✅ *PERSONAJE AGREGADO*\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}`, m)
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
      const original = current.characters.find((item) => makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(parts[0], parts[1]))
      if (!original) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      const album = current.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(parts[2]))
      if (!album) return conn.reply(m.chat, `No existe el álbum "${parts[2]}".`, m)
      if (current.characters.some((item) => item.id !== original.id && normalizeMudaeIdentity(item.name) === normalizeMudaeIdentity(parts[3]))) {
        return conn.reply(m.chat, 'Ya existe un personaje con ese nombre en este grupo; no se realizaron cambios.', m)
      }
      original.album = album
      original.name = normalizeMudaeLabel(parts[3])
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
      const matchingIndexes = current.characters.flatMap((item, index) =>
        makeCharacterIdentity(item.album, item.name) === makeCharacterIdentity(parts[0], parts[1]) ? [index] : []
      )
      if (matchingIndexes.length > 1) {
        return conn.reply(m.chat, 'Hay personajes duplicados con ese álbum y nombre; no eliminé ninguno para preservar los datos.', m)
      }
      const index = matchingIndexes[0] ?? -1
      if (index < 0) return conn.reply(m.chat, 'No encontré ese personaje en este grupo.', m)
      const character = current.characters[index]
      await deleteCloudinaryImage(character.cloudinaryPublicId)
      current.characters.splice(index, 1)
      for (const user of Object.values(current.users)) {
        user.wishlist = (user.wishlist || []).filter((id) => id !== character.id)
      }
      if (current.activeRoll?.characterId === character.id) current.activeRoll = null
      await saveState(current)
      return conn.reply(m.chat, `🗑️ *PERSONAJE ELIMINADO*\n🎴 *${character.name}* — ${character.album}`, m)
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
      const index = current.albums.findIndex((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(album))
      if (index < 0) return conn.reply(m.chat, 'No encontré ese álbum en este grupo.', m)
      if (current.characters.some((character) => normalizeMudaeIdentity(character.album) === normalizeMudaeIdentity(current.albums[index]))) {
        return conn.reply(m.chat, 'No se puede eliminar un álbum que todavía tiene personajes. Eliminá o mové esos personajes primero.', m)
      }
      const [deletedAlbum] = current.albums.splice(index, 1)
      await saveState(current)
      return conn.reply(m.chat, `🗑️ *ÁLBUM ELIMINADO*\n${deletedAlbum}`, m)
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
        if (current.activeRoll?.characterId === character.id) current.activeRoll = null
        await saveState(current)
        return conn.sendMessage(m.chat, {
          text: `🎁 *PERSONAJE REGALADO*\n🎴 *${character.name}* — ${character.album}\n👑 Ahora pertenece a @${recipient.split('@')[0]}.`,
          mentions: [recipient],
        }, { quoted: m })
      }

      character.owner = null
      delete character.claimedAt
      if (current.activeRoll?.characterId === character.id) current.activeRoll = null
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
      if (current.activeRoll?.expiresAt > now) {
        return conn.reply(m.chat, `⏳ *HAY UN ROLL ACTIVO*\nReaccioná a ese personaje. Vence en ${Math.ceil((current.activeRoll.expiresAt - now) / 1000)} segundos.`, m)
      }
      current.activeRoll = null
      const availableAt = Number(current.rollCooldowns[actor] || 0)
      if (availableAt > now) {
        return conn.reply(m.chat, `⏱️ *ESPERÁ UN MOMENTO*\nPodés volver a usar %rw en ${((availableAt - now) / 1000).toFixed(1)} segundos.`, m)
      }
      const availableCharacters = current.characters.filter((character) => !character.owner)
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
      try {
        const sent = await conn.sendMessage(m.chat, {
          image: { url: character.imageUrl },
          caption: `❤️ *PERSONAJE*\n\n🎴 *${character.name}*\n📚 ${character.album}\n💰 ${formatMoney(character.value)}${wishLine}\n\nReaccioná con ❤️ para reclamarlo.\n⏱️ Tenés 1 minuto.`,
          mentions: wishers,
        })
        if (!sent?.key?.id) throw new Error('WhatsApp no devolvió el ID del mensaje del roll.')
        current.activeRoll = { messageId: sent.key.id, characterId: character.id, expiresAt }
        current.rollCooldowns[actor] = now + MUDAE_CONFIG.ROLL_COOLDOWN
        await saveState(current)
        return sent
      } catch (error) {
        current.activeRoll = null
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
  'rw', 'quitarpj <nombre>', 'regalarpj <nombre> + @usuario',
  'personajes [@usuario]', 'toppj', 'verpj <personaje>', 'votarpj <personaje>',
  'wish <personaje>', 'wishremove <personaje>', 'wishlist',
]
handler.tags = ['mudae']
handler.command = [
  'onmudae', 'offmudae', 'menumudae', 'addalbum', 'addpj', 'editpj', 'delpj',
  'addchar', 'editchar', 'delchar', 'delalbum',
  'rw', 'quitarpj', 'regalarpj', 'personajes', 'toppj', 'verpj', 'votarpj',
  'wish', 'wishremove', 'wishlist',
]
handler.group = true

export default handler

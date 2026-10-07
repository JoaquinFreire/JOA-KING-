import { jidNormalizedUser } from '@whiskeysockets/baileys'
import fetch from 'node-fetch'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const safeCall = (fn) => {
  try {
    return Promise.resolve(fn()).catch(() => null)
  } catch (_) {
    return Promise.resolve(null)
  }
}

const isValidUserJid = (jid) => /^[\w.-]+@(s\.whatsapp\.net|lid)$/.test(String(jid || ''))

const pushUnique = (list, value) => {
  if (!value || typeof value === 'object') return
  const normalized = String(value).trim()
  if (normalized && !list.includes(normalized)) list.push(normalized)
}

const normalizeJid = (conn, jid) => {
  if (!jid || typeof jid !== 'string') return ''
  const raw = jid.trim()
  if (!raw) return ''
  const decoded = typeof conn?.decodeJid === 'function' ? conn.decodeJid(raw) : raw
  const value = decoded && typeof decoded.then !== 'function' ? decoded : raw
  return jidNormalizedUser(String(value || raw))
}

const resolveCandidate = async (value) => {
  let current = value
  for (let i = 0; i < 3; i++) {
    if (!current || typeof current?.then !== 'function') break
    current = await safeCall(() => current)
  }
  return typeof current === 'string' ? current : ''
}

const getContextInfo = (m) => {
  const msg = m?.msg || null
  if (msg?.contextInfo) return msg.contextInfo
  const message = m?.message || {}
  for (const value of Object.values(message)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return null
}

const getQuotedMessageContent = (quoted) => {
  const message = quoted?.message || quoted?.vM?.message || quoted?.fakeObj?.message || quoted?.mediaMessage || null
  if (message && typeof message === 'object') return message
  if (quoted?.mtype && quoted?.msg) return { [quoted.mtype]: quoted.msg }
  return null
}

const cloneQuotedMessage = (quoted) => {
  const message = getQuotedMessageContent(quoted)
  if (!message || typeof message !== 'object') return { conversation: String(quoted?.text || '') }
  return JSON.parse(JSON.stringify(message))
}

const getMessageType = (message) => {
  if (!message || typeof message !== 'object') return ''
  return Object.keys(message).find((key) => key !== 'messageContextInfo' && key !== 'senderKeyDistributionMessage') || ''
}

const collectParticipants = async ({ conn, m, chat, isGroup, contextInfo }) => {
  const candidates = []
  const primaryCandidates = []
  const quoted = m.quoted || {}
  const addCandidate = async (value, primary = false) => {
    const resolved = await resolveCandidate(value)
    if (!resolved) return
    pushUnique(candidates, resolved)
    if (primary) pushUnique(primaryCandidates, resolved)
  }

  await addCandidate(contextInfo?.participant, true)
  await addCandidate(quoted.key?.participant, true)
  await addCandidate(quoted.vM?.key?.participant, true)
  await addCandidate(quoted.fakeObj?.key?.participant, true)
  await addCandidate(quoted.sender, true)
  await addCandidate(quoted.participant)
  await addCandidate(quoted.vM?.participant)
  await addCandidate(quoted.fakeObj?.participant)

  if (isGroup && typeof conn.groupMetadata === 'function') {
    const meta = await safeCall(() => conn.groupMetadata(chat))
    const participants = Array.isArray(meta?.participants) ? meta.participants : []
    const metadataNeedles = primaryCandidates.length ? primaryCandidates : candidates
    const metaEntry = participants.find((participant) => {
      const ids = [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber]
      return ids.some((id) => metadataNeedles.some((candidate) => normalizeJid(conn, id) === normalizeJid(conn, candidate)))
    }) || null
    if (metaEntry) {
      pushUnique(candidates, metaEntry.id)
      pushUnique(candidates, metaEntry.jid)
      pushUnique(candidates, metaEntry.lid)
      pushUnique(candidates, metaEntry.phoneNumber)
    }
  }

  const lidMap = conn.signalRepository?.lidMapping
  if (isGroup && lidMap) {
    for (const jid of [...candidates]) {
      const normalized = normalizeJid(conn, jid)
      if (/@lid$/.test(normalized) && typeof lidMap.getPNForLID === 'function') {
        const pn = await safeCall(() => Promise.race([
          lidMap.getPNForLID(normalized),
          wait(4000).then(() => null),
        ]))
        pushUnique(candidates, pn)
      } else if (/@s\.whatsapp\.net$/.test(normalized) && typeof lidMap.getLIDForPN === 'function') {
        const lid = await safeCall(() => Promise.race([
          lidMap.getLIDForPN(normalized),
          wait(4000).then(() => null),
        ]))
        pushUnique(candidates, lid)
      }
    }
  }

  const participants = []
  for (const candidate of candidates) {
    const jid = normalizeJid(conn, candidate)
    if (isValidUserJid(jid)) pushUnique(participants, jid)
  }

  const primaryParticipants = []
  for (const candidate of primaryCandidates) {
    const jid = normalizeJid(conn, candidate)
    if (isValidUserJid(jid)) pushUnique(primaryParticipants, jid)
  }

  return { participants, primaryParticipants }
}

const stripEnvelopeOnlyFields = (message) => {
  if (!message || typeof message !== 'object') return message
  delete message.messageContextInfo
  delete message.senderKeyDistributionMessage
  return message
}

const replaceTextInMessage = (message, text) => {
  if (!message || typeof message !== 'object') return false
  if (typeof message.conversation === 'string') {
    message.conversation = text
    return true
  }

  const type = getMessageType(message)
  const content = message[type]
  if (!content || typeof content !== 'object') return false

  for (const key of ['text', 'caption', 'contentText', 'matchedText']) {
    if (typeof content[key] === 'string') {
      content[key] = text
      return true
    }
  }

  if (content.contextInfo?.quotedMessage && replaceTextInMessage(content.contextInfo.quotedMessage, text)) return true
  if (content.message && replaceTextInMessage(content.message, text)) return true
  return false
}

const buildSpoofContent = (quoted, text) => {
  const cloned = stripEnvelopeOnlyFields(cloneQuotedMessage(quoted))
  if (replaceTextInMessage(cloned, text)) return cloned
  return { extendedTextMessage: { text } }
}

const ensureExtendedTextForProfile = (content, text) => {
  if (content?.extendedTextMessage && typeof content.extendedTextMessage === 'object') return content
  if (typeof content?.conversation === 'string') {
    return { extendedTextMessage: { text: content.conversation || text } }
  }
  const type = getMessageType(content)
  const current = content?.[type]
  if (current && typeof current === 'object' && typeof current.caption === 'string') return content
  return { extendedTextMessage: { text } }
}

const getPrimaryTextNode = (content) => {
  const type = getMessageType(content)
  if (!type) return null
  return content[type] && typeof content[type] === 'object' ? content[type] : null
}

const fetchProfileThumb = async (conn, jid) => {
  const url = await safeCall(() => conn.profilePictureUrl?.(jid, 'image'))
  if (!url || typeof url !== 'string') return null
  const response = await safeCall(() => Promise.race([
    fetch(url),
    wait(5000).then(() => null),
  ]))
  if (!response?.ok) return null
  const arrayBuffer = await safeCall(() => response.arrayBuffer())
  return arrayBuffer ? Buffer.from(arrayBuffer) : null
}

const getDisplayName = async (conn, jid) => {
  const name = await safeCall(() => conn.getName?.(jid))
  if (typeof name === 'string' && name.trim()) return name.trim()
  return String(jid || '').split('@')[0] || 'Usuario'
}

const digitsFromJid = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '')

const attachProfileContext = async ({ conn, content, participant, text }) => {
  const message = ensureExtendedTextForProfile(content, text)
  const node = getPrimaryTextNode(message)
  if (!node) return message

  const displayName = await getDisplayName(conn, participant)
  const thumbnail = await fetchProfileThumb(conn, participant)
  const sourceUrl = digitsFromJid(participant) ? `https://wa.me/${digitsFromJid(participant)}` : undefined

  node.contextInfo = {
    ...(node.contextInfo || {}),
    externalAdReply: {
      title: displayName,
      body: 'Simulacion privada',
      mediaType: 1,
      renderLargerThumbnail: false,
      showAdAttribution: false,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    },
  }

  return message
}

const buildVisibleSimulation = async ({ conn, chat, participant, quoted, text, fakeId }) => {
  const displayName = await getDisplayName(conn, participant)
  const quotedPreview = String(quoted?.text || '').trim()
  const number = digitsFromJid(participant)
  const identity = number ? `@${number}` : participant

  return {
    text: [
      '*FAKEMSG2 - SIMULACION*',
      `*Nombre:* ${displayName}`,
      `*Usuario:* ${identity}`,
      quotedPreview ? `*Base:* ${quotedPreview.slice(0, 180)}` : '',
      '',
      text,
      '',
      '_Este mensaje fue generado por el bot como simulacion._',
      `_${fakeId}_`,
    ].filter(Boolean).join('\n'),
    mentions: [participant],
  }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!m.quoted) {
    return conn.reply(m.chat, `Debes responder al mensaje real de la persona.\n> Ejemplo: responde a su texto con *${usedPrefix}${command} Hola*`, m)
  }
  if (!text || !text.trim()) {
    return conn.reply(m.chat, 'Escribe el texto que queres poner en el mensaje.', m)
  }

  try {
    await safeCall(() => m.react('\u{1F552}'))

    const chat = m.chat
    const isGroup = Boolean(m.isGroup || chat.endsWith('@g.us'))
    const contextInfo = getContextInfo(m)
    const { participants, primaryParticipants } = await collectParticipants({ conn, m, chat, isGroup, contextInfo })
    const participant = primaryParticipants[0] || participants[0] || normalizeJid(conn, await resolveCandidate(m.quoted?.sender)) || (isGroup ? '' : normalizeJid(conn, chat))

    if (!participant || !isValidUserJid(participant)) {
      throw new Error('No pude resolver el participante del mensaje citado')
    }

    const fakeText = text.trim()
    const fakeId = `FAKEMSG2-${Date.now().toString(36).toUpperCase()}`
    const content = await buildVisibleSimulation({
      conn,
      chat,
      participant,
      quoted: m.quoted,
      text: fakeText,
      fakeId,
    })

    console.log(`[FAKEMSG2] chat=${chat} participant=${participant} type=visibleSimulation id=${fakeId}`)

    if (typeof conn.sendMessage === 'function') {
      await conn.sendMessage(chat, content, { quoted: null })
    } else if (typeof conn.relayMessage === 'function') {
      await conn.relayMessage(chat, { extendedTextMessage: { text: content.text, contextInfo: { mentionedJid: content.mentions } } }, { messageId: fakeId })
    } else if (typeof conn.reply === 'function') {
      await conn.reply(chat, content.text, m)
    } else {
      throw new Error('La conexion no tiene sendMessage, relayMessage ni reply')
    }

    await safeCall(() => m.react('\u2705'))
  } catch (error) {
    console.error('[FAKEMSG2] error:', error)
    await safeCall(() => m.react('\u2716\uFE0F'))
    return conn.reply(m.chat, `No se pudo generar fakemsg2.\n> ${error.message}`, m)
  }
}

handler.help = ['fakemsg2 <texto>']
handler.tags = ['tools']
handler.command = ['fakemsg2']

export default handler

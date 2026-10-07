import { generateWAMessageFromContent, proto, jidNormalizedUser } from '@whiskeysockets/baileys'

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
  if (!value) return
  if (typeof value === 'object') return
  const normalized = String(value).trim()
  if (normalized && !list.includes(normalized)) list.push(normalized)
}

const pushUniqueKey = (list, key) => {
  if (!key?.remoteJid || !key?.id) return
  const signature = JSON.stringify(key)
  if (!list.some((item) => JSON.stringify(item) === signature)) list.push(key)
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

const toDeviceJid = (jid) => {
  const value = String(jid || '').trim()
  const match = value.match(/^([^@:]+)(?::\d+)?@(lid|s\.whatsapp\.net)$/)
  return match ? `${match[1]}:0@${match[2]}` : value
}

const getContextInfo = (m) => {
  const msg = m?.msg || null
  const direct = msg?.contextInfo
  if (direct) return direct
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

const isTextEditable = (m) => {
  const quoted = m?.quoted
  const type = String(quoted?.mtype || getMessageType(getQuotedMessageContent(quoted)) || '').toLowerCase()
  const quotedText = typeof quoted?.text === 'string' ? quoted.text : ''
  if (quotedText.trim()) return true
  if (!type) return true
  if (type === 'conversation' || type === 'extendedtext' || type === 'extendedtextmessage') return true
  return !/(audio|sticker|image|video|document|viewonce|contact|location|poll)/i.test(type)
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
  await addCandidate(quoted.participant)
  await addCandidate(quoted.vM?.participant)
  await addCandidate(quoted.fakeObj?.participant)
  await addCandidate(await safeCall(() => quoted.sender))

  let addressingMode = 'unknown'
  let metaEntry = null
  if (isGroup && typeof conn.groupMetadata === 'function') {
    const meta = await safeCall(() => conn.groupMetadata(chat))
    addressingMode = meta?.addressingMode || 'unknown'
    const participants = Array.isArray(meta?.participants) ? meta.participants : []
    const metadataNeedles = primaryCandidates.length ? primaryCandidates : candidates
    metaEntry = participants.find((participant) => {
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

  return { candidates, participants, primaryParticipants, addressingMode, metaEntry }
}

const buildTargetKeys = ({ chat, remoteJids, id, participants, isGroup }) => {
  const keys = []
  if (isGroup) {
    for (const participant of participants) {
      pushUniqueKey(keys, { remoteJid: chat, fromMe: false, id, participant })
      pushUniqueKey(keys, { remoteJid: chat, fromMe: true, id, participant })
    }
    pushUniqueKey(keys, { remoteJid: chat, fromMe: false, id })
    pushUniqueKey(keys, { remoteJid: chat, fromMe: true, id })
  } else {
    for (const remoteJid of remoteJids) {
      pushUniqueKey(keys, { remoteJid, fromMe: false, id })
      pushUniqueKey(keys, { remoteJid, fromMe: true, id })
    }
  }
  return keys
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!m.quoted) {
    return conn.reply(m.chat, `Debes responder al mensaje real de la persona.\n> Ejemplo: responde a su texto con *${usedPrefix}${command} Hola*`, m)
  }
  if (!text || !text.trim()) {
    return conn.reply(m.chat, 'Escribe el texto que queres poner en la edicion.', m)
  }

  try {
    const separatorIndex = text.indexOf('+')
    const fakeText = separatorIndex < 0 ? text : text.slice(0, separatorIndex).trim()
    const botReply = separatorIndex < 0 ? '' : text.slice(separatorIndex + 1).trim()
    if (!fakeText || (separatorIndex >= 0 && !botReply)) {
      throw new Error(`Formato: *${usedPrefix}${command} mensaje ficticio + respuesta del bot*`)
    }

    await safeCall(() => m.react('🕒'))

    const chat = m.chat
    const victimMsgId = m.quoted.id || m.quoted.key?.id || m.quoted.vM?.key?.id || m.quoted.fakeObj?.key?.id
    if (!victimMsgId) throw new Error('El mensaje citado no tiene id/stanzaId')

    if (!isTextEditable(m)) {
      throw new Error('WhatsApp solo acepta editar mensajes de texto. Responde a un texto, no a media/sticker/audio.')
    }

    const isGroup = Boolean(m.isGroup || chat.endsWith('@g.us'))
    const contextInfo = getContextInfo(m)
    const { candidates, participants, primaryParticipants, addressingMode, metaEntry } = await collectParticipants({ conn, m, chat, isGroup, contextInfo })

    if (isGroup && !participants.length) {
      throw new Error('No pude resolver el participante del mensaje citado')
    }

    const botJid = normalizeJid(conn, conn.user?.jid || conn.user?.id || '')
    const remoteJids = isGroup ? [chat] : [chat, botJid].filter((jid, index, all) => isValidUserJid(jid) && all.indexOf(jid) === index)
    const targetKeys = buildTargetKeys({ chat, remoteJids, id: victimMsgId, participants, isGroup })

    console.log(`[FAKEMSG] id=${victimMsgId} chat=${chat} group=${isGroup} addr=${addressingMode} meta=${JSON.stringify(metaEntry)}`)
    console.log(`[FAKEMSG] candidates=${JSON.stringify(candidates)} primary=${JSON.stringify(primaryParticipants)} participants=${JSON.stringify(participants)} variants=${targetKeys.length}`)

    if (!targetKeys.length) throw new Error('No pude construir keys de edicion para el mensaje citado')

    hookServerErrors(conn)

    let sent = 0
    let lastError = null
    const attempt = async (label, fn) => {
      try {
        await fn()
        sent++
      } catch (error) {
        lastError = error
        console.error(`[FAKEMSG] ${label} fallo:`, error?.message || error)
      }
    }

    for (const key of targetKeys) {
      if (typeof conn.sendMessage === 'function') {
        await attempt(`sendMessage ${JSON.stringify(key)}`, () => conn.sendMessage(chat, { text: fakeText, edit: key }))
      } else {
        await attempt(`relay extended ${JSON.stringify(key)}`, () => relayEdit(conn, chat, key, { extendedTextMessage: { text: fakeText } }))
      }
      await wait(80)
    }

    await attempt('relay conversation key primaria', () => relayEdit(conn, chat, targetKeys[0], { conversation: fakeText }))

    // Variantes agresivas: algunos clientes viejos miran attrs del stanza/ruteo antes que protocolMessage.key.
    if (isGroup) {
      for (const participant of primaryParticipants.length ? primaryParticipants : participants) {
        const key = { remoteJid: chat, fromMe: false, id: victimMsgId, participant }
        const deviceJid = toDeviceJid(participant)
        await attempt(`relay directed ext ${deviceJid}`, () => relayEdit(conn, chat, key, { extendedTextMessage: { text: fakeText } }, {
          participant: { jid: deviceJid },
        }))
        await wait(80)
        await attempt(`relay original-id ext ${participant}`, () => relayEdit(conn, chat, key, { extendedTextMessage: { text: fakeText } }, {
          messageId: victimMsgId,
        }))
        await wait(80)
        await attempt(`relay directed original-id conversation ${deviceJid}`, () => relayEdit(conn, chat, key, { conversation: fakeText }, {
          messageId: victimMsgId,
          participant: { jid: deviceJid },
        }))
        await wait(80)
      }
    }

    if (!sent) throw lastError || new Error('No se pudo enviar ninguna stanza de edicion')

    if (!conn.__fakemsgNoFallback && typeof conn.sendMessage === 'function') {
      await safeCall(() => sendVisibleFallback({
        conn,
        m,
        chat,
        text: botReply,
        quotedText: fakeText,
        victimMsgId,
        participant: primaryParticipants[0] || participants[0],
      }))
    }

    console.log(`[FAKEMSG] enviadas ${sent} stanzas de edicion`)
    await safeCall(() => m.react('✅'))
  } catch (error) {
    console.error('[FAKEMSG] error:', error)
    await safeCall(() => m.react('✖️'))
    return conn.reply(m.chat, `No se pudo generar el mensaje falso.\n> ${error.message}`, m)
  }
}

async function sendVisibleFallback({ conn, m, chat, text, quotedText, victimMsgId, participant }) {
  if (!participant) return null
  const quoteId = `FAKE-${victimMsgId || Date.now()}`
  return conn.sendMessage(chat, {
    text: text || '\u200e',
    contextInfo: {
      stanzaId: quoteId,
      participant,
      quotedMessage: { conversation: String(quotedText) },
    },
  }, { quoted: null })
}

function relayEdit(conn, chat, key, editedMessage, options = {}) {
  const editMsg = generateWAMessageFromContent(chat, {
    protocolMessage: {
      key,
      editedMessage,
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      timestampMs: Date.now(),
    },
  }, { userJid: conn.user?.jid || conn.user?.id })

  return conn.relayMessage(chat, editMsg.message, {
    messageId: options.messageId || editMsg.key.id,
    additionalAttributes: { edit: '1' },
    ...(options.participant ? { participant: options.participant } : {}),
  })
}

function hookServerErrors(conn) {
  if (!conn.ws?.on || conn.__fakemsgErrHook) return
  conn.__fakemsgErrHook = true
  const logServerError = (tag) => (node) => {
    try {
      const attrs = node?.attrs || {}
      const errors = Array.isArray(node?.content) ? node.content.filter((child) => child?.tag === 'error') : []
      if (attrs.type !== 'error' && !errors.length) return
      console.log(`[FAKEMSG-SRV] error del servidor (${tag}) -> ` + JSON.stringify({
        attrs,
        error: errors.map((child) => child.attrs),
      }))
    } catch (_) {}
  }
  conn.ws.on('CB:message', logServerError('message'))
  conn.ws.on('CB:iq', logServerError('iq'))
}

handler.help = ['fakemsg <texto> [+ <respuesta del bot>]']
handler.tags = ['tools']
handler.command = ['fakemsg']

handler.all = async function (m) {
  try {
    if (!m || m.key?.fromMe) return
    const pm = m.message?.protocolMessage || (m.mtype === 'protocolMessage' ? m.msg : null)
    if (!pm || pm.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) return
    const edited = pm.editedMessage || {}
    const content = edited.conversation
      ? { tipo: 'conversation', texto: String(edited.conversation).slice(0, 300) }
      : edited.extendedTextMessage
        ? { tipo: 'extendedTextMessage', texto: String(edited.extendedTextMessage.text || '').slice(0, 300) }
        : { tipo: Object.keys(edited)[0] || 'vacio' }
    console.log('[FAKEMSG-CAPTURE] edicion oficial recibida -> ' + JSON.stringify({
      envelope: m.key,
      protocolKey: pm.key,
      contenido: content,
      timestampMs: pm.timestampMs || null,
      msgTimestamp: m.messageTimestamp || null,
    }))
  } catch (error) {
    console.error('[FAKEMSG-CAPTURE]', error?.message || error)
  }
}

export default handler

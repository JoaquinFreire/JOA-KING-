import ws from 'ws'
import fs from 'fs'

const normalizeJid = (jid) => String(jid || '').trim().replace(/:\d+(?=@)/, '').toLowerCase()
const jidNumber = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '')
const phoneNumbers = (...values) => new Set(values
  .filter((value) => typeof value === 'string')
  .filter((value) => !value.toLowerCase().endsWith('@lid'))
  .map((value) => jidNumber(value))
  .filter((value) => value.length >= 8 && value.length <= 15)
  .flatMap((number) => {
    const variants = [number]
    if (number.startsWith('549')) variants.push(`54${number.slice(3)}`)
    else if (number.startsWith('54')) variants.push(`549${number.slice(2)}`)
    return variants
  }))
const socketPhoneNumbers = (socket) => phoneNumbers(
  socket?.user?.jid,
  socket?.user?.id,
  socket?.user?.phoneNumber,
  socket?.authState?.creds?.me?.jid,
  socket?.authState?.creds?.me?.phoneNumber,
)
const getMentions = async (m, conn, text) => {
  const contextMentions = m.msg?.contextInfo?.mentionedJid ||
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    m.msg?.extendedTextMessage?.contextInfo?.mentionedJid ||
    []
  const parsedMentions = typeof conn.parseMention === 'function' ? conn.parseMention(text) : []
  const mentions = await m.mentionedJid
  return [...new Set([
    ...(Array.isArray(mentions) ? mentions : mentions ? [mentions] : []),
    ...(Array.isArray(contextMentions) ? contextMentions : []),
    ...(Array.isArray(parsedMentions) ? parsedMentions : []),
  ].map(normalizeJid).filter(Boolean))]
}
const mentionedPhoneNumbers = (mentions, groupMetadata) => {
  const numbers = new Set(phoneNumbers(...mentions))
  const participants = groupMetadata?.participants || []
  for (const participant of participants) {
    const identifiers = [
      participant?.id,
      participant?.jid,
      participant?.lid,
      participant?.phoneNumber,
    ].map(normalizeJid).filter(Boolean)
    if (!identifiers.some((identifier) => mentions.includes(identifier))) continue
    for (const candidate of [participant?.id, participant?.jid, participant?.phoneNumber]) {
      for (const number of phoneNumbers(candidate)) numbers.add(number)
    }
  }
  return numbers
}
const socketDisplayJid = (socket) => [
  socket?.user?.jid,
  socket?.user?.id,
  socket?.user?.phoneNumber,
  socket?.authState?.creds?.me?.jid,
].find((jid) => typeof jid === 'string' && jid.toLowerCase().endsWith('@s.whatsapp.net')) ||
  socket?.user?.jid
const isConnected = (socket) => {
  const readyState = socket?.ws?.socket?.readyState
  return Boolean(socket?.user?.jid) && readyState !== ws.CLOSED
}

const handler = async (m, { conn, command, text, isOwner, isROwner, usedPrefix, groupMetadata }) => {
  if (command === 'disconnectbot') {
    const sender = normalizeJid(m.sender)
    const senderJids = [sender, m.key?.participant, m.key?.senderPn, m.key?.remoteJidAlt]
      .map(normalizeJid)
      .filter(Boolean)
    const rootOwners = (global.owner || []).map((owner) => String(owner).replace(/\D/g, ''))
    const isRootOwner = Boolean(
      isOwner ||
      isROwner ||
      senderJids.some((jid) => rootOwners.includes(jidNumber(jid)))
    )
    const invokingSocket = conn === global.conn ? null : conn
    const invokingOwner = normalizeJid(invokingSocket?.subBotOwnerJid || '')
    const canDisconnectOwnSubBot = Boolean(
      invokingSocket &&
      invokingOwner &&
      senderJids.some((jid) => jid === invokingOwner || jidNumber(jid) === jidNumber(invokingOwner))
    )
    if (!isRootOwner && !canDisconnectOwnSubBot) {
      return conn.reply(m.chat, 'Solo el owner del bot o el dueño de este subbot puede desconectarlo.', m)
    }

    const mentions = await getMentions(m, conn, text)
    const textualNumber = String(text || '').match(/@(\+?[\d\s().-]{7,25})/)?.[1]?.replace(/\D/g, '')
    const requestedNumbers = mentionedPhoneNumbers(mentions, groupMetadata)
    if (textualNumber) {
      for (const number of phoneNumbers(textualNumber)) requestedNumbers.add(number)
    }
    const hasRequestedTarget = mentions.length > 0 || Boolean(textualNumber)
    const target = hasRequestedTarget
      ? (global.conns || []).find((socket) =>
        requestedNumbers.size > 0 && socket !== global.conn && isConnected(socket) &&
        [...socketPhoneNumbers(socket)].some((number) => requestedNumbers.has(number))
      )
      : canDisconnectOwnSubBot
        ? invokingSocket
        : null
    if (!target) {
      return conn.reply(
        m.chat,
        `No encontré ese subbot conectado. Usá ${usedPrefix}disconnectbot @subbot; si sos dueño de un subbot, podés usar el comando sin mención para desconectarlo.`,
        m
      )
    }

    const targetNumber = jidNumber(socketDisplayJid(target))
    await conn.reply(m.chat, `🔌 Desconectando el subbot @${targetNumber}...`, m)
    target.intentionalDisconnect = true
    try {
      if (typeof target.logout === 'function') {
        await target.logout()
      } else {
        target.ws?.close()
        target.ev?.removeAllListeners()
        const index = global.conns.indexOf(target)
        if (index >= 0) global.conns.splice(index, 1)
        if (target.sessionPath) fs.rmSync(target.sessionPath, { recursive: true, force: true })
      }
    } catch (error) {
      console.error(`[SUBBOT] No se pudo desconectar @${targetNumber}:`, error?.stack || error)
      return conn.reply(m.chat, `No se pudo desconectar el subbot @${targetNumber}.\n> ${error.message}`, m)
    }
    return
  }

  const primary = global.conn
  const subBots = [...new Set(global.conns || [])].filter((socket) =>
    socket !== primary && isConnected(socket)
  )
  const bots = [primary, ...subBots].filter(isConnected)
  const mentions = []
  const lines = bots.map((socket, index) => {
    const jid = normalizeJid(socketDisplayJid(socket))
    const number = jidNumber(jid)
    mentions.push(jid)
    if (socket === primary) return `${index + 1}. Principal: @${number}`

    const ownerJid = normalizeJid(socket.subBotOwnerJid || '')
    const ownerNumber = jidNumber(ownerJid)
    const ownerLine = ownerNumber ? ` · dueño: @${ownerNumber}` : ''
    if (ownerJid) mentions.push(ownerJid)
    return `${index + 1}. Subbot: @${number}${ownerLine}`
  })

  const listing = `🤖 *BOTS CONECTADOS*\n\nTotal: *${bots.length}* (${bots.length - subBots.length} principal y ${subBots.length} subbots)\n${lines.length ? `\n${lines.join('\n')}` : '\nNo hay conexiones activas.'}`
  return conn.sendMessage(m.chat, {
    text: listing,
    mentions: [...new Set(mentions)],
  }, { quoted: m })
}

handler.tags = ['serbot']
handler.help = ['bots', 'disconnectbot [@subbot]']
handler.command = ['bots', 'botlist', 'listbots', 'listbot', 'sockets', 'socket', 'disconnectbot']

export default handler

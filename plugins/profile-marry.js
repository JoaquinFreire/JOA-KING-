const proposals = new Map()
const proposalDuration = 2 * 60 * 1000

const getMentionedUsers = async (m, conn, text) => {
  const mentionedJid = await m.mentionedJid
  const contextMentions = m.msg?.contextInfo?.mentionedJid ||
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    []
  const parsedMentions = typeof conn.parseMention === 'function'
    ? conn.parseMention(text || '')
    : []
  return [...new Set([
    ...(Array.isArray(mentionedJid) ? mentionedJid : []),
    ...(Array.isArray(contextMentions) ? contextMentions : [contextMentions]),
    ...(Array.isArray(parsedMentions) ? parsedMentions : []),
  ].filter((jid) => typeof jid === 'string' && jid))]
}

const handler = async (m, { conn, command, text, usedPrefix }) => {
  const users = global.db.data.users
  const sender = m.sender
  const senderUser = users[sender] ||= {}

  if (command === 'divorce') {
    const spouse = senderUser.marry
    if (!spouse) return conn.reply(m.chat, '✎ No estás casado/a con nadie.', m)

    senderUser.marry = ''
    if (users[spouse]?.marry === sender) users[spouse].marry = ''
    await global.db.write()
    const spouseName = users[spouse]?.name || spouse.split('@')[0]
    return conn.reply(m.chat, `💔 *${senderUser.name || m.pushName || 'Vos'}* y *${spouseName}* se han divorciado.`, m)
  }

  const mentionedUsers = await getMentionedUsers(m, conn, text)
  const quotedUser = m.quoted ? await m.quoted.sender : null
  const target = mentionedUsers[0] || quotedUser
  if (!target) {
    return conn.reply(
      m.chat,
      `❀ Mencioná a alguien o respondé a su mensaje para proponer o aceptar matrimonio.\n> Ejemplo: *${usedPrefix}${command} @usuario*`,
      m
    )
  }
  if (sender === target) return conn.reply(m.chat, 'ꕥ No puedes proponerte matrimonio a ti mismo.', m)

  const targetUser = users[target] ||= {}
  if (senderUser.marry) {
    const spouse = users[senderUser.marry]
    return conn.reply(m.chat, `ꕥ Ya estás casado/a con *${spouse?.name || senderUser.marry.split('@')[0]}*.`, m)
  }
  if (targetUser.marry) {
    const spouse = users[targetUser.marry]
    return conn.reply(m.chat, `ꕥ *${targetUser.name || target.split('@')[0]}* ya está casado/a con *${spouse?.name || targetUser.marry.split('@')[0]}*.`, m)
  }

  const now = Date.now()
  for (const [proposer, proposal] of proposals) {
    if (proposal.expiresAt <= now) proposals.delete(proposer)
  }

  const incomingProposal = proposals.get(target)
  if (incomingProposal?.recipient === sender && incomingProposal.expiresAt > now) {
    proposals.delete(target)
    senderUser.marry = target
    targetUser.marry = sender
    await global.db.write()
    return conn.reply(
      m.chat,
      `✩.･:｡≻───── ⋆♡⋆ ─────.•:｡✩\n¡Se han casado! ฅ^•ﻌ•^ฅ*:･ﾟ✧\n\n*•.¸♡ ${senderUser.name || m.pushName || 'Vos'} ♡¸.•*\n*•.¸♡ ${targetUser.name || target.split('@')[0]} ♡¸.•*\n\nDisfruten de su luna de miel.\n✩.･:｡≻───── ⋆♡⋆ ─────.•:｡✩`,
      m
    )
  }

  const proposal = { recipient: target, expiresAt: now + proposalDuration }
  proposals.set(sender, proposal)
  setTimeout(() => {
    if (proposals.get(sender) === proposal) proposals.delete(sender)
  }, proposalDuration).unref?.()
  return conn.reply(
    m.chat,
    `♡ *${targetUser.name || target.split('@')[0]}*, *${senderUser.name || m.pushName || 'alguien'}* te propuso matrimonio. Para aceptar, responde mencionándolo con *${usedPrefix}${command} @${sender.split('@')[0]}*. La propuesta vence en 2 minutos.`,
    m
  )
}

handler.help = ['marry @usuario', 'divorce']
handler.tags = ['rg']
handler.command = ['marry', 'casarse', 'divorce']
handler.group = true

export default handler

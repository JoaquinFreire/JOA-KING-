const handler = async (m, { conn, text, usedPrefix, isOwner }) => {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  const requestedGender = parts.at(-1)?.toLowerCase()
  const gender = requestedGender === 'hombre' ? 'Hombre' : requestedGender === 'mujer' ? 'Mujer' : null
  if (!gender) {
    return conn.reply(m.chat, `Elige *hombre* o *mujer*. Ejemplo: *${usedPrefix}misexo mujer*`, m)
  }

  const mentionedJid = await m.mentionedJid
  const contextMentions = m.msg?.contextInfo?.mentionedJid ||
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    []
  const parsedMentions = typeof conn.parseMention === 'function'
    ? conn.parseMention(text || '')
    : []
  const targetMention = [
    ...(Array.isArray(mentionedJid) ? mentionedJid : []),
    ...(Array.isArray(contextMentions) ? contextMentions : [contextMentions]),
    ...(Array.isArray(parsedMentions) ? parsedMentions : []),
  ].find((jid) => typeof jid === 'string' && jid)
  const target = targetMention || m.sender

  if (target !== m.sender && !isOwner) {
    return conn.reply(m.chat, 'Solo el owner puede cambiar el sexo registrado de otra persona.', m)
  }

  const user = global.db.data.users[target] ||= {}
  if (user.genre && user.genre !== gender && !(isOwner && targetMention)) {
    const subject = target === m.sender ? 'Ya tienes' : 'Esa persona ya tiene'
    return conn.reply(m.chat, `${subject} registrado *${user.genre}* y no se puede cambiar sin que lo haga el owner con una mención.`, m)
  }
  if (user.genre === gender) {
    const subject = target === m.sender ? 'Ya tienes' : 'Esa persona ya tiene'
    return conn.reply(m.chat, `${subject} registrado *${gender}*.`, m)
  }

  user.genre = gender
  await global.db.write()
  const subject = target === m.sender ? 'tu sexo' : `el sexo de @${target.split('@')[0]}`
  return conn.reply(m.chat, `Listo, registré ${subject} como *${gender}*.`, m, {
    mentions: target === m.sender ? [] : [target],
  })
}

handler.help = ['misexo hombre|mujer', 'misexo @usuario hombre|mujer (owner)']
handler.tags = ['rg']
handler.command = ['misexo']

export default handler

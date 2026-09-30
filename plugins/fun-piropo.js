const getPrimarySettings = (conn) => {
  const primaryJid = global.conn?.user?.jid || global.conn?.user?.id
  const currentJid = conn?.user?.jid || conn?.user?.id
  const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/g, '').toLowerCase()

  if (!primaryJid || !currentJid || normalizeJid(primaryJid) !== normalizeJid(currentJid)) return null

  const settings = global.db?.data?.settings
  if (!settings) return null
  settings[primaryJid] ||= {}
  return settings[primaryJid]
}

const handler = async (m, { conn, command, text, usedPrefix }) => {
  const settings = getPrimarySettings(conn)
  if (!settings) return

  if (command === 'addpiropo') {
    const separator = String(text || '').indexOf('+')
    if (separator < 0) {
      return conn.reply(m.chat, `Formato: *${usedPrefix}addpiropo creador + piropo*`, m)
    }

    const author = String(text).slice(0, separator).trim()
    const compliment = String(text).slice(separator + 1).trim()
    if (!author || !compliment) {
      return conn.reply(m.chat, `Formato: *${usedPrefix}addpiropo creador + piropo*`, m)
    }
    if (author.length > 80 || compliment.length > 500) {
      return conn.reply(m.chat, 'El creador puede tener hasta 80 caracteres y el piropo hasta 500.', m)
    }

    settings.piropos ||= []
    settings.piropos.push({ author, text: compliment })
    await global.db.write()
    return conn.reply(m.chat, `Piropo agregado. Ya hay ${settings.piropos.length} en la lista.`, m)
  }

  const piropos = Array.isArray(settings.piropos) ? settings.piropos : []
  if (!piropos.length) return conn.reply(m.chat, 'Todavía no hay piropos en la lista.', m)

  const compliment = piropos[Math.floor(Math.random() * piropos.length)]
  const sender = String(m.sender || '').split('@')[0].split(':')[0]
  const resolvedMentions = await m.mentionedJid
  const rawMentions = m.msg?.contextInfo?.mentionedJid || m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  const mentionedJid = [...new Set([
    ...(Array.isArray(resolvedMentions) ? resolvedMentions : []),
    ...(Array.isArray(rawMentions) ? rawMentions : [rawMentions])
  ].filter((jid) => typeof jid === 'string' && jid))]
  const recipient = mentionedJid[0]
  const recipientNumber = recipient ? String(recipient).split('@')[0].split(':')[0] : null
  const dedication = recipient
    ? `💌 @${sender} le dedica con cariño un piropo a @${recipientNumber}`
    : `@${sender} no le dedica esto a nadie porque es una persona triste`
  const message = `${dedication}\n\n*_${compliment.text}_*\n\n> _${compliment.author}_`
  const mentions = [...new Set([m.sender, recipient].filter(Boolean))]

  return conn.sendMessage(m.chat, { text: message, mentions }, { quoted: m })
}

handler.help = ['addpiropo creador + piropo', 'piropo @usuario']
handler.tags = ['fun']
handler.command = ['addpiropo', 'piropo']

export default handler
const scriptLetters = Array.from('𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏')

const formatAuthor = (value) => Array.from(String(value).normalize('NFD').toLowerCase(), (character) => {
  const codePoint = character.codePointAt(0)
  return codePoint >= 97 && codePoint <= 122 ? scriptLetters[codePoint - 97] : character
}).join('')

const formatCompliment = (value) => Array.from(String(value).normalize('NFD'), (character) => {
  const codePoint = character.codePointAt(0)
  if (codePoint >= 65 && codePoint <= 90) return String.fromCodePoint(codePoint - 65 + 0x1d5d4)
  if (codePoint >= 97 && codePoint <= 122) return String.fromCodePoint(codePoint - 97 + 0x1d5ee)
  if (codePoint >= 48 && codePoint <= 57) return String.fromCodePoint(codePoint - 48 + 0x1d7ec)
  return character
}).join('')

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

  if (command === 'list') {
    const listType = String(text || '').trim().toLowerCase()
    if (listType !== 'piropo') {
      return conn.reply(m.chat, `Formato: *${usedPrefix}list piropo*`, m)
    }

    const piropos = Array.isArray(settings.piropos) ? settings.piropos : []
    if (!piropos.length) return conn.reply(m.chat, 'Todavía no hay piropos en la lista.', m)

    const list = piropos.map((piropo, index) => `${index + 1}. ${formatCompliment(piropo.text)} — ${formatAuthor(piropo.author)}`).join('\n')
    return conn.reply(m.chat, `💌 *Lista de piropos (${piropos.length})*\n\n${list}`, m)
  }

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

  if (command === 'edit') {
    const match = String(text || '').trim().match(/^piropo\s+(\d+)\s+(.+)$/i)
    if (!match) return conn.reply(m.chat, `Formato: *${usedPrefix}edit piropo número autor + piropo*`, m)

    const piropos = Array.isArray(settings.piropos) ? settings.piropos : []
    const index = Number(match[1]) - 1
    if (!piropos[index]) return conn.reply(m.chat, `No existe el piropo número ${match[1]}.`, m)

    const separator = match[2].indexOf('+')
    if (separator < 0) return conn.reply(m.chat, `Formato: *${usedPrefix}edit piropo número autor + piropo*`, m)

    const author = match[2].slice(0, separator).trim()
    const compliment = match[2].slice(separator + 1).trim()
    if (!author || !compliment) return conn.reply(m.chat, `Formato: *${usedPrefix}edit piropo número autor + piropo*`, m)
    if (author.length > 80 || compliment.length > 500) {
      return conn.reply(m.chat, 'El creador puede tener hasta 80 caracteres y el piropo hasta 500.', m)
    }

    piropos[index] = { author, text: compliment }
    await global.db.write()
    return conn.reply(m.chat, `Piropo número ${match[1]} editado.`, m)
  }

  if (command === 'eliminar') {
    const match = String(text || '').trim().match(/^piropo\s+(\d+)$/i)
    if (!match) return conn.reply(m.chat, `Formato: *${usedPrefix}eliminar piropo número*`, m)

    const piropos = Array.isArray(settings.piropos) ? settings.piropos : []
    const index = Number(match[1]) - 1
    if (!piropos[index]) return conn.reply(m.chat, `No existe el piropo número ${match[1]}.`, m)

    piropos.splice(index, 1)
    await global.db.write()
    return conn.reply(m.chat, `Piropo número ${match[1]} eliminado.`, m)
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
  const message = `${dedication}\n\n*_${formatCompliment(compliment.text)}_*\n\n> _${formatAuthor(compliment.author)}_`
  const mentions = [...new Set([m.sender, recipient].filter(Boolean))]

  return conn.sendMessage(m.chat, { text: message, mentions }, { quoted: m })
}

handler.help = ['addpiropo creador + piropo', 'edit piropo número autor + piropo', 'eliminar piropo número', 'piropo @usuario', 'list piropo']
handler.tags = ['fun']
handler.command = ['addpiropo', 'edit', 'eliminar', 'piropo', 'list']

export default handler
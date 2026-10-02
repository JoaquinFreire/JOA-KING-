const italicLetters = Array.from('𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧')
const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹'

const formatNumber = (number) => Array.from(String(number), (digit) => superscriptDigits[Number(digit)]).join('')

const formatAuthor = (value) => Array.from(String(value).normalize('NFD').toLowerCase(), (character) => {
  const codePoint = character.codePointAt(0)
  return codePoint >= 97 && codePoint <= 122 ? italicLetters[codePoint - 97] : character
}).join('')

const formatPiropo = (piropo) => `♡ ───────────── ♡\n   _*${piropo.text}*_\n♡ ───────────── ♡\n\n> _${formatAuthor(piropo.author)}_`

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

const handler = async (m, { conn, command, text, usedPrefix, participants, isOwner }) => {
  const settings = getPrimarySettings(conn)
  if (!settings) return

  if (['list', 'edit', 'eliminar'].includes(command) && !isOwner) {
    return conn.reply(m.chat, 'Solo el owner puede listar, editar o eliminar piropos.', m)
  }

  if (command === 'list') {
    const listType = String(text || '').trim().toLowerCase()
    if (listType !== 'piropo') {
      return conn.reply(m.chat, `Formato: *${usedPrefix}list piropo*`, m)
    }

    const piropos = Array.isArray(settings.piropos) ? settings.piropos : []
    if (!piropos.length) return conn.reply(m.chat, 'Todavía no hay piropos en la lista.', m)

    const list = piropos.map((piropo, index) => `${formatNumber(index + 1)} ${formatPiropo(piropo)}`).join('\n\n')
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

  const complimentIndex = Math.floor(Math.random() * piropos.length)
  const compliment = piropos[complimentIndex]
  const sender = String(m.sender || '').split('@')[0].split(':')[0]
  const resolvedMentions = await m.mentionedJid
  const rawMentions = m.msg?.contextInfo?.mentionedJid || m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  const mentionedJid = [...new Set([
    ...(Array.isArray(resolvedMentions) ? resolvedMentions : []),
    ...(Array.isArray(rawMentions) ? rawMentions : [rawMentions])
  ].filter((jid) => typeof jid === 'string' && jid))]
  const recipient = mentionedJid[0]
  const noRecipient = usedPrefix === '&' && /^nadie$/i.test(String(text || '').trim())
  let target = noRecipient ? null : recipient
  if (!noRecipient && !target && usedPrefix === '%') {
    if (!m.isGroup) {
      return conn.reply(m.chat, 'Este modo elige a alguien al azar y solo funciona en grupos. Usa %piropo @usuario para dedicarlo en privado.', m)
    }

    const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/g, '').toLowerCase()
    const botJids = new Set([
      conn.user?.jid,
      conn.user?.id,
      conn.user?.lid,
      global.conn?.user?.jid,
      global.conn?.user?.id,
      global.conn?.user?.lid
    ].filter(Boolean).map(normalizeJid))
    const candidates = [...new Set((Array.isArray(participants) ? participants : [])
      .map((participant) => participant.jid || participant.id || participant.lid)
      .filter((jid) => typeof jid === 'string' && jid && !botJids.has(normalizeJid(jid))))]
    if (!candidates.length) return conn.reply(m.chat, 'No encontré participantes para dedicarle el piropo.', m)
    target = candidates[Math.floor(Math.random() * candidates.length)]
  }
  const recipientNumber = target ? String(target).split('@')[0].split(':')[0] : null
  const dedication = target
    ? `💌 @${sender} le dedica con cariño un piropo a @${recipientNumber}`
    : `@${sender} no le dedica esto a nadie porque es una persona triste`
  const message = `${formatNumber(complimentIndex + 1)} ${dedication}\n\n${formatPiropo(compliment)}`
  const mentions = [...new Set([m.sender, target].filter(Boolean))]

  return conn.sendMessage(m.chat, { text: message, mentions }, { quoted: m })
}

handler.help = ['addpiropo creador + piropo', 'edit piropo número autor + piropo', 'eliminar piropo número', 'piropo @usuario', 'list piropo']
handler.tags = ['fun']
handler.command = ['addpiropo', 'edit', 'eliminar', 'piropo', 'list']
handler.customPrefix = /^(?:%|&)/
handler.before = (m, { match }) => {
  const prefix = match?.[0]?.[0]
  if (!prefix || typeof m.text !== 'string') return false
  const [action, type] = m.text.slice(prefix.length).trim().split(/\s+/, 2)
  return ['list', 'edit', 'eliminar'].includes(String(action).toLowerCase()) && String(type || '').toLowerCase() !== 'piropo'
}

export default handler
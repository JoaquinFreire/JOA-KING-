import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const chistesFile = fileURLToPath(new URL('../chistes.json', import.meta.url))
const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹'

const formatNumber = (number) => Array.from(String(number), (digit) => superscriptDigits[Number(digit)]).join('')
const formatChiste = (chiste) => `😂 ───────────── 😂\n   _*${chiste.text}*_\n😂 ───────────── 😂\n\n> _${chiste.author}_`
const readChistes = () => {
  const chistes = JSON.parse(readFileSync(chistesFile, 'utf8'))
  return Array.isArray(chistes) ? chistes : []
}
const saveChistes = (chistes) => writeFileSync(chistesFile, `${JSON.stringify(chistes, null, 2)}\n`)

const handler = async (m, { conn, command, text, usedPrefix, isOwner }) => {
  if (['list', 'edit', 'eliminar'].includes(command) && !isOwner) {
    return conn.reply(m.chat, 'Solo el owner puede listar, editar o eliminar chistes.', m)
  }

  const chistes = readChistes()

  if (command === 'list') {
    if (String(text || '').trim().toLowerCase() !== 'chiste') {
      return conn.reply(m.chat, `Formato: *${usedPrefix}list chiste*`, m)
    }
    if (!chistes.length) return conn.reply(m.chat, 'Todavía no hay chistes en la lista.', m)

    const list = chistes.map((chiste, index) => `${formatNumber(index + 1)} ${formatChiste(chiste)}`).join('\n\n')
    return conn.reply(m.chat, `😂 *Lista de chistes (${chistes.length})*\n\n${list}`, m)
  }

  if (command === 'addchiste') {
    const separator = String(text || '').indexOf('+')
    if (separator < 0) return conn.reply(m.chat, `Formato: *${usedPrefix}addchiste autor + chiste*`, m)

    const author = String(text).slice(0, separator).trim()
    const joke = String(text).slice(separator + 1).trim()
    if (!author || !joke) return conn.reply(m.chat, `Formato: *${usedPrefix}addchiste autor + chiste*`, m)
    if (author.length > 80 || joke.length > 500) {
      return conn.reply(m.chat, 'El autor puede tener hasta 80 caracteres y el chiste hasta 500.', m)
    }

    chistes.push({ author, text: joke })
    saveChistes(chistes)
    return conn.reply(m.chat, `Chiste agregado. Ya hay ${chistes.length} en la lista.`, m)
  }

  if (command === 'edit') {
    const match = String(text || '').trim().match(/^chiste\s+(\d+)\s+(.+)$/i)
    if (!match) return conn.reply(m.chat, `Formato: *${usedPrefix}edit chiste número autor + chiste*`, m)

    const index = Number(match[1]) - 1
    if (!chistes[index]) return conn.reply(m.chat, `No existe el chiste número ${match[1]}.`, m)
    const separator = match[2].indexOf('+')
    if (separator < 0) return conn.reply(m.chat, `Formato: *${usedPrefix}edit chiste número autor + chiste*`, m)

    const author = match[2].slice(0, separator).trim()
    const joke = match[2].slice(separator + 1).trim()
    if (!author || !joke) return conn.reply(m.chat, `Formato: *${usedPrefix}edit chiste número autor + chiste*`, m)
    if (author.length > 80 || joke.length > 500) {
      return conn.reply(m.chat, 'El autor puede tener hasta 80 caracteres y el chiste hasta 500.', m)
    }

    chistes[index] = { author, text: joke }
    saveChistes(chistes)
    return conn.reply(m.chat, `Chiste número ${match[1]} editado.`, m)
  }

  if (command === 'eliminar') {
    const match = String(text || '').trim().match(/^chiste\s+(\d+)$/i)
    if (!match) return conn.reply(m.chat, `Formato: *${usedPrefix}eliminar chiste número*`, m)

    const index = Number(match[1]) - 1
    if (!chistes[index]) return conn.reply(m.chat, `No existe el chiste número ${match[1]}.`, m)

    chistes.splice(index, 1)
    saveChistes(chistes)
    return conn.reply(m.chat, `Chiste número ${match[1]} eliminado.`, m)
  }

  if (!chistes.length) return conn.reply(m.chat, 'Todavía no hay chistes en la lista.', m)

  const index = Math.floor(Math.random() * chistes.length)
  const chiste = chistes[index]
  const sender = String(m.sender || '').split('@')[0].split(':')[0]
  const message = `${formatNumber(index + 1)} 😂 @${sender} cuenta un chiste:\n\n${formatChiste(chiste)}`
  return conn.sendMessage(m.chat, { text: message, mentions: [m.sender].filter(Boolean) }, { quoted: m })
}

handler.help = ['chiste', 'addchiste autor + chiste', 'edit chiste número autor + chiste', 'eliminar chiste número', 'list chiste']
handler.tags = ['fun']
handler.command = ['chiste', 'addchiste', 'edit', 'eliminar', 'list']
handler.customPrefix = /^(?:%|&)/
handler.before = (m, { match }) => {
  const prefix = match?.[0]?.[0]
  if (!prefix || typeof m.text !== 'string') return false
  const [action, type] = m.text.slice(prefix.length).trim().split(/\s+/, 2)
  return ['list', 'edit', 'eliminar'].includes(String(action).toLowerCase()) && String(type || '').toLowerCase() !== 'chiste'
}

export default handler
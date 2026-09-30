const regionalIndicator = (character) => {
  const normalized = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  if (/^[A-Z]$/.test(normalized)) {
    return String.fromCodePoint(0x1F1E6 + normalized.charCodeAt(0) - 65)
  }
  return character
}

const toRegionalText = (text) => text
  .split(/(\s+)/u)
  .map((part) => {
    if (/^\s+$/u.test(part)) return part.includes('\n') ? '\n' : '   '
    return Array.from(part).map(regionalIndicator).join(' ')
  })
  .join('')

const handler = async (m, { conn, text }) => {
  const sourceText = String(text || m.quoted?.text || '').trim()
  if (!sourceText) return conn.reply(m.chat, 'Escribe un texto o responde a un mensaje con %textblue.', m)

  return conn.reply(m.chat, toRegionalText(sourceText), m)
}

handler.help = ['textblue <texto>']
handler.tags = ['tools']
handler.command = ['textblue']

export default handler
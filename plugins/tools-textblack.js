const toBlackText = (text) => Array.from(text, (character) => {
  const normalized = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  if (/^[A-Z]$/.test(normalized)) {
    return String.fromCodePoint(0x1F170 + normalized.charCodeAt(0) - 65)
  }
  return character
}).join('')

const handler = async (m, { conn, text }) => {
  const sourceText = String(text || m.quoted?.text || '').trim()
  if (!sourceText) return conn.reply(m.chat, 'Escribe un texto o responde a un mensaje con %textblack.', m)

  return conn.reply(m.chat, toBlackText(sourceText), m)
}

handler.help = ['textblack <texto>']
handler.tags = ['tools']
handler.command = ['textblack']

export default handler
const upsideDown = {
  a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ',
  i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd',
  q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x',
  y: 'ʎ', z: 'z', '.': '˙', ',': "'", "'": ',', '?': '¿', '!': '¡',
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<'
}

const toUpsideDownText = (text) => Array.from(
  new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(text),
  ({ segment }) => segment
).reverse().map((character) => upsideDown[character.toLowerCase()] || character).join('')

const handler = async (m, { conn, text }) => {
  const sourceText = String(text || m.quoted?.text || '').trim()
  if (!sourceText) return conn.reply(m.chat, 'Escribe un texto o responde a un mensaje con %textgirar.', m)

  return conn.reply(m.chat, toUpsideDownText(sourceText), m)
}

handler.help = ['textgirar <texto>']
handler.tags = ['tools']
handler.command = ['textgirar']

export default handler
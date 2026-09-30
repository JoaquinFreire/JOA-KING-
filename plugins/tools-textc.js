import Jimp from 'jimp'

const DEFAULT_COLOR = '#00Eaff'
const COLOR_NAMES = {
  cyan: '#00eaff',
  celeste: '#00eaff',
  pink: '#ff4db8',
  rosa: '#ff4db8',
  red: '#ff5364',
  rojo: '#ff5364',
  green: '#55e88a',
  verde: '#55e88a',
  yellow: '#ffd34e',
  amarillo: '#ffd34e',
  blue: '#5b9dff',
  azul: '#5b9dff',
  white: '#ffffff',
  blanco: '#ffffff'
}

function parseInput(input) {
  const match = input.match(/^(#[\da-f]{6}|[a-záéíóúñ]+)\s+([\s\S]+)$/i)
  if (!match) return { color: DEFAULT_COLOR, text: input }

  const requestedColor = match[1].toLowerCase()
  const color = COLOR_NAMES[requestedColor] || (/^#[\da-f]{6}$/i.test(requestedColor) ? requestedColor : null)
  return color ? { color, text: match[2].trim() } : { color: DEFAULT_COLOR, text: input }
}

function wrapText(text, font, maxWidth) {
  const lines = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }

    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (Jimp.measureText(font, candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      for (const character of word) {
        const part = line + character
        if (Jimp.measureText(font, part) > maxWidth && line) {
          lines.push(line)
          line = character
        } else {
          line = part
        }
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function colorTextLayer(layer, color) {
  const red = parseInt(color.slice(1, 3), 16)
  const green = parseInt(color.slice(3, 5), 16)
  const blue = parseInt(color.slice(5, 7), 16)
  layer.scan(0, 0, layer.bitmap.width, layer.bitmap.height, (_x, _y, index) => {
    if (layer.bitmap.data[index + 3] === 0) return
    layer.bitmap.data[index] = red
    layer.bitmap.data[index + 1] = green
    layer.bitmap.data[index + 2] = blue
  })
}

const handler = async (m, { conn, text }) => {
  const input = String(text || '').trim()
  if (!input) {
    return conn.reply(m.chat, 'Escribe el texto. Ejemplos: %textc Hola mundo | %textc #ff4db8 Hola mundo', m)
  }
  if (input.length > 500) {
    return conn.reply(m.chat, 'El texto puede tener hasta 500 caracteres.', m)
  }

  const { color, text: message } = parseInput(input)
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE)
  const width = 1200
  const padding = 72
  const textWidth = width - padding * 2
  const lines = wrapText(message, font, textWidth)
  if (lines.length > 8) {
    return conn.reply(m.chat, 'El texto ocupa demasiadas líneas. Acórtalo para que se lea bien en la imagen.', m)
  }

  const lineHeight = 84
  const textHeight = lines.length * lineHeight + 16
  const height = Math.max(340, textHeight + 168)
  const background = await Jimp.create(width, height, 0x080b16ff)
  const accent = await Jimp.create(8, height, `${color}ff`)
  const textLayer = await Jimp.create(textWidth, textHeight, 0x00000000)
  const headerFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)

  background.composite(accent, 0, 0)
  background.print(headerFont, padding, 40, 'JOA-KING  /  TEXTO EN COLOR')
  background.print(headerFont, padding, height - 54, color.toUpperCase())
  textLayer.print(font, 0, 0, {
    text: lines.join('\n'),
    alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
    alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
  }, textWidth, textHeight)
  colorTextLayer(textLayer, color)
  background.composite(textLayer, padding, 100)

  const image = await background.getBufferAsync(Jimp.MIME_PNG)
  await conn.sendMessage(m.chat, { image }, { quoted: m })
}

handler.help = ['textc <texto>', 'textc #RRGGBB <texto>']
handler.tags = ['tools']
handler.command = ['textc']

export default handler
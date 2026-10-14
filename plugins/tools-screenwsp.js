import Jimp from 'jimp'

const WIDTH = 720
const HEIGHT = 1280
const MAX_MESSAGES = 10
const NAME_COLORS = ['#027eb5', '#7c3da6', '#d3396d', '#008f7a', '#c05b1b', '#5366c2']
const WALLPAPER = '#efeae2'

const unwrapMessage = (message) => {
  let content = message?.message
  while (content && typeof content === 'object') {
    const wrapper = content.ephemeralMessage ||
      content.viewOnceMessage ||
      content.viewOnceMessageV2 ||
      content.documentWithCaptionMessage
    if (!wrapper?.message) break
    content = wrapper.message
  }
  return content || {}
}

const getBody = (message) => {
  const content = unwrapMessage(message)
  const text = content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption
  if (text) return String(text)
  if (content.imageMessage) return '📷  Imagen'
  if (content.videoMessage) return '🎥  Video'
  if (content.stickerMessage) return 'Sticker'
  if (content.audioMessage) return content.audioMessage.ptt ? '🎤  Audio' : '🎵  Audio'
  if (content.documentMessage) return '📎  Documento'
  if (content.contactMessage || content.contactsArrayMessage) return '👤  Contacto'
  if (content.locationMessage || content.liveLocationMessage) return '📍  Ubicación'
  return ''
}

const wrapText = (text, font, width, maxLines = 3) => {
  const lines = []
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (Jimp.measureText(font, candidate) <= width) {
        line = candidate
      } else {
        if (line) lines.push(line)
        line = ''
        for (const character of word) {
          const part = line + character
          if (Jimp.measureText(font, part) > width && line) {
            lines.push(line)
            line = character
          } else {
            line = part
          }
        }
      }
      if (lines.length >= maxLines) break
    }
    if (line && lines.length < maxLines) lines.push(line)
    if (lines.length >= maxLines) break
  }
  if (lines.length === maxLines) {
    const lastLine = lines.at(-1)
    lines[lines.length - 1] = Jimp.measureText(font, `${lastLine}…`) <= width
      ? `${lastLine}…`
      : `${lastLine.slice(0, -1)}…`
  }
  return lines.length ? lines : [' ']
}

const drawRoundedRect = (image, x, y, width, height, radius, color) => {
  const rgba = Jimp.cssColorToHex(color)
  image.scan(x, y, width, height, (pixelX, pixelY, index) => {
    const nearestX = Math.max(x + radius, Math.min(pixelX, x + width - radius - 1))
    const nearestY = Math.max(y + radius, Math.min(pixelY, y + height - radius - 1))
    if ((pixelX - nearestX) ** 2 + (pixelY - nearestY) ** 2 <= radius ** 2) {
      image.bitmap.data.writeUInt32BE(rgba, index)
    }
  })
}

const paintText = (image, font, text, x, y, color) => {
  image.print(font, x, y, text)
  const width = Math.min(Jimp.measureText(font, text), image.bitmap.width - x)
  const height = Math.min(Jimp.measureTextHeight(font, text, width), image.bitmap.height - y)
  image.scan(x, y, width, height, (_px, _py, index) => {
    if (!image.bitmap.data[index + 3]) return
    image.bitmap.data[index] = parseInt(color.slice(1, 3), 16)
    image.bitmap.data[index + 1] = parseInt(color.slice(3, 5), 16)
    image.bitmap.data[index + 2] = parseInt(color.slice(5, 7), 16)
  })
}

const formatTime = (timestamp) => {
  const seconds = Number(timestamp || 0)
  if (!seconds) return ''
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(seconds * 1000))
}

const getStoredMessages = (conn, chat) => Object.values(conn.chats?.[chat]?.messages || {})
  .filter((message) => message?.key?.remoteJid === chat)
  .map((message) => {
    const sender = message.key.participant || message.participant || ''
    const fromMe = Boolean(message.key.fromMe)
    const name = fromMe
      ? 'Tú'
      : message.pushName || conn.chats?.[sender]?.name || sender.split('@')[0] || 'Usuario'
    const text = getBody(message)
    const timestamp = Number(message.messageTimestamp || 0)
    let colorIndex = 0
    for (const character of sender) colorIndex += character.charCodeAt(0)
    return { sender, name, text, timestamp, time: formatTime(timestamp), colorIndex, fromMe }
  })
  .filter((message) => message.text)
  .sort((first, second) => first.timestamp - second.timestamp)

export const renderGroupSnapshot = async ({ title, participantCount, messages, now = new Date() }) => {
  const groupFont = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK)
  const nameFont = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK)
  const bodyFont = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK)
  const smallFont = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK)
  const prepared = messages.slice(-MAX_MESSAGES).map((message) => {
    const lines = wrapText(message.text, bodyFont, 520)
    const textWidth = Math.max(...lines.map((line) => Jimp.measureText(bodyFont, line)))
    const width = Math.min(642, Math.max(210, textWidth + 54))
    return {
      ...message,
      lines,
      width,
      height: 30 + lines.length * 39 + 28,
    }
  })

  const statusHeight = 48
  const headerHeight = 112
  const composerHeight = 94
  const bodyTop = statusHeight + headerHeight
  const bodyBottom = HEIGHT - composerHeight
  const bodyHeight = bodyBottom - bodyTop
  let selected = []
  let usedHeight = 0
  for (const message of prepared.toReversed()) {
    const nextHeight = message.height + (selected.length ? 14 : 0)
    if (usedHeight + nextHeight > bodyHeight && selected.length) break
    selected.push(message)
    usedHeight += nextHeight
  }
  selected.reverse()

  const image = await Jimp.create(WIDTH, HEIGHT, WALLPAPER)
  const white = Jimp.cssColorToHex('#ffffff')
  const teal = Jimp.cssColorToHex('#075e54')
  const paleFooter = Jimp.cssColorToHex('#f0f2f5')
  image.scan(0, 0, WIDTH, HEIGHT, (_x, y, index) => {
    if (y < statusHeight) image.bitmap.data.writeUInt32BE(teal, index)
    else if (y < bodyTop) image.bitmap.data.writeUInt32BE(white, index)
    else if (y >= bodyBottom) image.bitmap.data.writeUInt32BE(paleFooter, index)
  })

  paintText(image, smallFont, new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(now), 30, 15, '#ffffff')
  paintText(image, smallFont, '●  ●  ●  ▰', WIDTH - 174, 15, '#ffffff')
  paintText(image, groupFont, '‹', 24, 73, '#111b21')

  const avatar = await Jimp.create(70, 70, '#dfe5e7')
  const initials = String(title || 'G').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es')
  avatar.print(nameFont, 0, 25, { text: initials, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, 70, 22)
  image.composite(avatar, 82, 68)
  paintText(image, groupFont, String(title || 'Grupo').slice(0, 28), 168, 70, '#111b21')
  paintText(image, smallFont, `${Number(participantCount) || 0} participantes`, 170, 111, '#667781')
  paintText(image, groupFont, '⋮', WIDTH - 54, 73, '#54656f')

  let y = bodyBottom - usedHeight - 24
  for (const message of selected) {
    const x = message.fromMe ? WIDTH - message.width - 23 : 23
    const bubbleColor = message.fromMe ? '#d9fdd3' : '#ffffff'
    drawRoundedRect(image, x, y, message.width, message.height, 17, bubbleColor)
    if (!message.fromMe) {
      const nameColor = NAME_COLORS[Math.abs(Number(message.colorIndex) || 0) % NAME_COLORS.length]
      paintText(image, nameFont, String(message.name || 'Usuario').slice(0, 36), x + 17, y + 10, nameColor)
    }
    const textY = y + (message.fromMe ? 13 : 34)
    message.lines.forEach((line, lineIndex) => {
      paintText(image, bodyFont, line, x + 17, textY + lineIndex * 39, '#111b21')
    })
    const footerY = y + message.height - 23
    paintText(image, smallFont, message.time, x + message.width - (message.fromMe ? 84 : 75), footerY, '#667781')
    if (message.fromMe) paintText(image, smallFont, '✓✓', x + message.width - 39, footerY, '#53bdeb')
    y += message.height + 14
  }

  drawRoundedRect(image, 18, HEIGHT - 76, WIDTH - 105, 55, 28, '#ffffff')
  paintText(image, groupFont, '＋', 36, HEIGHT - 66, '#54656f')
  paintText(image, nameFont, 'Mensaje', 91, HEIGHT - 59, '#667781')
  paintText(image, groupFont, '◉', WIDTH - 79, HEIGHT - 64, '#54656f')
  return image.getBufferAsync(Jimp.MIME_PNG)
}

const handler = async (m, { conn, groupMetadata }) => {
  if (!String(m.chat || '').endsWith('@g.us')) {
    return conn.reply(m.chat, 'Este comando solo funciona en grupos.', m)
  }
  try {
    const metadata = groupMetadata || conn.chats?.[m.chat]?.metadata || await conn.groupMetadata(m.chat)
    const messages = getStoredMessages(conn, m.chat)
      .filter((message) => !/^([.!#%])screenwsp\b/i.test(message.text))
      .slice(-MAX_MESSAGES)
    if (!messages.length) {
      return conn.reply(m.chat, 'Todavía no tengo mensajes recientes de este grupo para recrear la pantalla.', m)
    }
    const image = await renderGroupSnapshot({
      title: metadata.subject || conn.chats?.[m.chat]?.subject || 'Grupo',
      participantCount: metadata.participants?.length || 0,
      messages,
    })
    return conn.sendMessage(m.chat, {
      image,
      caption: `📱 Vista aproximada del grupo *${metadata.subject || 'WhatsApp'}*, armada con los últimos mensajes que recibió o envió el bot.`,
    }, { quoted: m })
  } catch (error) {
    console.error('[SCREENWSP] No se pudo recrear la pantalla del grupo:', error?.stack || error)
    return conn.reply(m.chat, `No pude recrear la vista de este grupo.\n> ${error?.message || error}`, m)
  }
}

handler.help = ['screenwsp']
handler.tags = ['fun']
handler.command = ['screenwsp']
handler.group = true

export default handler

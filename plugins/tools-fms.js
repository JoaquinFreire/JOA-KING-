import axios from 'axios'
import { sticker } from '../lib/sticker.js'

const QUOTE_API = 'https://bot.lyo.su/quote/generate'
const FALLBACK_AVATAR = 'https://telegra.ph/file/a2ae6cbfa40f6eeea0cf1.jpg'
const MAX_TEXT_LENGTH = 30

export const createQuotePayload = ({ name, avatarUrl, text }) => ({
  type: 'quote',
  format: 'png',
  backgroundColor: '#000000',
  width: 512,
  height: 768,
  scale: 2,
  messages: [{
    entities: [],
    avatar: true,
    from: {
      id: 1,
      name,
      photo: { url: avatarUrl },
    },
    text,
    replyMessage: {},
  }],
})

const getQuotedText = (quoted) =>
  quoted?.text ||
  quoted?.body ||
  quoted?.caption ||
  quoted?.message?.conversation ||
  quoted?.message?.extendedTextMessage?.text ||
  ''

const handler = async (m, { conn, text, args }) => {
  const quoted = m.quoted
  const quoteText = args?.join(' ').trim() || String(text || '').trim()
  const messageText = quoteText || String(getQuotedText(quoted)).trim() || 'HOLA'
  if (messageText.length > MAX_TEXT_LENGTH) {
    return conn.reply(m.chat, `El texto no puede superar los ${MAX_TEXT_LENGTH} caracteres.`, m)
  }

  const target = quoted
    ? await quoted.sender || quoted.participant || quoted.key?.participant || m.sender
    : m.sender
  const users = global.db?.data?.users || {}
  let name = quoted?.pushName || quoted?.name || (!quoted && m.pushName) || users[target]?.name || ''
  if (!name) {
    try {
      name = await conn.getName(target)
    } catch (error) {
      console.warn('[FMS] No se pudo obtener el nombre del usuario:', error?.message || error)
    }
  }

  let avatarUrl
  try {
    avatarUrl = await conn.profilePictureUrl(target, 'image')
  } catch (error) {
    console.warn('[FMS] No se pudo obtener la foto de perfil; se usará la imagen predeterminada:', error?.message || error)
    avatarUrl = FALLBACK_AVATAR
  }

  try {
    const { data } = await axios.post(
      QUOTE_API,
      createQuotePayload({
        name: name || target.split('@')[0],
        avatarUrl: avatarUrl || FALLBACK_AVATAR,
        text: messageText,
      }),
      { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
    )
    const encodedImage = data?.result?.image
    if (typeof encodedImage !== 'string' || !encodedImage) {
      throw new Error('El generador no devolvió una imagen.')
    }

    const image = Buffer.from(encodedImage, 'base64')
    const usersSettings = users[m.sender] || {}
    const webpSticker = await sticker(
      image,
      false,
      usersSettings.text1 || global.packsticker || 'JOA-KING',
      usersSettings.text2 || global.packsticker2 || 'WhatsApp'
    )
    if (!webpSticker) throw new Error('No se pudo convertir la imagen en sticker.')
    return conn.sendMessage(m.chat, { sticker: webpSticker }, { quoted: m })
  } catch (error) {
    console.error('[FMS] No se pudo generar el sticker:', error?.stack || error)
    return conn.reply(m.chat, `No pude crear el sticker.\n> ${error?.message || error}`, m)
  }
}

handler.help = ['fms [texto]']
handler.tags = ['sticker']
handler.command = ['fms']

export default handler

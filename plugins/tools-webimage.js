import { captureWebpage } from '../lib/page-capture.js'

const handler = async (m, { conn, text, usedPrefix }) => {
const url = text?.trim()
if (!url) return m.reply(`❀ Envíame el enlace de una página que contenga una imagen.\nEjemplo: ${usedPrefix}webimage https://ejemplo.com/imagen`)
try {
await m.react('🕒')
const screenshot = await captureWebpage(url)
await conn.sendMessage(m.chat, {
image: screenshot,
caption: '❀ Captura de la página web.',
}, { quoted: m })
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await m.reply(`⚠︎ No pude obtener la imagen.\n> ${error.message}`)
}
}

handler.help = ['webimage <url>']
handler.tags = ['tools']
handler.command = ['webimage', 'imagenweb']

export default handler

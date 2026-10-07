import { recordWebpage } from '../lib/page-capture.js'
import { toVideo } from '../lib/converter.js'

const handler = async (m, { conn, text, usedPrefix }) => {
const url = text?.trim()
if (!url) return m.reply(`❀ Envíame el enlace de una página que contenga un video.\nEjemplo: ${usedPrefix}webvideo https://ejemplo.com/video`)
try {
await m.react('🕒')
const video = await recordWebpage(url)
const converted = await toVideo(video, 'mp4')
try {
await conn.sendMessage(m.chat, {
video: converted.data,
mimetype: 'video/mp4',
caption: '❀ Grabación de la página web.',
}, { quoted: m })
} finally {
await converted.delete().catch(() => {})
}
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await m.reply(`⚠︎ No pude obtener el video.\n> ${error.message}`)
}
}

handler.help = ['webvideo <url>']
handler.tags = ['tools']
handler.command = ['webvideo', 'videoweb']

export default handler

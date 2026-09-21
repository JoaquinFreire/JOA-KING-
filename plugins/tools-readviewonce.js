import { getViewOnceMedia, downloadViewOnceMedia } from '../lib/viewonce.js'

let handler = async (m, { conn, usedPrefix }) => {
let quoted = m.quoted
if (!quoted) return conn.reply(m.chat, `❀ Por favor, responde a un mensaje de una sola vez "ViewOnce" para ver su contenido.`, m)
try {
await m.react('🕒')
let media = getViewOnceMedia(quoted.vM?.message || quoted.message || quoted.mediaMessage || quoted)
if (!media) return conn.reply(m.chat, `ꕥ No se encontró una imagen, video o audio de una sola vez.`, m)
let buffer = await downloadViewOnceMedia(media.media, media.type)
if (media.type === 'videoMessage') {
await conn.sendMessage(m.chat, { video: buffer, caption: media.media.caption || '', mimetype: media.media.mimetype || 'video/mp4' }, { quoted: m })
} else if (media.type === 'imageMessage') {
await conn.sendMessage(m.chat, { image: buffer, caption: media.media.caption || '' }, { quoted: m })
} else if (media.type === 'audioMessage') {
await conn.sendMessage(m.chat, { audio: buffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { quoted: m })
} else {
await conn.sendMessage(m.chat, { document: buffer, fileName: media.media.fileName || 'view-once', mimetype: media.media.mimetype || 'application/octet-stream' }, { quoted: m })
}
await m.react('✔️')
} catch (e) {
await m.react('✖️')
conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${e.message}`, m)
}}

handler.help = ['ver']
handler.tags = ['tools']
handler.command = ['readviewonce', 'read', 'readvo']
handler.premium = true

export default handler
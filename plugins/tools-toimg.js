import { getViewOnceMedia, downloadViewOnceMedia } from '../lib/viewonce.js'

let handler = async (m, { conn, usedPrefix, command }) => {
if (!m.quoted) {
return conn.reply(m.chat, `❀ Debes citar un sticker para convertir a imagen.`, m)
}
await m.react('🕒')
let media = getViewOnceMedia(m.quoted.vM?.message || m.quoted.message || m.quoted.mediaMessage || m.quoted)
let imgBuffer = media ? await downloadViewOnceMedia(media.media, media.type) : await m.quoted.download()
if (!imgBuffer) {
await m.react('✖️')
return conn.reply(m.chat, `ꕥ No se pudo descargar el sticker.`, m)
}
if (media?.type === 'audioMessage') {
await conn.sendMessage(m.chat, { audio: imgBuffer, mimetype: media.media.mimetype || 'audio/ogg; codecs=opus', ptt: media.media.ptt || false }, { quoted: m })
} else if (media?.type === 'videoMessage') {
await conn.sendMessage(m.chat, { video: imgBuffer, caption: media.media.caption || '' }, { quoted: m })
} else {
await conn.sendMessage(m.chat, { image: imgBuffer, caption: '❀ *Aquí tienes ฅ^•ﻌ•^ฅ*' }, { quoted: m })
}
await m.react('✔️')
}

handler.help = ['toimg']
handler.tags = ['tools']
handler.command = ['toimg', 'jpg', 'img'] 

export default handler
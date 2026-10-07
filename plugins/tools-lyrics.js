import fetch from 'node-fetch'

let handler = async (m, { text, usedPrefix, command, conn }) => {
if (!text) return m.reply(`❀ Por favor, escribe el nombre de la canción para obtener la letra`)
try {
await m.react('🕒')
let res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(text)}`, {
headers: { 'User-Agent': 'JOA-KING WhatsApp bot (lyrics command)' },
})
if (!res.ok) throw new Error(`Error HTTP: ${res.status}`)
let json = await res.json()
let song = Array.isArray(json) ? json.find(result => result.plainLyrics || result.syncedLyrics) : null
if (!song) {
await m.react('✖️')
return m.reply('ꕥ No se encontró la letra de la canción')
}
let title = song.trackName || song.name || text
let lyrics = song.plainLyrics || song.syncedLyrics
let caption = `❀ *Título:* ${title}\n○ *Artista:* ${song.artistName || 'Desconocido'}\n○ *Letra:*\n\n${lyrics}`
if (caption.length > 4000) caption = caption.slice(0, 3990) + '...'
caption += `\n\n↯ https://lrclib.net/search?q=${encodeURIComponent(text)}`
await conn.sendMessage(m.chat, { text: caption, mentions: [m.sender] }, { quoted: m })
await m.react('✔️')
} catch (error) {
await m.react('✖️')
return conn.reply(m.chat, `⚠︎ Se ha producido un problema\n> Usa *${usedPrefix}report* para informarlo\n\n${error.message}`, m)
}}

handler.command = ['lyrics']
handler.help = ['lyrics']
handler.tags = ['tools']

export default handler

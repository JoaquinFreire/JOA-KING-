import fetch from 'node-fetch'

var handler = async (m, { conn, usedPrefix, command, text }) => {
if (!text) return conn.reply(m.chat, `❀ Por favor, ingrese el nombre de algún anime.`, m)
try {
await m.react('🕒')
let res = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(text)}&page[limit]=1`)
if (!res.ok) throw new Error(`Error HTTP: ${res.status}`)
let json = await res.json()
let anime = json.data?.[0]
if (!anime) {
await m.react('✖️')
return conn.reply(m.chat, `ꕥ No se encontró ese anime.`, m)
}
let info = anime.attributes || {}
let synopsis = info.synopsis || 'Sin sinopsis disponible.'
if (synopsis.length > 600) synopsis = synopsis.slice(0, 597) + '...'
let animeInfo = `❀ Título: ${info.canonicalTitle || info.titles?.en || info.titles?.en_jp || text}
» Episodios: ${info.episodeCount ?? 'Desconocido'}
» Tipo: ${info.subtype || 'Desconocido'}
» Estado: ${info.status || 'Desconocido'}
» Puntaje: ${info.averageRating || 'Desconocido'}
» Sinopsis: ${synopsis}
» Url: https://kitsu.io/anime/${anime.id}`
let image = info.posterImage?.original || info.posterImage?.large || info.posterImage?.medium
if (image) {
await conn.sendMessage(m.chat, { image: { url: image }, caption: `✧ *I N F O - A N I M E* ✧\n\n${animeInfo}` }, { quoted: m })
} else {
await conn.reply(m.chat, `✧ *I N F O - A N I M E* ✧\n\n${animeInfo}`, m)
}
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['animedata', 'infoanime', 'serieinfo', 'animeinfo']
handler.tags = ['anime']
handler.command = ['animedata', 'infoanime', 'serieinfo', 'animeinfo']
handler.group = true

export default handler

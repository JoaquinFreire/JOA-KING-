import fetch from 'node-fetch'

let handler = async (m, { conn, usedPrefix, command }) => {
try {
await m.react('🕒')
let res = await fetch('https://nekos.best/api/v2/waifu')
if (!res.ok) throw new Error(`Error HTTP: ${res.status}`)
let json = await res.json()
let image = json.results?.[0]?.url
if (!image) throw new Error('La API no devolvió ninguna imagen.')
await conn.sendMessage(m.chat, { image: { url: image }, caption: '❀ Aquí tienes tu *Waifu* ฅ^•ﻌ•^ฅ.' }, { quoted: m })
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['waifu']
handler.tags = ['anime']
handler.command = ['waifu']
handler.group = true

export default handler
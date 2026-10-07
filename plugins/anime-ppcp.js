import fetch from "node-fetch"

let handler = async (m, { conn, usedPrefix }) => {
try {
await m.react('🕒')
let response = await fetch('https://raw.githubusercontent.com/ShirokamiRyzen/WAbot-DB/main/fitur_db/ppcp.json')
if (!response.ok) throw new Error(`Error HTTP: ${response.status}`)
let data = await response.json()
if (!Array.isArray(data) || !data.length) throw new Error('No hay imágenes disponibles para parejas.')
let cita = data[Math.floor(Math.random() * data.length)]
if (!cita?.cowo || !cita?.cewe) throw new Error('El resultado no contiene las dos imágenes.')
let cowoResponse = await fetch(cita.cowo)
if (!cowoResponse.ok) throw new Error(`Error HTTP al obtener la imagen masculina: ${cowoResponse.status}`)
let cowi = await cowoResponse.buffer()
await conn.sendMessage(m.chat, { image: cowi, caption: '*Masculino* ♂' }, { quoted: m })
let ceweResponse = await fetch(cita.cewe)
if (!ceweResponse.ok) throw new Error(`Error HTTP al obtener la imagen femenina: ${ceweResponse.status}`)
let ciwi = await ceweResponse.buffer()
await conn.sendMessage(m.chat, { image: ciwi, caption: '*Femenina* ♀' }, { quoted: m })
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['ppcouple']
handler.tags = ['anime']
handler.command = ['ppcp', 'ppcouple']
handler.group = true

export default handler

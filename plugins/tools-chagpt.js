import FormData from "form-data"
import { fileTypeFromBuffer } from "file-type"
import axios from "axios"
import fetch from "node-fetch"

const handler = async (m, { conn, command, usedPrefix, text, args }) => {
try {
const q = m.quoted ? m.quoted : m
const mime = (q.msg || q).mimetype || ''
const username = await (async () => global.db.data.users[m.sender].name || (async () => { try { const n = await conn.getName(m.sender); return typeof n === 'string' && n.trim() ? n : m.sender.split('@')[0] } catch { return m.sender.split('@')[0] } })())()
switch (command) {
case 'dalle': {
if (!args[0]) return conn.reply(m.chat, `❀ Por favor, proporciona una descripción para generar la imagen.`, m)
const promptDalle = args.join(' ')
if (promptDalle.length < 5) return conn.reply(m.chat, `ꕥ La descripción es demasiado corta.`, m)
await m.react('🕒')
const dalleURL = `https://eliasar-yt-api.vercel.app/api/ai/text2img?prompt=${encodeURIComponent(promptDalle)}`
const dalleRes = await axios.get(dalleURL, { responseType: 'arraybuffer' })
await conn.sendMessage(m.chat, { image: Buffer.from(dalleRes.data) }, { quoted: m })
await m.react('✔️')
break
}
case 'flux': {
if (!text) return conn.reply(m.chat, `❀ Por favor, ingrese un término para generar la imagen`, m)
await m.react('🕒')
const result = await fluximg.create(text)
if (result?.imageLink) {
await conn.sendMessage(m.chat, { image: { url: result.imageLink }, caption: `❀ *Resultados de:* ${text}` }, { quoted: m })
await m.react('✔️')
} else throw new Error("No se pudo crear la imagen")
break
}
case 'ia': case 'chatgpt': {
if (!text) return conn.reply(m.chat, `❀ Che {nombre}, decime algo para charlar. Ejemplo: *${usedPrefix}ia cómo estás?*`.replace("{nombre}", username), m)
await m.react('🕒')

const systemPrompt = `Sos ${botname}, un asistente de WhatsApp criado en Argentina. Hablás en español rioplatense con lunfardo y mucha buena onda. Usá palabras como che, boludo (en sentido de amigo), chabón, pibe, posta, re, groso, yapa, fiaca, laburo, quilombo, afano, cana, curda, mortificar, barra, festejar. Sé amigable, divertido, relajado, con nivel pero sin ser formal. Nunca uses inglés salvo que sea necesario. No seas grosero ni ofensivo. Respondé siempre en castellano argentino. El usuario se llama ${username}.`

let respuesta = null

/* ── Intento 1: DG AI API (gratis, sin clave) ── */
try {
  const url1 = `https://api.dgpt.fun/v1/chat/completions?message=${encodeURIComponent(text)}&system=${encodeURIComponent(systemPrompt)}`
  const r1 = await axios.get(url1, { timeout: 15000 })
  if (r1.data && (r1.data.response || r1.data.message || r1.data.answer || r1.data.content)) {
    respuesta = r1.data.response || r1.data.message || r1.data.answer || r1.data.content
  }
} catch {}

/* ── Intento 2: TorGPT (gratis, sin clave) ── */
if (!respuesta) {
  try {
    const url2 = `https://api.torgpt.com/v1/chat/completions?message=${encodeURIComponent(text)}&system=${encodeURIComponent(systemPrompt)}`
    const r2 = await axios.get(url2, { timeout: 15000 })
    if (r2.data && (r2.data.response || r2.data.message || r2.data.answer || r2.data.content)) {
      respuesta = r2.data.response || r2.data.message || r2.data.answer || r2.data.content
    }
  } catch {}
}

/* ── Intento 3: Delirius (si está configurado) ── */
if (!respuesta && global.APIs?.delirius?.url) {
  try {
    const url3 = `${global.APIs.delirius.url}/ia/gptprompt?text=${encodeURIComponent(text)}&prompt=${encodeURIComponent(systemPrompt)}`
    const r3 = await axios.get(url3, { timeout: 15000 })
    if (r3.data?.data) {
      respuesta = r3.data.data
    }
  } catch {}
}

/* ── Respaldo local: SIEMPRE responde, no se gasta nada ── */
if (!respuesta) {
  const LUNARDOS_RESP = [
    "Che {nombre}, posta que no te entiendo bien, pero me mandaste algo. Decime de qué va así te ayudo, boludo. 😉",
    "{nombre}, ¡qué groso que me escribas! No capté el mensaje, pero estoy acá para lo que necesites. ¿Qué hacés? 🍻",
    "Che, pibe, no sé de qué me hablás pero me encanta charlar con vos. Contame más, que te escucho. 🤙",
    "{nombre}, mirá, no te entendí del todo, pero estoy acá para vos. Decime qué necesitás y te ayudo como buen argentino. 🇦🇷",
    "¡Che boludo! Me mandaste algo pero no le agarré el hilo. Hablame en buen castellano y te respondo al toque. 🍕",
    "{nombre}, qué fiaca me da no entenderte, pero igual te voy a ayudar. Decime de qué se trata, pibe. 🤝",
    "Che, posta que no capté nada, pero no te preocupes que te presto una mano. Contame qué onda. 🙌",
    "{nombre}, me mandaste algo pero no sé de qué va. Si me explicás mejor, te doy una respuesta de nivel, groso. 🥂",
    "¡Che! No te entendí bien, pero estoy acá para charlar. Decime qué necesitas y te ayudo como buen porteño. 🗽",
    "{nombre}, quilombo total con tu mensaje, pero no te preocupes, te respondo igual. ¿Qué hacés en tu día? 🌮"
  ]
  const t = LUNARDOS_RESP[Math.floor(Math.random() * LUNARDOS_RESP.length)]
  respuesta = t.replace(/\{nombre\}/g, username) + "\n\n_(Respuesta gratuita y local, sin gastar nada.)_"
}

await conn.sendMessage(m.chat, { text: respuesta }, { quoted: m })
await m.react('✔️')
break
}
case 'luminai': case 'gemini': case 'bard': {
if (!text) return conn.reply(m.chat, `❀ Ingrese una petición.`, m)
await m.react('🕒')
const apiMap = { luminai: 'qwen-qwq-32b', gemini: 'gemini', bard: 'grok-3-mini' }
const endpoint = apiMap[command]
const url = `${global.APIs.zenzxz.url}/ai/${endpoint}?text=${encodeURIComponent(text)}`
const res = await axios.get(url)
const output = res.data?.response || res.data?.assistant
if (!res.data?.status || !output) throw new Error(`Respuesta inválida de ${command}`)
await conn.sendMessage(m.chat, { text: output }, { quoted: m })
await m.react('✔️')
break
}}} catch (error) {
await m.react('✖️')
conn.reply(m.chat, `⚠︎ Che, hubo un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.command = ['gemini', 'bard', 'openai', 'dalle', 'flux', 'ia', 'chatgpt', 'luminai']
handler.help = ['gemini', 'bard', 'openai', 'dalle', 'flux', 'ia', 'chatgpt', 'luminai']
handler.tags = ['tools']

export default handler

const fluximg = { defaultRatio: "2:3", create: async (query) => {
const config = { headers: { accept: "*/*", authority: "1yjs1yldj7.execute-api.us-east-1.amazonaws.com", "user-agent": "Postify/1.0.0" }}
const url = `https://1yjs1yldj7.execute-api.us-east-1.amazonaws.com/default/ai_image?prompt=${encodeURIComponent(query)}&aspect_ratio=${fluximg.defaultRatio}`
const res = await axios.get(url, config)
return { imageLink: res.data.image_link }
}}
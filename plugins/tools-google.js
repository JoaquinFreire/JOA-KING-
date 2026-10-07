import fetch from 'node-fetch'
import cheerio from 'cheerio'

let handler = async (m, { text, usedPrefix }) => {
if (!text) return m.reply(`❀ Por favor, proporciona el término de búsqueda que deseas realizar a *Google*.\n\nEjemplo: ${usedPrefix}google gatos curiosos`)
try {
await m.react('🕒')
const searchUrl = new URL('https://www.bing.com/search')
searchUrl.searchParams.set('q', text)
searchUrl.searchParams.set('setlang', 'es')
const response = await fetch(searchUrl.href, {
headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
signal: AbortSignal.timeout(15000),
})
if (!response.ok) throw new Error(`Google respondió con HTTP ${response.status}.`)
const html = await response.text()
const $ = cheerio.load(html)
const results = []
const seen = new Set()
$('li.b_algo').each((_, element) => {
const result = $(element)
const anchor = result.find('h2 a').first()
const title = anchor.text().trim()
let destination = anchor.attr('href')
if (destination) {
try {
const bingUrl = new URL(destination)
const encoded = bingUrl.searchParams.get('u')
if (bingUrl.hostname.endsWith('bing.com') && encoded?.startsWith('a1')) {
destination = Buffer.from(encoded.slice(2), 'base64url').toString('utf8')
}
destination = new URL(destination).href
} catch {
return
}
}
if (!title || !destination || !/^https?:\/\//i.test(destination) || seen.has(destination)) return
seen.add(destination)
const description = result.find('.b_caption p').first().text().trim()
results.push({ title, description, url: destination })
})
if (!results.length) {
await m.react('✖️')
return m.reply('ꕥ Google no devolvió resultados para esa búsqueda. Inténtalo de nuevo más tarde.')
}
let replyMessage = `✦ Resultados de la búsqueda para: *${text}*\n\n`
results.slice(0, 5).forEach((item, index) => {
replyMessage += `❀ Título: *${index + 1}. ${item.title || 'Sin título'}*\n`
replyMessage += `✐︎ Descripción: ${item.description ? `*${item.description}*` : '_Sin descripción_'}\n`
replyMessage += `🜸 URL: ${item.url || '_Sin url_'}\n\n`})
await m.reply(replyMessage.trim())
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await m.reply(`⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}.`)
}}

handler.help = ['google']
handler.command = ['google']
handler.group = true

export default handler
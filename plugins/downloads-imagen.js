import axios from 'axios'
import { access } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const handler = async (m, { conn, text, usedPrefix, command }) => {
if (!text) return conn.reply(m.chat, `❀ Por favor, ingrese un texto para buscar una Imagen.`, m)
try {
await m.react('🕒')
const { urls, userAgent } = await getImageSearch(text)
if (command === 'imgg') {
if (!urls.length) {
await m.react('✖️')
return conn.reply(m.chat, '✧ No se encontraron imágenes para esa búsqueda.', m)
}
let image
for (const candidate of urls.slice(0, 8)) {
try {
const response = await axios.get(candidate, {
responseType: 'arraybuffer',
timeout: 15000,
maxContentLength: 15 * 1024 * 1024,
headers: { 'User-Agent': userAgent, Referer: 'https://www.google.com/' }
})
if (!(response.headers['content-type'] || '').startsWith('image/')) continue
image = Buffer.from(response.data)
break
} catch (error) {
console.warn(`[IMGG] No se pudo descargar un resultado (${error.response?.status || error.message}): ${candidate}`)
}
}
if (!image) throw new Error('Los resultados encontrados no se pudieron descargar como imágenes.')
await conn.sendMessage(m.chat, { image, caption: `❀ Resultado de búsqueda para: ${text}` }, { quoted: m })
console.log(`[IMGG] Se envió una imagen de Google Imágenes para "${text}".`)
await m.react('✔️')
return
}
if (urls.length < 2) return conn.reply(m.chat, '✧ No se encontraron suficientes imágenes para un álbum.', m)
const medias = urls.slice(0, 10).map(url => ({ type: 'image', data: { url } }))
const caption = `❀ Resultados de búsqueda para: ${text}`
await conn.sendSylphy(m.chat, medias, { caption, quoted: m })
await m.react('✔️')
} catch (error) {
await m.react('✖️')
conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['imagen', 'imgg']
handler.tags = ['descargas']
handler.command = ['imagen', 'image', 'imgg']

export default handler

async function getImageSearch(query) {
const executablePath = await findChromeExecutable()
const browser = await puppeteer.launch({
headless: true,
executablePath,
args: ['--no-sandbox', '--disable-dev-shm-usage']
})
try {
const page = await browser.newPage()
page.setDefaultNavigationTimeout(25000)
const searchUrl = new URL('https://www.google.com/search')
searchUrl.searchParams.set('tbm', 'isch')
searchUrl.searchParams.set('q', query)
searchUrl.searchParams.set('hl', 'es')
searchUrl.searchParams.set('safe', 'off')
await page.goto(searchUrl.href, { waitUntil: 'domcontentloaded' })

const isBlocked = await page.evaluate(() => /\/sorry\//.test(location.pathname) ||
/unusual traffic|tr[aá]fico inusual|consultas automatizadas/i.test(document.body?.innerText || ''))
if (isBlocked) {
throw new Error('Google bloqueó temporalmente la búsqueda automatizada. Inténtalo más tarde.')
}

await page.waitForFunction(() =>
document.querySelector('a[href*="imgurl="]') ||
/no results|no se han encontrado resultados|did not match any images/i.test(document.body?.innerText || ''),
{ timeout: 12000 }
).catch(() => {})

const urls = await page.evaluate(() => {
const results = []
const seen = new Set()
for (const anchor of document.querySelectorAll('a[href*="imgurl="]')) {
try {
const href = new URL(anchor.href, location.href)
const imageUrl = href.searchParams.get('imgurl')
if (imageUrl && /^https?:\/\//i.test(imageUrl) && !seen.has(imageUrl)) {
seen.add(imageUrl)
results.push(imageUrl)
}
} catch {}
}
return results
})
const userAgent = await page.evaluate(() => navigator.userAgent)

const blockedAfterLoad = await page.evaluate(() => /\/sorry\//.test(location.pathname) ||
/unusual traffic|tr[aá]fico inusual|consultas automatizadas/i.test(document.body?.innerText || ''))
if (blockedAfterLoad) {
throw new Error('Google bloqueó temporalmente la búsqueda automatizada. Inténtalo más tarde.')
}
return { urls, userAgent }
} finally {
await browser.close()
}
}

async function findChromeExecutable() {
const candidates = [
process.env.GOOGLE_CHROME_PATH,
process.env.CHROME_PATH,
process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
'/usr/bin/google-chrome',
'/usr/bin/chromium',
'/usr/bin/chromium-browser',
'/usr/bin/microsoft-edge',
'/opt/google/chrome/chrome',
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(Boolean)

for (const candidate of candidates) {
try {
await access(candidate)
return candidate
} catch {}
}
throw new Error('No encontré Google Chrome ni Microsoft Edge. Instala uno o configura GOOGLE_CHROME_PATH con la ruta al navegador.')
}

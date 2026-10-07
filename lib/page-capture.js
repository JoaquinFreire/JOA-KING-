import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const RECORDING_LIMIT = 15 * 1024 * 1024
const RECORDING_TIME = 7000
const PAGE_LOAD_TIMEOUT = 20000
const CAPTURE_TIMEOUT = 20000
const publicHostLookups = new Map()

async function withTimeout(promise, timeoutMs, message) {
let timer
try {
return await Promise.race([
promise,
new Promise((_, reject) => {
timer = setTimeout(() => reject(new Error(message)), timeoutMs)
}),
])
} finally {
clearTimeout(timer)
}
}

function isPublicAddress(address) {
if (isIP(address) === 4) {
const octets = address.split('.').map(Number)
const [first, second] = octets
return !(first === 0 || first === 10 || first === 127 ||
first >= 224 || (first === 169 && second === 254) ||
(first === 172 && second >= 16 && second <= 31) ||
(first === 192 && second === 168) ||
(first === 100 && second >= 64 && second <= 127) ||
(first === 192 && second === 0) ||
(first === 198 && (second === 18 || second === 19 || second === 51)) ||
(first === 203 && second === 0))
}
if (isIP(address) === 6) {
const normalized = address.toLowerCase()
return /^(?:2|3)/.test(normalized) && !normalized.startsWith('2001:db8:')
}
return false
}

async function validatePublicUrl(value) {
let url
try {
url = new URL(value)
} catch {
throw new Error('La URL no es válida.')
}
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
throw new Error('Solo se aceptan enlaces http o https.')
}
if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
throw new Error('No se permiten direcciones locales.')
}
const hostname = url.hostname.toLowerCase()
let addresses = isIP(hostname) ? [{ address: hostname }] : publicHostLookups.get(hostname)
if (!addresses) {
addresses = Promise.race([
lookup(hostname, { all: true, verbatim: true }).catch(() => []),
new Promise(resolve => setTimeout(() => resolve([]), 3000)),
])
publicHostLookups.set(hostname, addresses)
}
addresses = await addresses
if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
throw new Error('El enlace debe apuntar a un servidor público.')
}
return url
}

async function findChromeExecutable() {
const candidates = [
process.env.GOOGLE_CHROME_PATH,
process.env.CHROME_PATH,
process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
'/usr/bin/google-chrome',
'/usr/bin/chromium',
'/usr/bin/chromium-browser',
'/usr/bin/microsoft-edge',
'/opt/google/chrome/chrome',
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean)

for (const candidate of candidates) {
try {
await access(candidate)
return candidate
} catch {}
}
throw new Error('No encontré Google Chrome ni Microsoft Edge. Configura GOOGLE_CHROME_PATH con la ruta del navegador.')
}

async function openPage(url) {
await validatePublicUrl(url)
const browser = await puppeteer.launch({
headless: true,
executablePath: await findChromeExecutable(),
args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
})
try {
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
page.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT)
await page.setRequestInterception(true)
page.on('request', request => {
const protocol = new URL(request.url()).protocol
if (['data:', 'blob:', 'about:'].includes(protocol)) {
request.continue().catch(() => {})
return
}
validatePublicUrl(request.url())
.then(() => request.continue())
.catch(() => request.abort('blockedbyclient').catch(() => {}))
})
page.on('dialog', dialog => dialog.dismiss().catch(() => {}))
const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT })
if (!response?.ok()) {
throw new Error(`La página no cargó correctamente${response ? ` (HTTP ${response.status()})` : ''}.`)
}
await new Promise(resolve => setTimeout(resolve, 1000))
return { browser, page }
} catch (error) {
await browser.close()
throw error
}
}

export async function captureWebpage(url) {
const { browser, page } = await openPage(url)
try {
const screenshot = await withTimeout(
page.screenshot({ type: 'jpeg', quality: 75 }),
CAPTURE_TIMEOUT,
'La captura de la página tardó demasiado.',
)
return Buffer.from(screenshot)
} finally {
await browser.close()
}
}

export async function recordWebpage(url) {
const { browser, page } = await openPage(url)
const tempDir = join(process.cwd(), 'tmp')
const filePath = join(tempDir, `webpage-${Date.now()}-${process.pid}.mp4`)
let recorder
try {
await mkdir(tempDir, { recursive: true })
await page.evaluate(() => {
for (const video of document.querySelectorAll('video')) {
video.muted = true
video.play().catch(() => {})
}
window.scrollTo(0, 0)
})
const maxScroll = await page.evaluate(() => Math.min(Math.max(document.documentElement.scrollHeight - innerHeight, 0), 6000))
recorder = await page.screencast({ path: filePath, format: 'mp4', fps: 12, scale: 0.5 })
await withTimeout((async () => {
const steps = Math.ceil(RECORDING_TIME / 500)
for (let step = 0; step < steps; step++) {
const progress = step / (steps - 1)
const position = progress < 0.82
? maxScroll * (progress / 0.82)
  : maxScroll * (1 - (progress - 0.82) / 0.18)
await page.evaluate(scrollPosition => window.scrollTo(0, scrollPosition), Math.max(0, Math.min(maxScroll, position)))
await new Promise(resolve => setTimeout(resolve, RECORDING_TIME / steps))
}
await new Promise(resolve => setTimeout(resolve, 500))
})(), CAPTURE_TIMEOUT, 'La grabación de la página tardó demasiado.')
await withTimeout(recorder.stop(), CAPTURE_TIMEOUT, 'No se pudo finalizar el video.')
recorder = null
const fileStats = await stat(filePath)
if (!fileStats.size) throw new Error('No se pudo generar la grabación de la página.')
if (fileStats.size > RECORDING_LIMIT) throw new Error('El video generado supera el límite de 15 MB.')
return await readFile(filePath)
} finally {
if (recorder) await recorder.stop().catch(() => {})
await browser.close()
await rm(filePath, { force: true }).catch(() => {})
}
}

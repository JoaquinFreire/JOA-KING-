process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1'
import './settings.js'
import './plugins/_allfake.js'
import cfonts from 'cfonts'
import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'
import { platform } from 'process'
import * as ws from 'ws'
import fs, { readdirSync, statSync, unlinkSync, existsSync, mkdirSync, readFileSync, rmSync, watch } from 'fs'
import yargs from 'yargs';
import { spawn, execSync } from 'child_process'
import lodash from 'lodash'
import { JoaKingSubBot } from './plugins/sockets-serbot.js'
import chalk from 'chalk'
import syntaxerror from 'syntax-error'
import pino from 'pino'
import Pino from 'pino'
import path, { join, dirname } from 'path'
import { Boom } from '@hapi/boom'
import { makeWASocket, protoType, serialize } from './lib/simple.js'
import { Low, JSONFile } from 'lowdb'
import store from './lib/store.js'
const { proto } = await import('@whiskeysockets/baileys')
import pkg from 'google-libphonenumber'
const { PhoneNumberUtil } = pkg
const phoneUtil = PhoneNumberUtil.getInstance()
const { DisconnectReason, useMultiFileAuthState, MessageRetryMap, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser } = await import('@whiskeysockets/baileys')
import readline, { createInterface } from 'readline'
import { format } from 'util'
import { createServer } from 'http'
import NodeCache from 'node-cache'
import QRCode from 'qrcode'
const { CONNECTING } = ws
const { chain } = lodash
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000
const pairingSecret = process.env.PAIRING_SECRET
const ownerErrorJid = '5493513117202@s.whatsapp.net'
const reportedErrors = new Map()
global.latestQR = null

global.reportOwnerError = async function reportOwnerError(error, context = 'runtime') {
const message = error instanceof Error ? error.stack || error.message : String(error)
const key = `${context}:${message.split('\n')[0]}`
const now = Date.now()
if (reportedErrors.has(key) && now - reportedErrors.get(key) < 60 * 1000) return
reportedErrors.set(key, now)
const text = `⚠️ Error de JOA-KING\nContexto: ${context}\nFecha: ${new Date().toISOString()}\n\n${message}`
try {
if (global.conn?.sendMessage) await global.conn.sendMessage(ownerErrorJid, { text: text.slice(0, 6000) })
} catch (sendError) {
process.stdout.write(`No se pudo enviar el error al propietario: ${sendError.message}\n`)
}}

const originalConsoleError = console.error.bind(console)
console.error = (...args) => {
originalConsoleError(...args)
const text = args.map((arg) => arg instanceof Error ? arg.stack || arg.message : String(arg)).join(' ')
if (/Bad MAC|Failed to decrypt|Message absent from node/i.test(text)) {
global.reportOwnerError(text, 'descifrado de WhatsApp').catch(() => {})
}}

const webServer = createServer(async (request, response) => {
const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
const authorized = pairingSecret && requestUrl.searchParams.get('key') === pairingSecret

if (requestUrl.pathname === '/health') {
response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
return response.end(JSON.stringify({ name: 'JOA-KING', status: 'online' }))
}

if (requestUrl.pathname === '/connect' && authorized) {
const qr = global.latestQR
const content = qr
	? `<h1>JOA-KING</h1><p>Escanea este QR desde WhatsApp > Dispositivos vinculados.</p><img src="${qr}" alt="QR de vinculacion"><meta http-equiv="refresh" content="5">`
	: '<h1>JOA-KING</h1><p>QR no disponible. La cuenta ya está conectada o todavía se está iniciando. Recarga en unos segundos.</p><meta http-equiv="refresh" content="5">'
response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
return response.end(`<!doctype html><html><body style="font-family:sans-serif;text-align:center">${content}</body></html>`)
}

response.writeHead(requestUrl.pathname === '/connect' ? 403 : 200, { 'Content-Type': 'application/json; charset=utf-8' })
response.end(JSON.stringify({ name: 'JOA-KING', status: requestUrl.pathname === '/connect' ? 'forbidden' : 'online' }))
})
webServer.listen(PORT, '0.0.0.0', () => {
console.log(`[ ✿ ] Servidor web activo en el puerto ${PORT}`)
})

let { say } = cfonts
console.log(chalk.magentaBright('\n❀ Iniciando...'))
say('JOA-KING', {
font: 'simple',
align: 'left',
gradient: ['green', 'white']
})
say('Created for JOA-KING', {
font: 'console',
align: 'center',
colors: ['cyan', 'magenta', 'yellow']
})
protoType()
serialize()

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
return rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();
}; global.__dirname = function dirname(pathURL) {
return path.dirname(global.__filename(pathURL, true))
}; global.__require = function require(dir = import.meta.url) {
return createRequire(dir)
}

global.timestamp = {start: new Date}
const __dirname = global.__dirname(import.meta.url)
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse())
global.prefix = new RegExp('^%')

global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : new JSONFile('database.json'))
global.DATABASE = global.db;
global.loadDatabase = async function loadDatabase() {
if (global.db.READ) {
return new Promise((resolve) => setInterval(async function() {
if (!global.db.READ) {
clearInterval(this);
resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
}}, 1 * 1000));
}
if (global.db.data !== null) return;
global.db.READ = true;
await global.db.read().catch(console.error);
global.db.READ = null;
global.db.data = {
users: {},
chats: {},
settings: {},
...(global.db.data || {}),
};
global.db.chain = chain(global.db.data);
};
loadDatabase(); 

mkdirSync(global.sessions, { recursive: true })
console.log(`[ ✿ ] Sesión WhatsApp: ${path.resolve(global.sessions)}`)
const {state, saveState, saveCreds} = await useMultiFileAuthState(global.sessions)
const msgRetryCounterMap = new Map()
const msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 })
const userDevicesCache = new NodeCache({ stdTTL: 0, checkperiod: 0 })
const { version } = await fetchLatestBaileysVersion()
let phoneNumber = global.botNumber
const methodCodeQR = process.argv.includes("qr") || process.env.WHATSAPP_QR === 'true'
const methodCode = !!phoneNumber || process.argv.includes("code")
const MethodMobile = process.argv.includes("mobile")
const colors = chalk.bold.white
const qrOption = chalk.blueBright
const textOption = chalk.cyan
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (texto) => new Promise((resolver) => rl.question(texto, resolver))
let opcion
if (methodCodeQR) {
opcion = '1'
}
if (!methodCodeQR && !methodCode && !fs.existsSync(`./${sessions}/creds.json`)) {
do {
opcion = await question(colors("Seleccione una opción:\n") + qrOption("1. Con código QR\n") + textOption("2. Con código de texto de 8 dígitos\n--> "))
if (!/^[1-2]$/.test(opcion)) {
console.log(chalk.bold.redBright(`No se permiten numeros que no sean 1 o 2, tampoco letras o símbolos especiales.`))
}} while (opcion !== '1' && opcion !== '2' || fs.existsSync(`./${sessions}/creds.json`))
} 

console.info = () => { }

const connectionOptions = {
logger: pino({ level: 'silent' }),
mobile: MethodMobile, 
browser: ["MacOs", "Safari"],
auth: {
creds: state.creds,
keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "fatal" }).child({ level: "fatal" })),
},
markOnlineOnConnect: false, 
generateHighQualityLinkPreview: true, 
syncFullHistory: false,
getMessage: async (key) => {
try {
let jid = jidNormalizedUser(key.remoteJid);
let msg = await store.loadMessage(jid, key.id);
return msg?.message || "";
} catch (error) {
return "";
}},
msgRetryCounterCache: msgRetryCounterCache || new Map(),
userDevicesCache: userDevicesCache || new Map(),
defaultQueryTimeoutMs: undefined,
cachedGroupMetadata: (jid) => globalThis.conn.chats[jid] ?? {},
version: version, 
keepAliveIntervalMs: 55000, 
maxIdleTimeMs: 60000, 
};

global.conn = makeWASocket(connectionOptions);
conn.ev.on("creds.update", saveCreds)

if (!fs.existsSync(`./${sessions}/creds.json`)) {
if (opcion === '2' || methodCode) {
opcion = '2'
if (!conn.authState.creds.registered) {
let addNumber
if (!!phoneNumber) {
addNumber = phoneNumber.replace(/[^0-9]/g, '')
} else {
do {
phoneNumber = await question(chalk.bgBlack(chalk.bold.greenBright(`[ ✿ ]  Por favor, Ingrese el número de WhatsApp.\n${chalk.bold.magentaBright('---> ')}`)))
phoneNumber = phoneNumber.replace(/\D/g,'')
if (!phoneNumber.startsWith('+')) {
phoneNumber = `+${phoneNumber}`
}} while (!await isValidPhoneNumber(phoneNumber))
rl.close()
addNumber = phoneNumber.replace(/\D/g, '')
setTimeout(async () => {
let codeBot = await conn.requestPairingCode(addNumber)
codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
console.log(chalk.bold.white(chalk.bgMagenta(`[ ✿ ]  Código:`)), chalk.bold.white(chalk.white(codeBot)))
}, 3000)
}}}}
conn.isInit = false;
conn.well = false;
conn.logger.info(`[ ✿ ]  H E C H O\n`)
if (!opts['test']) {
if (global.db) setInterval(async () => {
if (global.db.data) await global.db.write()
if (opts['autocleartmp'] && (global.support || {}).find) (tmp = [os.tmpdir(), 'tmp', `${jadi}`], tmp.forEach((filename) => cp.spawn('find', [filename, '-amin', '3', '-type', 'f', '-delete'])));
}, 30 * 1000);
}

async function connectionUpdate(update) {
const {connection, lastDisconnect, isNewLogin} = update;
global.stopped = connection;
if (isNewLogin) conn.isInit = true;
const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
if (global.db.data == null) loadDatabase()
if (update.qr && (opcion == '1' || methodCodeQR)) {
global.latestQR = await QRCode.toDataURL(update.qr)
console.log(chalk.green.bold(`[ ✿ ]  Escanea este código QR`))
console.log(await QRCode.toString(update.qr, { type: 'terminal', small: true }))
}
if (connection === "open") {
global.latestQR = null
const userJid = jidNormalizedUser(conn.user.id)
const userName = conn.user.name || conn.user.verifiedName || "Desconocido"
await joinChannels(conn)
console.log(chalk.green.bold(`[ ✿ ]  Conectado a: ${userName}`))
}
let reason = new Boom(lastDisconnect?.error)?.output?.statusCode
if (connection === "close") {
if (reason === 440) {
console.log(chalk.red("→ (440) › WhatsApp reemplazó esta sesión. Detén cualquier otra instancia del bot y reinicia una sola vez."));
return
}
if (reason === DisconnectReason.loggedOut || reason === 401) {
console.log(chalk.red(`→ (${code || reason}) › La sesión fue cerrada. Vincula el bot nuevamente.`));
if (!global.authStateCleared) {
global.authStateCleared = true
try {
rmSync(global.sessions, { recursive: true, force: true })
mkdirSync(global.sessions, { recursive: true })
console.log(chalk.yellow(`→ Sesión eliminada automáticamente de ${path.resolve(global.sessions)}.`))
} catch (error) {
console.error('No se pudo limpiar la sesión cerrada:', error)
}
}
return
}
if (global.reconnecting) return
global.reconnecting = true
console.log(chalk.yellow(`→ (${code || reason || 'desconocido'}) › Reconectando el Bot Principal en 5 segundos...`));
setTimeout(async () => {
try {
await global.reloadHandler(true)
global.timestamp.connect = new Date
} catch (error) {
console.error('Error reconectando el Bot Principal:', error)
} finally {
global.reconnecting = false
}
}, 5000)
}};
process.on('uncaughtException', (error) => {
console.error(error)
global.reportOwnerError(error, 'uncaughtException').catch(() => {})
});
let isInit = true;
let handler = await import('./handler.js')
global.reloadHandler = async function(restatConn) {
try {
const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
if (Object.keys(Handler || {}).length) handler = Handler
} catch (e) {
console.error(e);
}
if (restatConn) {
const oldChats = global.conn.chats
try {
global.conn.ws.close()
} catch { }
conn.ev.removeAllListeners()
global.conn = makeWASocket(connectionOptions, {chats: oldChats})
isInit = true
}
if (!isInit) {
conn.ev.off('messages.upsert', conn.handler)
conn.ev.off('connection.update', conn.connectionUpdate)
conn.ev.off('creds.update', conn.credsUpdate)
}
conn.handler = handler.handler.bind(global.conn)
conn.connectionUpdate = connectionUpdate.bind(global.conn)
conn.credsUpdate = saveCreds.bind(global.conn, true)
const currentDateTime = new Date()
const messageDateTime = new Date(conn.ev)
if (currentDateTime >= messageDateTime) {
const chats = Object.entries(conn.chats).filter(([jid, chat]) => !jid.endsWith('@g.us') && chat.isChats).map((v) => v[0])
} else {
const chats = Object.entries(conn.chats).filter(([jid, chat]) => !jid.endsWith('@g.us') && chat.isChats).map((v) => v[0])
}
conn.ev.on('messages.upsert', conn.handler)
conn.ev.on('connection.update', conn.connectionUpdate)
conn.ev.on('creds.update', conn.credsUpdate)
isInit = false
return true
};
process.on('unhandledRejection', (reason, promise) => {
console.error("Rechazo no manejado detectado:", reason);
if (/No matching sessions found/i.test(String(reason))) return
global.reportOwnerError(reason, 'unhandledRejection').catch(() => {})
});

global.rutaJadiBot = join(__dirname, `./${jadi}`)
if (global.JoaKingSubBots) {
if (!existsSync(global.rutaJadiBot)) {
mkdirSync(global.rutaJadiBot, { recursive: true }) 
console.log(chalk.bold.cyan(`ꕥ La carpeta: ${jadi} se creó correctamente.`))
} else {
console.log(chalk.bold.cyan(`ꕥ La carpeta: ${jadi} ya está creada.`)) 
}
const readRutaJadiBot = readdirSync(rutaJadiBot)
if (readRutaJadiBot.length > 0) {
const creds = 'creds.json'
for (const gjbts of readRutaJadiBot) {
const botPath = join(rutaJadiBot, gjbts)
const readBotPath = readdirSync(botPath)
if (readBotPath.includes(creds)) {
JoaKingSubBot({pathJoaKingSubBot: botPath, m: null, conn, args: '', usedPrefix: '/', command: 'serbot'})
}}}}

const pluginFolder = join(__dirname, './plugins')
const pluginFilter = (filename) => /\.js$/.test(filename)
global.plugins = {}
async function filesInit() {
for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
try {
const file = global.__filename(join(pluginFolder, filename))
const module = await import(file)
global.plugins[filename] = module.default || module
} catch (e) {
conn.logger.error(e)
delete global.plugins[filename]
}}}
filesInit()
	.then(() => conn.logger.info(`[ ✿ ] Plugins cargados: ${Object.keys(global.plugins).length}`))
	.catch(console.error)

global.reload = async (_ev, filename) => {
if (pluginFilter(filename)) {
const dir = global.__filename(join(pluginFolder, filename), true);
if (filename in global.plugins) {
if (existsSync(dir)) conn.logger.info(` updated plugin - '${filename}'`)
else {
conn.logger.warn(`deleted plugin - '${filename}'`)
return delete global.plugins[filename]
}} else conn.logger.info(`new plugin - '${filename}'`)
const err = syntaxerror(readFileSync(dir), filename, {
sourceType: 'module',
allowAwaitOutsideFunction: true,
});
if (err) conn.logger.error(`syntax error while loading '${filename}'\n${format(err)}`)
else {
try {
const module = (await import(`${global.__filename(dir)}?update=${Date.now()}`));
global.plugins[filename] = module.default || module;
} catch (e) {
conn.logger.error(`error require plugin '${filename}\n${format(e)}'`)
} finally {
global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)))
}}}}
Object.freeze(global.reload)
watch(pluginFolder, global.reload)
await global.reloadHandler()
async function _quickTest() {
const test = await Promise.all([
spawn('ffmpeg'),
spawn('ffprobe'),
spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex', 'color', '-frames:v', '1', '-f', 'webp', '-']),
spawn('convert'),
spawn('magick'),
spawn('gm'),
spawn('find', ['--version']),
].map((p) => {
return Promise.race([
new Promise((resolve) => {
p.on('close', (code) => {
resolve(code !== 127);
});
}),
new Promise((resolve) => {
p.on('error', (_) => resolve(false));
})]);
}));
const [ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find] = test;
const s = global.support = {ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find};
Object.freeze(global.support);
}
// Tmp
setInterval(async () => {
const tmpDir = join(__dirname, 'tmp')
try {
const filenames = readdirSync(tmpDir)
filenames.forEach(file => {
const filePath = join(tmpDir, file)
unlinkSync(filePath)})
console.log(chalk.gray(`→ Archivos de la carpeta TMP eliminados`))
} catch {
console.log(chalk.gray(`→ Los archivos de la carpeta TMP no se pudieron eliminar`));
}}, 30 * 1000) 
_quickTest().catch(console.error)
async function isValidPhoneNumber(number) {
try {
number = number.replace(/\s+/g, '')
if (number.startsWith('+521')) {
number = number.replace('+521', '+52');
} else if (number.startsWith('+52') && number[4] === '1') {
number = number.replace('+52 1', '+52');
}
const parsedNumber = phoneUtil.parseAndKeepRawInput(number)
return phoneUtil.isValidNumber(parsedNumber)
} catch (error) {
return false
}}

async function joinChannels(sock) {
for (const value of Object.values(global.ch)) {
if (typeof value === 'string' && value.endsWith('@newsletter')) {
await sock.newsletterFollow(value).catch(() => {})
}}}

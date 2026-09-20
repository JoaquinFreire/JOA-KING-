import { watchFile, unwatchFile } from "fs"
import chalk from "chalk"
import { fileURLToPath, pathToFileURL } from "url"
import fs from "fs"
import path from "path"


//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

//BETA: Si quiere evitar escribir el número que será bot en la consola, agregué desde aquí entonces:
//Sólo aplica para opción 2 (ser bot con código de texto de 8 digitos)
global.botNumber = "" //Ejemplo: 573218138672

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.owner = [
"59169214837",
"5493513117202",
]

global.suittag = ["59169082575"] 
global.prems = []

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.libreria = "Baileys Multi Device"
global.vs = "^1.8.2|Latest"
global.nameqr = "JOA-KING"
global.sessions = process.env.WHATSAPP_SESSION_PATH || "Sessions/Principal"
global.jadi = "Sessions/SubBot"
global.JoaKingSubBots = true

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.botname = "✿JOA-KING✿"
global.textbot = "✿JOA-KING✿ "
global.dev = "© ⍴᥆ᥕᥱrᥱძ ᑲᥡ 𝙰𝚕𝚋𝚊𝟶𝟽𝟶𝟻𝟶𝟹"
global.author = "© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚕𝚋𝚊𝟶𝟽𝟶𝟻𝟶𝟹"
global.etiqueta = "𝙰𝚕𝚋𝚊𝟶𝟽𝟶𝟻𝟶𝟹"
global.currency = "¥otsucoins"
global.banner = "https://qu.ax/iBlgz.jpg"
global.icono = "https://qu.ax/zRNgk.jpg"
const catalogoPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'catalogo.jpg')
global.catalogo = fs.existsSync(catalogoPath) ? fs.readFileSync(catalogoPath) : null

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.group = "https://whatsapp.com/channel/0029VaAN15BJP21BYCJ3tH04"
global.community = "https://whatsapp.com/channel/0029VaAN15BJP21BYCJ3tH04"
global.channel = "https://whatsapp.com/channel/0029VaAN15BJP21BYCJ3tH04"
global.github = ""
global.gmail = ""
//*_____________________________

global.ch = {
ch1: '120363198641161536@newsletter',
ch2: "120363198641161536@newsletter",
ch3: "120363198641161536@newsletter"}

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.APIs = {
xyro: { url: "https://api.xyro.site", key: null },
yupra: { url: "https://api.yupra.my.id", key: null },
vreden: { url: "https://api.vreden.web.id", key: null },
delirius: { url: "https://api.delirius.store", key: null },
zenzxz: { url: "https://api.zenzxz.my.id", key: null },
siputzx: { url: "https://api.siputzx.my.id", key: null },
adonix: { url: "https://api-adonix.ultraplus.click", key: 'Destroy-xyz' }
}

//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*


let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
unwatchFile(file)
console.log(chalk.redBright("Update 'settings.js'"))
import(`${pathToFileURL(file).href}?update=${Date.now()}`)
})

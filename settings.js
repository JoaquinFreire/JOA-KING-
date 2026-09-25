import { watchFile, unwatchFile } from "fs"
import chalk from "chalk"
import { fileURLToPath, pathToFileURL } from "url"
import fs from "fs"
import path from "path"


//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

//BETA: Si quiere evitar escribir el número que será bot en la consola, agregué desde aquí entonces:
//Sólo aplica para opción 2 (ser bot con código de texto de 8 digitos)
// IMPORTANTE: este valor es un DEFAULT para el emparejamiento del subbot, no se toma autom.áticamente del LID del usuario.
global.botNumber = process.env.BOT_NUMBER || "" // Deja vacío para no forzar código de emparejamiento por defecto.
global.subBotSettings = {
  defaultPairingNumber: process.env.SUBBOT_NUMBER || global.botNumber || "",
  allowSenderFallback: false,
  preferExplicitNumber: true,
  allowedNumbers: ["5493517076366"]
}

global.getSubBotPairingNumber = function (explicitValue = "", senderJid = "", fallback = global.subBotSettings?.defaultPairingNumber || global.botNumber || "") {
  const normalize = (value = "") => String(value || "").replace(/\D/g, "")
  const explicit = normalize(explicitValue)
  if (explicit.length >= 8) return explicit

  const sender = normalize(senderJid)
  const senderIsLid = /@lid$/i.test(String(senderJid || ""))
  const allowed = Array.isArray(global.subBotSettings?.allowedNumbers)
    ? global.subBotSettings.allowedNumbers.map((value) => normalize(value)).filter(Boolean)
    : []

  if (!senderIsLid && sender.length >= 8 && global.subBotSettings?.allowSenderFallback !== false) return sender
  if (allowed.length > 0) return allowed[0]
  if (normalize(fallback).length >= 8) return normalize(fallback)
  return ""
}
//*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*

global.owner = [
"5493513117202",
]

global.suittag = ["5493513117202"] 
global.prems = []


global.libreria = "Baileys Multi Device"
global.vs = "^1.8.2|Latest"
global.nameqr = "JOA-KING"
global.sessions = process.env.WHATSAPP_SESSION_PATH || "Sessions/Principal"
global.jadi = "Sessions/SubBot"
global.JoaKingSubBots = true


global.botname = "✿JOA-KING✿"
global.textbot = "✿JOA-KING✿ "
global.dev = "JoaquinFreire"
global.author = "Joaquin.F"
global.etiqueta = ""
global.currency = "kingcoins"
global.banner = "https://qu.ax/x/LGStZ.jpg"
global.icono = "https://qu.ax/x/nfiZd.png"
const catalogoPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'catalogo.jpg')
global.catalogo = fs.existsSync(catalogoPath) ? fs.readFileSync(catalogoPath) : null


global.group = ""
global.community = ""
global.channel = ""
global.github = ""
global.gmail = ""
//*_____________________________

global.ch = {}


global.APIs = {
xyro: { url: "https://api.xyro.site", key: null },
yupra: { url: "https://api.yupra.my.id", key: null },
vreden: { url: "https://api.vreden.web.id", key: null },
delirius: { url: "https://api.delirius.store", key: null },
zenzxz: { url: "https://api.zenzxz.my.id", key: null },
siputzx: { url: "https://api.siputzx.my.id", key: null },
adonix: { url: "https://api-adonix.ultraplus.click", key: 'Destroy-xyz' }
}


let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
unwatchFile(file)
console.log(chalk.redBright("Update 'settings.js'"))
import(`${pathToFileURL(file).href}?update=${Date.now()}`)
})

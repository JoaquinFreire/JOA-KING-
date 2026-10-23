import axios from "axios"

const BOT_INFO = {
  nombre: "✿JOA-KING✿",
  version: "^1.8.2|Latest",
  libreria: "Baileys Multi Device",
  desarrollador: "JoaquinFreire (Joaquin.F)",
  moneda: "kingcoins",
  owner: "5493513117202",
  tipo: "WhatsApp Multi Device",
  subbots: true,
  github: "https://github.com/JoaquinFreire/JOA-KING-.git",
}

const CATEGORIAS = {
  DESCARGAS: ["#tiktok • #tt", "#wagroups • #wpgroups", "#mediafire • #mf", "#mega • #mg", "#playc • #playv", "#facebook • #fb", "#twitter • #x", "#ig • #instagram", "#pinterest • #pin", "#image • #imagen", "%imgg", "#apk • #modapk", "#ytsearch • #search", "#spotify • #splay"],
  SOCKETS: ["#qr • #code", "#bots", "#disconnectbot", "#status • #estado", "#p • #ping", "#join", "#leave • #salir", "#logout", "#setpfp • #setimage", "#setstatus", "#setusername"],
  UTILITIES: ["#help • #menu", "#menu <sección>", "#sc • #script", "#sug • #suggest", "#reporte • #reportar", "#calcular • #cal", "#traducir", "#ip", "#geoip", "#letra", "#lyrics", "#wikipedia", "#npmjs", "#fetch", "#ssweb", "#webimage", "#webvideo", "#sticker", "#stickers", "#toimg", "#voz", "#whatmusic", "#screenw", "#cal", "#lid", "#say", "#chagpt", "#ia", "#gemini", "#bard", "#luminai", "#dalle", "#flux"],
  FUN: ["#chiste", "#piropo", "#horoscopo", "#afktime", "#fun", "#randomtop", "#screenw", "#anime-reactions", "#ppcouple • #ppcp"],
  PROFILES: ["#profile", "#setprofile", "#pfp", "#marry", "#misex", "#leaderboard • #lboard • #top", "#levelup"],
  GROUPS: ["#tag • #hidetag • #tagall", "%ban • %unban", "#onlyadmin", "#open • #abrir", "#kick", "#promote • #demote", "#link", "#setwelcome", "#setgp", "#infogrupo", "#inactivos", "#linea", "#revoke", "#add", "#delete", "#warns", "#setprimary"],
  MUDAE: ["%menumudae", "%rw • %quitarpj • %regalarpj • %suertepj", "%claim", "%delchar", "%ginfo", "%giveallharem", "%harem", "%regalar", "%robwaifu", "%rollwaifu", "%serielist", "%setclaim", "%setfav", "%topwaifus", "%trade", "%vote", "%winfo", "%wshop"],
  RPG: ["#adventure", "#balance • #baltop", "#casino", "#coffer", "#coinflip", "#crime", "#daily", "#deposit", "#dungeon", "#einfo", "#fishing", "#givecoins", "#heal", "#hunt", "#mine", "#monthly", "#roulette", "#slot", "#slut", "#steal", "#weekly", "#withdraw", "#work"],
  ANIME: ["#angry • #enojado", "#anime-info", "#anime-pokedex", "#anime-ppcp", "#anime-waifu"],
  OWNER: ["restart, update, backup, caller, banned, addremove, autoadmin, prefix, voip, exec, savefiles, clear"],
  TOOLS: ["chagpt, ia, chatgpt, luminai, gemini, bard, dalle, flux, google, ejecutar, etc."]
}

const RESTRICCIONES = {
  grupo: "Solo se pueden usar en grupos.",
  admin: "Solo administradores del grupo pueden usarlo.",
  botAdmin: "El bot debe ser administrador del grupo.",
  owner: "Solo el creador/owner del bot puede usarlo.",
  rowner: "Solo los dueños principales (rowner) pueden usarlo.",
  premium: "Solo usuarios premium pueden usarlo.",
  self: "En modo self solo el owner puede usar comandos."
}

const FAQ = [
  {
    q: ["qué eres", "quién eres", "qué sos", "quién sos", "qué es joa-king", "qué bot es este"],
    a: "Che, soy *✿JOA-KING✿*, un bot de WhatsApp Multi Device creado por *JoaquinFreire*. Estoy basado en Baileys y ando en la versión *^1.8.2|Latest*. Te mando files, música, videos, gacha, juegos de rol y más, todo con buena onda argentina. 🇦🇷"
  },
  {
    q: ["qué puedo hacer", "qué funciones tenés", "qué comandos hay", "qué se puede hacer", "menú completo", "todo lo que tenés"],
    a: "Mirá pibe, tengo montones de cosas: descargas de TikTok/YouTube/Instagram/Facebook/Twitter, subbots con QR, utilidades (calcular, IP, geoIP, letra, Wikipedia, stickers), diversión (chistes, piropos, horóscopo), perfiles con nivel y experiencia, administración de grupos (ban, tagall, kick, promover), gacha Mudae para coleccionar waifus, juegos RPG (casino, pesca, minería, criminales), reacciones de anime y comandos de owner. Usá *#menu* para ver todo o preguntame lo que quieras con *%iabot*."
  },
  {
    q: ["cómo me uno a un grupo", "unirme a grupo", "invitar bot al grupo"],
    a: "Che, si querés que entre a un grupo, el owner tiene que usar *#join* con el link de invitación, o alguien me agrega directamente. Si soy subbot, se registra con *#qr • #code*."
  },
  {
    q: ["quién es el dueño", "quién es el owner", "quién te creó", "quién es el creador"],
    a: "El dueño de todo este quilombo es *JoaquinFreire* (Joaquin.F), número *5493513117202*. Él es el que manda, el que configura y el que puede usar comandos de owner."
  },
  {
    q: ["qué son los kingcoins", "qué es la moneda", "cómo gano kingcoins"],
    a: "La moneda del bot se llama *kingcoins*. La ganás usando el bot: mandando mensajes, subiendo de nivel, trabajando, cazando crímenes, jugando al casino, etc. Se usa en el sistema RPG y en la gacha."
  },
  {
    q: ["cómo subo de nivel", "qué es la experiencia", "sistema de nivel"],
    a: "Cada vez que usás comandos y mandás mensajes ganás experiencia (*exp*). Cuando sumás suficiente, subís de nivel. Podés ver tu posición con *#leaderboard • #lboard • #top*."
  },
  {
    q: ["qué es mudae", "qué es la gacha", "cómo juego a la gacha"],
    a: "Mudae es un sistema de gacha para coleccionar personajes (waifus/husbandos). Usá *%menumudae* para ver los comandos: reclamar, regalar, robar, tirar suerte, top de waifus, tienda, etc. Es re adictivo, boludo."
  },
  {
    q: ["qué es un subbot", "cómo creo mi propio bot", "subbots"],
    a: "Con JOA-KING podés crear tu propio sub-bot de WhatsApp usando *#qr • #code*. Te genera un código QR o de 8 dígitos para que emparejes tu número y tengas tu bot funcionando. Mirá *#bots* para ver cuántos hay conectados."
  },
  {
    q: ["qué comandos necesitan admin", "quién puede banear", "quién puede kickear"],
    a: "Los comandos de administración de grupos (*#kick, #promote, #demote, #ban, #unban, #tagall*, etc.) necesitan que seas administrador del grupo. Algunos también necesitan que yo sea admin del grupo (*botAdmin*). Los de owner (*%ban, %unban* de usuarios del bot, restart, update, etc.) solo los usa el dueño."
  },
  {
    q: ["cómo reporto un error", "reporte", "reportar falla"],
    a: "Si algo anda mal, usá *#reporte • #reportar* para avisarle al desarrollador. También podés usar *#sug • #suggest* para sugerir funciones nuevas."
  },
  {
    q: ["prefijos", "cómo se escriben los comandos", "signos # % @ &"],
    a: "Los comandos se pueden escribir con *#*, *%*, *@* o *&*. Por ejemplo: *#menu*, *%ia*, *%iabot*, *#ping*. Cualquiera de esos signs sirve."
  },
  {
    q: ["qué no se puede hacer", "qué está prohibido", "límites del bot"],
    a: "No se puede usar el bot para spam, estafas, contenido ilegal o cosas groseras. Los comandos de owner son solo para el dueño. Los de admin son solo para admins de grupo. Y si el bot está en modo *self*, solo el owner puede usar comandos. También hay grupos que pueden estar banneados."
  },
  {
    q: ["cómo descargo videos", "descargar tiktok", "descargar youtube", "descargar instagram"],
    a: "Usá los comandos de descargas: *#tiktok • #tt* para TikTok, *#playc • #playv* para YouTube (audio/video), *#ig • #instagram* para Instagram, *#facebook • #fb* para Facebook, *#twitter • #x* para Twitter/X. Solo pasá el link o la búsqueda."
  },
  {
    q: ["qué es el modo self", "modo self", "solo owner puede usar"],
    a: "El modo *self* hace que solo el owner del bot pueda usar comandos. Se activa en la configuración y sirve para que el bot sea privado del creador."
  },
  {
    q: ["cómo cambio mi nombre de perfil", "cambiar nombre usuario", "setusername"],
    a: "Usá *#setusername* + tu nombre para cambiar cómo aparecés en el bot. También podés cambiar tu foto de perfil con *#setpfp • #setimage* y tu estado con *#setstatus*."
  },
  {
    q: ["cómo uso la ia", "comando ia", "chatear con la ia", "%ia"],
    a: "Usá *%ia* + lo que quieras preguntar o decir. Es una IA normal para charlar de cualquier cosa. Ejemplo: *%ia hola cómo estás* o *%ia contame un chiste*. Siempre responde, aunque se quede sin internet usa respuestas locales argentinas."
  }
]

function nombreUsuario(m, conn) {
  try {
    const dbName = global.db?.data?.users?.[m.sender]?.name
    if (dbName) return dbName
  } catch {}
  return (m.sender || "").split("@")[0] || "amigo"
}

function buscarFAQ(texto) {
  const t = texto.toLowerCase()
  for (const item of FAQ) {
    for (const palabra of item.q) {
      if (t.includes(palabra)) return item.a
    }
  }
  return null
}

function respuestaGeneral(nombre) {
  const respuestas = [
    `Che {nombre}, eso no lo tengo en mi cabeza de bot, pero probá con *%iabot* y decime algo más específico sobre JOA-KING. ¡Te ayudo con lo que sea! 🤙`,
    `{nombre}, posta que no sé de qué me hablás. Si es sobre el bot, sus funciones o comandos, usá *%iabot* que te cuento todo. 🍻`,
    `Che pibe, no te entiendo bien esa pregunta. Si querés saber algo del bot, sus menús, quién puede usar qué o cómo funciona, preguntame con *%iabot*. 🇦🇷`,
    `{nombre}, quilombo con tu consulta. Pero si es sobre JOA-KING, sus comandos, el owner, la gacha o el RPG, usá *%iabot* y te respondo al toque. 🍕}`
  ]
  const t = respuestas[Math.floor(Math.random() * respuestas.length)]
  return t.replace(/\{nombre\}/g, nombre)
}

const handler = async (m, { conn, command, usedPrefix, text, args }) => {
  try {
    const username = await (async () => global.db.data.users[m.sender].name || (async () => { try { const n = await conn.getName(m.sender); return typeof n === 'string' && n.trim() ? n : m.sender.split('@')[0] } catch { return m.sender.split('@')[0] } })())()

    switch (command) {
      case 'iabot': {
        if (!text) {
          return conn.reply(
            m.chat,
            `❀ Che {nombre}, soy *✿JOA-KING✿* y sé todo sobre este bot. Preguntame lo que quieras:\n\n• ¿Qué soy yo?\n• ¿Qué funciones/comandos hay?\n• ¿Quién es el owner?\n• ¿Qué son los kingcoins?\n• ¿Cómo subo de nivel?\n• ¿Qué es Mudae/Gacha?\n• ¿Cómo creo un subbot?\n• ¿Quién puede usar qué comandos?\n• ¿Cómo descargo videos?\n• ¿Cómo reporto un error?\n\nEjemplo: *${usedPrefix}iabot qué comandos hay para descargar?*.\n\n_(Respuesta gratuita y local, sin gastar nada.)_`.replace("{nombre}", username),
            m
          )
        }
        await m.react('🕒')

        const faqRes = buscarFAQ(text)
        if (faqRes) {
          await conn.sendMessage(m.chat, { text: faqRes }, { quoted: m })
          await m.react('✔️')
          break
        }

        await conn.sendMessage(m.chat, { text: respuestaGeneral(username) }, { quoted: m })
        await m.react('✔️')
        break
      }
    }
  } catch (error) {
    await m.react('✖️')
    conn.reply(m.chat, `⚠︎ Che, hubo un problema consultando sobre el bot.\\n> Usa *${usedPrefix}report* para informarlo.\\n\\n${error.message}`, m)
  }
}

handler.command = ['iabot']
handler.help = ['iabot']
handler.tags = ['tools']

export default handler
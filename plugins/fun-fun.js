import util from 'util'
import path from 'path'
import Jimp from 'jimp'

let user = a => '@' + a.split('@')[0]
let toM = a => '@' + a.split('@')[0]
let pickRandom = list => list[Math.floor(Math.random() * list.length)]
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const percentageGames = {
gay: { label: 'gay', emoji: '🏳️‍🌈' },
lesbiana: { label: 'lesbiana', emoji: '🏳️‍🌈' },
gato: { label: 'gato', emoji: '🐈' },
infiel: { label: 'infiel', emoji: '👀' },
perra: { label: 'perra', emoji: '🐶' },
tonto: { label: 'tonto', emoji: '🤪' },
puto: { label: 'puto', emoji: '✨' },
puta: { label: 'puta', emoji: '💅' },
malapersona: { label: 'mala persona', emoji: '😈' },
homofobico: { label: 'homofóbico', emoji: '🏳️‍🌈' },
'homofóbico': { label: 'homofóbico', emoji: '🏳️‍🌈' },
inteligente: { label: 'inteligente', emoji: '🧠' },
amable: { label: 'amable', emoji: '💖' },
buitre: { label: 'buitre', emoji: '🦅' },
colafacil: { label: 'cola fácil', emoji: '🪑' },
'colafácil': { label: 'cola fácil', emoji: '🪑' },
cornudo: { label: 'cornudo', emoji: '🦌' },
cornuda: { label: 'cornuda', emoji: '🦌' },
simp: { label: 'simp', emoji: '💌' },
tatiana: { label: 'Tatiana', emoji: '🎤' },
pajero: { label: 'pajero', emoji: '🛋️' },
pajera: { label: 'pajera', emoji: '🛋️' },
antipala: { label: 'antipala', emoji: '🪏' },
peronista: { label: 'peronista', emoji: '✌️' },
pernonista: { label: 'peronista', emoji: '✌️' },
manco: { label: 'manco', emoji: '🎮' },
manca: { label: 'manca', emoji: '🎮' },
rata: { label: 'rata', emoji: '🐀' },
prostituto: { label: 'prostituto', emoji: '💃' },
prostituta: { label: 'prostituta', emoji: '💃' },
vago: { label: 'vago', emoji: '😴' },
intenso: { label: 'intenso', emoji: '📣' },
chismoso: { label: 'chismoso', emoji: '🫖' },
dormilon: { label: 'dormilón', emoji: '💤' },
dormilón: { label: 'dormilón', emoji: '💤' },
fantasma: { label: 'fantasma', emoji: '👻' },
despistado: { label: 'despistado', emoji: '🧭' },
otaku: { label: 'otaku', emoji: '🍜' },
gracioso: { label: 'gracioso', emoji: '😂' },
toxico: { label: 'tóxico', emoji: '☣️' },
'tóxico': { label: 'tóxico', emoji: '☣️' },
dramatico: { label: 'dramático', emoji: '🎭' },
'dramático': { label: 'dramático', emoji: '🎭' },
}
const handler = async (m, { groupMetadata, command, conn, text, usedPrefix, args, chat }) => {
try {
let ps = [...new Set((groupMetadata?.participants || []).map(v => v.id || v.jid).filter(Boolean))]
if (command === 'gay2') {
const mentionedJid = await m.mentionedJid
const target = mentionedJid?.[0] || (m.quoted && await m.quoted.sender) || conn.parseMention(text || '')?.[0] || m.sender
const profileUrl = await conn.profilePictureUrl(target, 'image')
const image = await Jimp.read(profileUrl)
const colors = [
  [228, 3, 3],
  [255, 140, 0],
  [255, 237, 0],
  [0, 128, 38],
  [0, 77, 255],
  [117, 7, 135],
]
const stripeHeight = Math.ceil(image.bitmap.height / colors.length)
for (const [index, [red, green, blue]] of colors.entries()) {
const stripe = await Jimp.create(image.bitmap.width, Math.min(stripeHeight, image.bitmap.height - index * stripeHeight), Jimp.rgbaToInt(red, green, blue, 82))
image.composite(stripe, 0, index * stripeHeight)
}
const result = await image.getBufferAsync(Jimp.MIME_JPEG)
return conn.sendMessage(m.chat, {
image: result,
caption: `🏳️‍🌈 *Les presento a este gay:* @${target.split('@')[0]} 🏳️‍🌈`,
mentions: [target],
}, { quoted: m })
}
if (command === 'pregunta' || command === 'preguntar') {
const question = String(text || '').trim()
if (!question) return conn.reply(m.chat, `❀ Escribe una pregunta para el oráculo. Ejemplo: *${usedPrefix}pregunta ¿me va a ir bien?*`, m)
const answers = [
['Sí, de una.', '🔮 El oráculo no duda: *sí*.'],
['No.', '🙅 Las estrellas dicen que *no* por ahora.'],
['Casi seguro que sí.', '✨ Todo apunta a un *sí*.'],
['Casi seguro que no.', '🌧️ La energía viene más para *no*.'],
['Obvio que sí.', '💅 ¿Lo dudabas? *Sí, obvio*.'],
['Ni en pedo.', '🪦 Respuesta corta: *no*.'],
['Sí, pero vas a tener que poner de tu parte.', '🛠️ *Sí*, aunque no cae del cielo.'],
['No por ahora; probá más adelante.', '⏳ Hoy pinta *no*, más adelante quién sabe.'],
['Hay altas chances de que sí.', '📈 La probabilidad juega a tu favor: *sí*.'],
['Las chances son bajísimas.', '📉 No parece que vaya a pasar.'],
['100% sí.', '🚀 El universo firmó el permiso: *SÍ*.'],
['Imposible. 100% no.', '🧱 El universo puso un límite: *no*.'],
['Puede ser… el destino está viendo.', '👀 No hay veredicto todavía; puede pasar.'],
['Preguntame después de un mate.', '🧉 El oráculo está en pausa, pero tira un *capaz*.'],
['Sí, pero no se lo cuentes a nadie.', '🤫 Es un *sí* confidencial.'],
['No, y encima ya lo sabías.', '🫠 La respuesta es *no*; no me mires así.'],
['Todo indica que sí, pero no cantes victoria.', '🍀 Va para *sí*, con cautela.'],
['Mmm… yo no me confiaría.', '🎲 Está complicado; mejor no apostar todo a que sí.'],
]
const [answer, style] = pickRandom(answers)
return conn.reply(m.chat, `🔮 *CONSULTA AL ORÁCULO* 🔮\n\n❔ ${question}\n\n${style}\n💬 _${answer}_`, m)
}
if (command === 'parejadeldia') {
const participants = [...new Set(ps)]
const men = participants.filter((jid) =>
String(global.db?.data?.users?.[jid]?.genre || '').trim().toLowerCase() === 'hombre'
)
const women = participants.filter((jid) =>
String(global.db?.data?.users?.[jid]?.genre || '').trim().toLowerCase() === 'mujer'
)
if (!men.length || !women.length) {
return conn.reply(m.chat, '💞 Para elegir la parejita del día hacen falta integrantes con %misexo hombre y %misexo mujer registrados.', m)
}
const dateParts = new Intl.DateTimeFormat('en', {
timeZone: 'America/Argentina/Buenos_Aires',
year: 'numeric',
month: '2-digit',
day: '2-digit',
}).formatToParts(new Date(Date.now()))
const dateKey = `${dateParts.find((part) => part.type === 'year')?.value}-${dateParts.find((part) => part.type === 'month')?.value}-${dateParts.find((part) => part.type === 'day')?.value}`
const chatState = chat || global.db.data.chats[m.chat] || (global.db.data.chats[m.chat] = {})
let dailyPair = chatState.dailyCouple
if (dailyPair?.date !== dateKey) {
dailyPair = { date: dateKey, man: pickRandom(men), woman: pickRandom(women) }
chatState.dailyCouple = dailyPair
await global.db.write()
}
const message = `╭━━━〔 💘 *PAREJITA DEL DÍA* 💘 〕━━━╮\n\n✨ Hoy el destino escribió una historia muy bonita para:\n\n💙 ${toM(dailyPair.man)}\n             💞\n🌷 ${toM(dailyPair.woman)}\n\nHay encuentros que parecen casualidad, pero tienen toda la magia de una historia esperando comenzar. Que nunca les falten las risas, la ternura y esos pequeños detalles que hacen enorme al amor. 🥰✨\n\n💌 *¡Que viva la parejita del día!* 💌\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
return conn.sendMessage(m.chat, {
text: message,
mentions: [dailyPair.man, dailyPair.woman],
}, { quoted: m })
}
if (command == 'top') {
let cantidad = 10
let texto = text
if (!isNaN(parseInt(args[0]))) {
cantidad = Math.min(Math.max(parseInt(args[0]), 1), 10)
texto = args.slice(1).join(' ')
}
if (!texto) return conn.reply(m.chat, `❀ Por favor, ingrese un texto luego del número para hacer un Top *cantidad texto*`, m)
if (ps.length < cantidad) return conn.reply(m.chat, `ꕥ No hay suficientes miembros para hacer un Top ${cantidad}`, m)
let seleccionados = []
while (seleccionados.length < cantidad) {
let candidato = ps[Math.floor(Math.random() * ps.length)]
if (!seleccionados.includes(candidato)) seleccionados.push(candidato)
}
let x = pickRandom(['🤓','😅','😂','😳','😎','🥵','😱','🤑','🙄','💩','🍑','🤨','🥴','🔥','👇🏻','😔','👀','🌚'])
let top = `*${x} Top ${cantidad} ${texto} ${x}*\n\n`
seleccionados.forEach((u, i) => {
top += `${i + 1}. ${user(u)}\n`
})
return m.reply(top.trim(), null, { mentions: seleccionados })
}
if (command == 'sorteo') {
if (!text) return conn.reply(m.chat, `❀ Por favor ingresa lo que deseas sortear.`, m)
let cantidad = 1
let premio = text
if (!isNaN(parseInt(args[0]))) {
cantidad = Math.min(Math.max(parseInt(args[0]), 1), 10)
premio = args.slice(1).join(' ')
}
if (!premio) return conn.reply(m.chat, `❀ Por favor, ingrese un texto luego del número para hacer el sorteo.`, m)
if (ps.length < cantidad) return conn.reply(m.chat, `ꕥ No hay suficientes miembros para seleccionar ${cantidad} ganador(es).`, m)
let seleccionados = []
while (seleccionados.length < cantidad) {
let candidato = ps[Math.floor(Math.random() * ps.length)]
if (!seleccionados.includes(candidato)) seleccionados.push(candidato)
}
let mensaje = cantidad === 1 ? `✦ ＦＥＬＩＣＩＤＡＤＥＳ ✦\n\n❀ ${user(seleccionados[0])}\n○ Haz ganado  *${premio}*` : `✦ ＦＥＬＩＣＩＤＡＤＥＳ ✦\n\n` + seleccionados.map((u, i) => `${i + 1}. ${user(u)}`).join('\n') + `\n\n○ Han ganado un *${premio}*`
return await conn.sendMessage(m.chat, { text: mensaje.trim(), mentions: seleccionados }, { quoted: m, ephemeralExpiration: 24 * 60 * 100, disappearingMessagesInChat: 24 * 60 * 100 })
}
if (command == 'ship' || command == 'shippear') {
if (!text?.trim()) return conn.reply(m.chat, `❀ Escribe tu nombre y el nombre de la otra persona para calcular su amor.`, m)
let [text1, ...text2] = text.trim().split(/\s+/)
text2 = text2.join(' ')
if (!text2) return conn.reply(m.chat, `ꕥ Escribe el nombre de la segunda persona.`, m)
let love = `❤️ *${text1}* tu oportunidad de enamorarte de *${text2}* es de ${Math.floor(Math.random() * 100)}% 👩🏻‍❤️‍👨🏻`
return m.reply(love, null, { mentions: conn.parseMention(love) })
}
if (command == 'afk') {
const user = global.db.data.users[m.sender]
user.afk = Date.now()
user.afkReason = text
return await conn.reply(m.chat, `❀ *El Usuario ${await conn.getName(m.sender)} Estará AFK*\n○ *Motivo${text ? ': ' + text : ': Sin Especificar!'}*`, m)
}
if (command == 'personalidad') {
let mentionedJid = m.mentionedJid || []
let quotedSender = m.quoted ? await m.quoted.sender : null
let userId = mentionedJid[0] || quotedSender || conn.parseMention(text || '')?.[0] || text?.trim()
if (!userId) return conn.reply(m.chat, `❀ Por favor, ingrese el nombre de alguna persona.`, m)
let nombre = userId
if (userId.includes('@')) {
nombre = global.db?.data?.users?.[userId]?.name
if (!nombre) {
try {
nombre = await conn.getName(userId)
} catch {
nombre = userId.split('@')[0]
}
}
}
let userName = `*${nombre || userId}*`
let personalidad = `> • Nombre » ${userName}\n> • Buena Moral » ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Mala Moral : ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Tipo de persona » ${pickRandom(['De buen corazón','Arrogante','Tacaño','Generoso','Humilde','Tímido','Cobarde','Entrometido','Cristal','No binarie XD', 'Pendejo'])}\n> • Siempre » ${pickRandom(['Pesado','De malas','Distraido','De molestoso','Chismoso','Pasa jalandosela','De compras','Viendo anime','Chatea en WhatsApp porque esta soltero','Acostado bueno para nada','De mujeriego','En el celular'])}\n> • Inteligencia » ${pickRandom(['9%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Pendejo(a) » ${pickRandom(['9%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Morosidad » ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Coraje » ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Miedo » ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Fama » ${pickRandom(['6%','12%','20%','27%','35%','41%','49%','54%','60%','66%','73%','78%','84%','92%','93%','94%','96%','98,3%','99,7%','99,9%','1%','2,9%','0%','0,4%'])}\n> • Género » ${pickRandom(['Hombre', 'Mujer', 'Homosexual', 'Bisexual', 'Pansexual', 'Feminista', 'Heterosexual', 'Macho alfa', 'Mujerzona', 'Marimacha', 'Palosexual', 'PlayStationSexual', 'Sr. Manuela', 'Pollosexual'])}`
return await conn.reply(m.chat, personalidad, m)
}
if (command == 'formarpareja') {
let R = Math.random
let Fl = Math.floor
const frases = ["Esta pareja está destinada a estar junta 💙", "Dos pequeños tortolitos enamorados ✨", "Ya hasta familia deberían tener 🤱🧑‍🍼", "Se casaron en secreto 💍", "Están de luna de miel ✨🥵😍❤️", "Son inseparables como el café y la arepa ☕🥙", "Su química es de otro planeta 🌌", "Pareja explosiva que enciende el grupo 🔥", "Amor que ni el tiempo puede borrar ⏳❤️", "Se miran y el mundo desaparece 🌍💫", "Romance digno de novela 📖💘", "Pareja que todos envidian 😍👀", "Son el alma del grupo juntos 🎉💑", "Amor que nació en los stickers 💬💞", "Pareja que comparte hasta los datos móviles 📱❤️", "Su conexión es más fuerte que el WiFi 📶💘", "Pareja que se entiende con solo emojis 😘😎", "Amor que ni el bot puede ignorar 🤖💓", "Pareja que merece su propio comando 🧾💑", "Son tan dulces que suben el azúcar 🍭💕"]
let cantidad = Math.min(Math.max(parseInt(args[0]) || 1, 1), 10)
let ps = groupMetadata.participants.map(v => v.id)
if (ps.length < cantidad * 2) return m.reply(`ꕥ No hay miembros suficientes para formar ${cantidad} pareja${cantidad === 1 ? '' : 's'}`)
let usados = new Set()
let parejas = []
let menciones = []
for (let i = 0; i < cantidad; i++) {
let a, b
do a = ps[Fl(R() * ps.length)]
while (usados.has(a))
usados.add(a)
do b = ps[Fl(R() * ps.length)]
while (b === a || usados.has(b))
usados.add(b)
parejas.push({a, b})
menciones.push(a, b)
}
let texto = cantidad === 1 ? `*😍 _La mejor pareja del grupo_ 😍*\n\n` : `*😍 _Las ${cantidad} mejores parejas del grupo_ 😍*\n\n`
parejas.forEach((p, i) => {
texto += `${i + 1}.- ${toM(p.a)} y ${toM(p.b)}\n${frases[i % frases.length]}\n\n`
})
return m.reply(texto.trim(), null, { mentions: menciones })
}
const formationCommands = {
formarpnormal: 'formarpnormal',
formarpgay: 'formarpgay',
formarplesbi: 'formarplesbi',
formargay: 'formarpgay',
formarlesbi: 'formarplesbi',
}
if (formationCommands[command]) {
const formation = formationCommands[command]
const genderByCommand = {
formarpnormal: ['hombre', 'mujer'],
formarpgay: ['hombre', 'hombre'],
formarplesbi: ['mujer', 'mujer'],
}
const [firstGender, secondGender] = genderByCommand[formation]
const hasRequestedCount = Array.isArray(args) && args.length > 0
const requestedCount = hasRequestedCount ? Number(args[0]) : 1
if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) {
return conn.reply(m.chat, `❀ La cantidad debe ser un número entero mayor que cero.`, m)
}
const pools = {
hombre: ps.filter((jid) => String(global.db?.data?.users?.[jid]?.genre || '').trim().toLowerCase() === 'hombre'),
mujer: ps.filter((jid) => String(global.db?.data?.users?.[jid]?.genre || '').trim().toLowerCase() === 'mujer'),
}
const availablePairs = firstGender === secondGender
? Math.floor(pools[firstGender].length / 2)
: Math.min(pools[firstGender].length, pools[secondGender].length)
const count = Math.min(requestedCount, availablePairs)
if (count === 0) {
return conn.reply(
m.chat,
`ꕥ Todavía no hay suficientes personas con el sexo registrado para formar una pareja. Usen %misexo hombre o %misexo mujer y probá de nuevo.`,
m
)
}
const pairs = []
const mentions = []
const used = new Set()
for (let index = 0; index < count; index++) {
  const firstPool = pools[firstGender].filter((jid) => !used.has(jid))
  const first = pickRandom(firstPool)
  used.add(first)
  const secondPool = pools[secondGender].filter((jid) => jid !== first && !used.has(jid))
  const second = pickRandom(secondPool)
  used.add(second)
  pairs.push([first, second])
  mentions.push(first, second)
}
const titles = {
  formarpnormal: '😍 _La mejor pareja del grupo_ 😍',
  formarpgay: '🏳️‍🌈 _La mejor pareja gay del grupo_ 🏳️‍🌈',
  formarplesbi: '🏳️‍🌈 _La mejor pareja lesbiana del grupo_ 🏳️‍🌈',
}
const pluralTitles = {
  formarpnormal: `😍 _Las ${count} mejores parejas del grupo_ 😍`,
  formarpgay: `🏳️‍🌈 _Las ${count} mejores parejas gay del grupo_ 🏳️‍🌈`,
  formarplesbi: `🏳️‍🌈 _Las ${count} mejores parejas lesbianas del grupo_ 🏳️‍🌈`,
}
const lines = pairs.map(([first, second], index) =>
  `${index + 1}.- ${toM(first)} y ${toM(second)}\n${pickRandom(['Esta pareja está destinada a estar junta 💙', 'Dos pequeños corazones que encontraron su lugar 💞', 'El destino ya los tenía en la misma historia ✨', 'La química del grupo hizo lo suyo 💘', 'Una dupla que merece su propia novela 📺'])}`
)
return conn.sendMessage(m.chat, {
  text: `${count === 1 ? titles[formation] : pluralTitles[formation]}\n\n${lines.join('\n\n')}${count < requestedCount ? `\n\n> Se formaron ${count}: no hay más personas disponibles con el sexo registrado.` : ''}`,
  mentions,
}, { quoted: m })
}
if (Object.hasOwn(percentageGames, command)) {
const mentionedJid = await m.mentionedJid
const target = mentionedJid?.[0] || (m.quoted && await m.quoted.sender) || conn.parseMention(text || '')?.[0] || m.sender
const percentage = Math.floor(Math.random() * 100) + 1
const { label, emoji } = percentageGames[command]
const progress = `${'🟩'.repeat(Math.round(percentage / 10))}${'⬜'.repeat(10 - Math.round(percentage / 10))}`
const result = `╭━━━〔 ${emoji} *TEST DE ${label.toLocaleUpperCase('es')}* 〕━━━╮\n\n👤 Resultado para: @${target.split('@')[0]}\n\n${progress} *${percentage}%*\n\n╰━━━━━━━━━━━━━━━━━━╯`
return conn.sendMessage(m.chat, { text: result, mentions: [target] }, { quoted: m })
}
if (['doxear','doxxeo','doxeo'].includes(command)) {
let mentionedJid = await m.mentionedJid
let userId = mentionedJid && mentionedJid.length ? mentionedJid[0] : m.quoted && await m.quoted.sender ? await m.quoted.sender : null
let userName = await (async () => global.db.data.users[userId].name || (async () => { try { const n = await conn.getName(userId); return typeof n === 'string' && n.trim() ? n : userId.split('@')[0] } catch { return userId.split('@')[0] } })())()
if (!userId) return conn.reply(m.chat, `❀ Por favor, ingrese el tag de algún usuario o responda a un mensaje.`, m)
let start = `ꕥ *Iniciando doxeo*...`
let boost = `*${pickRandom(['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20'])}%*`
let boost2 = `*${pickRandom(['21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40'])}%*`
let boost3 = `*${pickRandom(['41','42','43','44','45','46','47','48','49','50','51','52','53','54','55','56','57','58','59','60'])}%*`
let boost4 = `*${pickRandom(['61','62','63','64','65','66','67','68','69','70','71','72','73','74','75','76','77','78','79','80'])}%*`
let boost5 = `*${pickRandom(['81','82','83','84','85','86','87','88','89','90','91','92','93','94','95','96','97','98','99','100'])}%*`
const { key } = await conn.sendMessage(m.chat, { text: `${start}` }, { quoted: m })
await delay(1000)
await conn.sendMessage(m.chat, { text: `${boost}`, edit: key })
await delay(1000)
await conn.sendMessage(m.chat, { text: `${boost2}`, edit: key })
await delay(1000)
await conn.sendMessage(m.chat, { text: `${boost3}`, edit: key })
await delay(1000)
await conn.sendMessage(m.chat, { text: `${boost4}`, edit: key })
await delay(1000)
await conn.sendMessage(m.chat, { text: `${boost5}`, edit: key })
let doxeo = `❀ *Persona doxeada*\n\n✦ ${new Date().toLocaleDateString()}\n✧ ${new Date().toLocaleTimeString()}\n\n✰ Resultados:\n\n*Nombre:* ${userName}\n*Ip:* 92.28.211.234\n*N:* 43 7462\n*W:* 12.4893\n*SS NUMBER:* 6979191519182016\n*IPV6:* fe80::5dcd::ef69::fb22::d9888%12\n*UPNP:* Enabled\n*DMZ:* 10.112.42.15\n*MAC:* 5A:78:3E:7E:00\n*ISP:* Ucom universal \n*DNS:* 8.8.8.8\n*ALT DNS:* 1.1.1.1 \n*DNS SUFFIX:* Dlink\n*WAN:* 100.23.10.15\n*WAN TYPE:* private nat\n*GATEWAY:* 192.168.0.1\n*SUBNET MASK:* 255.255.0.255\n*UDP OPEN PORTS:* 8080, 80\n*TCP OPEN PORTS:* 443\n*ROUTER VENDEDOR:* ERICCSON\n*DEVICE VENDEDOR:* WIN32-X\n*CONNECTION TYPE:* TPLINK COMPANY\n*ICMPHOPS:* 192.168.0.1, 192.168.1.1, 100.73.43.4\nhost-132.12.32.167.ucom.com\nhost-132.12.111.ucom.com\n36.134.67.189, 216.239.78.11\nSof02s32inf14.1e100.net\n*HTTP:* 192.168.3.1:433-->92.28.211.234:80\n*Http:* 192.168.625-->92.28.211.455:80\n*Http:* 192.168.817-->92.28.211.8:971\n*Upd:* 192.168.452-->92.28.211:7265288\n*Tcp:* 192.168.682-->92.28.211:62227.7\n*Tcp:* 192.168.725-->92.28.211:67wu2\n*Tcp:* 192.168.629-->92.28.211.167:8615\n*EXTERNAL MAC:* 6U:77:89:ER:O4\n*MODEM JUMPS:* 64`
await conn.sendMessage(m.chat, { text: doxeo, edit: key, mentions: conn.parseMention(doxeo) }, { quoted: m })
}} catch (error) {
await m.react('✖️')
conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['top', 'sorteo', 'ship', 'shippear', 'pregunta <pregunta>', 'preguntar <pregunta>', 'parejadeldia', 'afk', 'personalidad', 'formarpareja', 'formarpnormal [cantidad]', 'formarpgay [cantidad]', 'formarplesbi [cantidad]', ...Object.keys(percentageGames), 'gay2 [@usuario]', 'doxear', 'doxeo', 'doxxeo']
handler.tags = ['fun']
handler.command = ['top', 'sorteo', 'ship', 'shippear', 'pregunta', 'preguntar', 'parejadeldia', 'afk', 'personalidad', 'formarpareja', 'formarpnormal', 'formarpgay', 'formarplesbi', 'formargay', 'formarlesbi', ...Object.keys(percentageGames), 'gay2', 'doxear', 'doxeo', 'doxxeo']
handler.group = true

export default handler

const handler = async (m, { conn, text, usedPrefix, command, args, isROwner, isOwner, isAdmin, isGroup, participants = [] }) => {
const senderIds = [m.sender, m.key?.participant, m.key?.senderPn, m.key?.remoteJidAlt]
const senderDigits = new Set(senderIds.filter(Boolean).map(value => String(value).replace(/\D/g, "")).filter(Boolean))
const senderParticipant = participants.find(participant =>
	[participant.id, participant.jid, participant.lid, participant.phoneNumber]
		.some(value => value && senderDigits.has(String(value).replace(/\D/g, "")))
)
const participantIsAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin' || senderParticipant?.isAdmin || senderParticipant?.isSuperAdmin
const groupModerator = Boolean(isGroup && (isAdmin || participantIsAdmin))
const canManageBans = isROwner || isOwner || groupModerator
if (!canManageBans && ['ban', 'unban'].includes(command)) {
return conn.reply(m.chat, 'Solo el propietario del bot o un administrador del grupo puede usar este comando.', m)
}
if (!isROwner && !groupModerator && !(isOwner && ['ban', 'unban'].includes(command))) return
const bot = conn.user.jid.split('@')[0]
const users = global.db.data.users
const chats = global.db.data.chats
function no(number) { return number.replace(/\s/g, '').replace(/([@+-])/g, '') }
async function relatedJids(who) {
const jids = new Set([who])
if (!m.isGroup) return jids
const metadata = await conn.groupMetadata(m.chat).catch(() => null)
const participants = metadata?.participants || []
const target = String(who).trim().toLowerCase()
const participant = participants.find(entry => [entry.id, entry.jid, entry.lid, entry.phoneNumber]
	.filter(value => typeof value === 'string' && value)
	.some(value => value.trim().toLowerCase() === target))
if (!participant) return jids
for (const value of [participant.id, participant.jid, participant.lid, participant.phoneNumber]) {
if (typeof value !== 'string' || !value.trim()) continue
const jid = value.includes('@') ? value.trim() : /^\+?\d+$/.test(value.trim()) ? `${value.replace(/\D/g, '')}@s.whatsapp.net` : ''
if (jid) jids.add(jid)
}
return jids
}
try {
let mentionedJid = await m.mentionedJid
let who = mentionedJid[0] ? mentionedJid[0] : m.quoted ? await m.quoted.sender : text ? no(text.split(' ')[0]) + '@s.whatsapp.net' : false
switch (command) {
case 'ban':
case 'banned': {
if (command === 'banned' && !isROwner) return conn.reply(m.chat, 'Solo el propietario del bot puede usar este comando.', m)
if (!who) return conn.reply(m.chat, '❀ Por favor, etiqueta, cita o escribe el número del usuario que quieres banear del Bot.', m)
var reason = 'Sin Especificar'
if (mentionedJid && mentionedJid[0]) {
var mentionIdx = args.findIndex(arg => arg.startsWith('@'))
var reasonArgs = args.slice(mentionIdx + 1).join(' ')
if (reasonArgs.trim()) reason = reasonArgs.trim()
} else if (m.quoted) {
if (args.length) reason = args.join(' ')
} else if (text) {
var parts = text.trim().split(' ')
if (parts.length > 1) reason = parts.slice(1).join(' ')
}
const targetJids = await relatedJids(who)
if (targetJids.has(conn.user.jid) || targetJids.has(conn.user.lid)) return conn.reply(m.chat, `ꕥ @${bot} no puede ser baneado.`, m)
if (global.owner.some(number => targetJids.has(`${no(String(number))}@s.whatsapp.net`))) {
return conn.reply(m.chat, `ꕥ No puedo banear al propietario @${who.split('@')[0]} de *@${bot}*.`, m, { mentions: [who, bot] })
}
if ([...targetJids].some(jid => users[jid]?.banned)) return conn.reply(m.chat, `ꕥ @${who.split('@')[0]} ya no puede usar los comandos del bot.`, m, { mentions: [who] })
for (const jid of targetJids) {
if (!users[jid]) users[jid] = {}
users[jid].banned = true
users[jid].bannedReason = reason
}
await global.db.write()
await m.react('🕒')
var nameBan = await conn.getName(who)
await m.react('✔️')
await conn.reply(m.chat, `❀ ${nameBan} ya no podrá usar los comandos del bot.\n> Razón: ${reason}`, m, { mentions: [who] })
break
}
case 'unban': {
if (!who) return conn.reply(m.chat, '❀ Por favor, etiqueta o coloca el número del usuario que quieres desbanear del Bot.', m)
const targetJids = await relatedJids(who)
if (![...targetJids].some(jid => users[jid]?.banned)) return conn.reply(m.chat, `ꕥ @${who.split('@')[0]} no está baneado.`, m, { mentions: [who] })
await m.react('🕒')
for (const jid of targetJids) {
if (!users[jid]) continue
users[jid].banned = false
users[jid].bannedReason = ''
}
await global.db.write()
await m.react('✔️')
let nameUnban = await conn.getName(who)
await conn.reply(m.chat, `❀ ${nameUnban} ya puede volver a usar los comandos del bot.`, m, { mentions: [who] })
break
}
case 'block': {
if (!who) return conn.reply(m.chat, '❀ Por favor, menciona al usuario que quieres bloquear del número de la Bot.', m)
await m.react('🕒')
await conn.updateBlockStatus(who, 'block')
await m.react('✔️')
conn.reply(m.chat, `❀ Bloqueado correctamente a @${who.split('@')[0]}`, m, { mentions: [who] })
break
}
case 'unblock': {
if (!who) return conn.reply(m.chat, '❀ Por favor, menciona al usuario que quieres desbloquear del número de la Bot.', m)
await m.react('🕒')
await conn.updateBlockStatus(who, 'unblock')
await m.react('✔️')
conn.reply(m.chat, `❀ Desbloqueado correctamente a @${who.split('@')[0]}`, m, { mentions: [who] })
break
}
case 'banlist': {
await m.react('🕒')
const bannedUsers = Object.entries(users).filter(([_, data]) => data.banned)
const bannedChats = Object.entries(chats).filter(([_, data]) => data.isBanned)
const usersList = bannedUsers.map(([jid]) => {
const num = jid.split('@')[0]
return `▢ @${num}`
})
const chatsList = bannedChats.map(([jid]) => {
return `▢ ${jid}`
})
const bannedText = `✦ Usuarios Baneados • Total: ${bannedUsers.length}\n${usersList.join('\n')}\n\n✧ Chats Baneados • Total: ${bannedChats.length}\n${chatsList.join('\n')}`.trim()
const mentions = [...bannedUsers.map(([jid]) => jid), ...bannedChats.map(([jid]) => jid)]
await m.react('✔️')
conn.reply(m.chat, bannedText, m, { mentions })
break
}
case 'blocklist': {
await m.react('🕒')
const blocklist = await conn.fetchBlocklist()
let listText = `≡ *Lista de bloqueados*\n\n*Total :* ${blocklist.length}\n\n┌─⊷\n`
for (const i of blocklist) {
let num = i.split('@')[0]
listText += `▢ @${num}\n`
}
listText += '└───────────'
await m.react('✔️')
conn.reply(m.chat, listText, m, { mentions: blocklist })
break
}}} catch (e) {
await m.react('✖️')
return m.reply(`⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n` + (e.message || e))
}}

handler.help = ['ban', 'unban', 'banned', 'block', 'unblock', 'banlist', 'blocklist']
handler.tags = ['mods']
handler.command = ['ban', 'banned', 'unban', 'block', 'unblock', 'banlist', 'blocklist']

export default handler

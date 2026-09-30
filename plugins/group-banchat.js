let handler = async (m, { conn, usedPrefix, command, args, chat, isROwner, isAdmin, participants }) => {
const isAuthorized = isROwner || (m.isGroup && isAdmin)
const directAction = ['on', 'off'].includes(command.toLowerCase())
const action = directAction ? command.toLowerCase() : args[0]?.toLowerCase()
const target = directAction ? args[0]?.toLowerCase() : 'bot'

if (!isAuthorized) {
if (chat.isBanned) return
return conn.reply(m.chat, 'Solo el owner puede usar este comando en privado; en grupos también pueden hacerlo los administradores.', m)
}

const mentionedJid = await m.mentionedJid
const mentionedBotJid = (Array.isArray(mentionedJid) ? mentionedJid : [mentionedJid]).find(Boolean)
if (mentionedBotJid && ['on', 'off', 'enable', 'disable'].includes(action)) {
if (!m.isGroup) return conn.reply(m.chat, 'Solo puedes cambiar el estado de un bot mencionado dentro de un grupo.', m)

const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/g, '').toLowerCase()
const botConnections = [...new Set([...(Array.isArray(global.conns) ? global.conns : []), global.conn, conn].filter(Boolean))]
const targetBot = botConnections.find((bot) => {
const botJids = [bot.user?.jid, bot.user?.id, bot.user?.lid].filter(Boolean).map(normalizeJid)
return botJids.includes(normalizeJid(mentionedBotJid)) && botJids.length && (bot === global.conn || bot.ws?.socket?.readyState !== 3)
})
if (!targetBot) return conn.reply(m.chat, 'La persona mencionada no es un bot conectado.', m)

const targetJids = [targetBot.user?.jid, targetBot.user?.id, targetBot.user?.lid].filter(Boolean).map(normalizeJid)
const isInGroup = (Array.isArray(participants) ? participants : []).some((participant) =>
[participant.id, participant.jid, participant.lid].filter(Boolean).some((jid) => targetJids.includes(normalizeJid(jid)))
)
if (!isInGroup) return conn.reply(m.chat, 'El bot mencionado no está en este grupo.', m)

const targetBotJid = targetBot.user?.jid || targetBot.user?.id
const targetChatKey = `${targetBotJid}::${m.chat}`
const chats = global.db.data.chats
const existingTargetChat = chats[targetChatKey]
const fallbackChat = chats[m.chat]
const targetChat = {
...(existingTargetChat && typeof existingTargetChat === 'object' ? existingTargetChat : fallbackChat && typeof fallbackChat === 'object' ? fallbackChat : {}),
isBanned: ['off', 'disable'].includes(action)
}
chats[targetChatKey] = targetChat
await global.db.write()

const recipientNumber = String(mentionedBotJid).split('@')[0].split(':')[0]
const status = targetChat.isBanned ? 'desactivado' : 'activado'
return conn.reply(m.chat, `❀ Has *${status}* a @${recipientNumber} solo en este grupo.`, m, { mentions: [mentionedBotJid] })
}

if (directAction && target !== 'bot') {
if (target) return
return conn.reply(m.chat, `Usa *${usedPrefix}off bot* o *${usedPrefix}on bot*.`, m)
}

if (!action) {
const estado = chat.isBanned ? '✗ Desactivado' : '✓ Activado'
const info = `「✦」Usa *${usedPrefix}off bot* o *${usedPrefix}on bot* para cambiar el estado de ${botname}.\n\n✧ Estado actual » *${estado}*`
return conn.reply(m.chat, info, m)
}

if (['off', 'disable'].includes(action)) {
if (chat.isBanned) return conn.reply(m.chat, `《✦》${botname} ya estaba desactivado.`, m)
chat.isBanned = true
return conn.reply(m.chat, `❀ Has *desactivado* a ${botname} en este chat.`, m)
}

if (['on', 'enable'].includes(action)) {
if (!chat.isBanned) return conn.reply(m.chat, `《✦》${botname} ya estaba activado.`, m)
chat.isBanned = false
return conn.reply(m.chat, `❀ Has *activado* a ${botname} en este chat.`, m)
}

return conn.reply(m.chat, `Usa *${usedPrefix}off bot* o *${usedPrefix}on bot*.`, m)
}

handler.help = ['off bot', 'on bot', 'off @bot', 'on @bot']
handler.tags = ['grupo']
handler.command = ['bot', 'off', 'on']

export default handler
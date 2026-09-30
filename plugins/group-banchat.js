let handler = async (m, { conn, usedPrefix, command, args, chat, isROwner, isAdmin }) => {
const isAuthorized = isROwner || (m.isGroup && isAdmin)
const directAction = ['on', 'off'].includes(command.toLowerCase())
const action = directAction ? command.toLowerCase() : args[0]?.toLowerCase()
const target = directAction ? args[0]?.toLowerCase() : 'bot'

if (!isAuthorized) {
if (chat.isBanned) return
return conn.reply(m.chat, 'Solo el owner puede usar este comando en privado; en grupos también pueden hacerlo los administradores.', m)
}

if (!action || (directAction && target !== 'bot')) {
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

handler.help = ['off bot', 'on bot']
handler.tags = ['grupo']
handler.command = ['bot', 'off', 'on']

export default handler
const handler = async (m, {conn, participants, groupMetadata, args}) => {
const chatConfig = global.db?.data?.chats?.[m.chat] || {}
const primaryBot = chatConfig.primaryBot
if (primaryBot && conn.user.jid !== primaryBot) throw !1

const normalizeMentionJid = (value) => {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const candidate = raw.includes('@') ? raw : `${raw.replace(/\D+/g, '')}@s.whatsapp.net`
  const decoded = String(conn?.decodeJid ? conn.decodeJid(candidate) : candidate).trim()
  if (!decoded || !decoded.includes('@')) return null
  if (decoded.endsWith('@lid')) return `${decoded.split('@')[0]}@s.whatsapp.net`
  if (decoded.endsWith('@s.whatsapp.net') || decoded.endsWith('@g.us')) return decoded
  return `${decoded.replace(/\D+/g, '')}@s.whatsapp.net`
}

const sourceParticipants = (participants && participants.length ? participants : groupMetadata?.participants || [])
const groupAdmins = [...new Set(sourceParticipants
  .filter((p) => p?.admin)
  .map((p) => normalizeMentionJid(p?.jid || p?.id || p?.lid))
  .filter(Boolean))]
const owner = normalizeMentionJid(groupMetadata?.owner || groupAdmins.find((jid) => jid.endsWith('@s.whatsapp.net')) || m.chat.split`-`[0] + '@s.whatsapp.net')
const mentionList = [...new Set([...groupAdmins, owner].filter(Boolean))]
const listAdmin = mentionList.map((jid) => `● @${jid.split('@')[0]}`).join('\n')
const pesan = args.join` `
const oi = `» ${pesan}`
const text = `『✦』Admins del grupo:  \n  \n${listAdmin}\n\n❍ Mensaje ${oi || 'Sin especificar'}`

await conn.sendMessage(m.chat, {
  text,
  mentions: mentionList,
  contextInfo: { mentionedJid: mentionList }
}, { quoted: m })
}

handler.help = ['admins']
handler.tags = ['grupo']
handler.customPrefix = /^(?:@|%|#)?(?:admins|administradores|dmins)/i
handler.command = ['admins', 'administradores', 'dmins']
handler.group = true

export default handler
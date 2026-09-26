import { mentionText, participantMentionJid } from '../lib/group-mentions.js'

const handler = async (m, {conn, participants, groupMetadata, args}) => {
const chatConfig = global.db?.data?.chats?.[m.chat] || {}
const primaryBot = chatConfig.primaryBot
if (primaryBot && conn.user.jid !== primaryBot) throw !1

const sourceParticipants = (participants && participants.length ? participants : groupMetadata?.participants || [])
const groupAdmins = [...new Set(sourceParticipants
  .filter((p) => p?.admin || p?.isAdmin || p?.isSuperAdmin)
  .map((p) => participantMentionJid(p, groupMetadata?.addressingMode))
  .filter(Boolean))]
const ownerIds = [groupMetadata?.owner, groupMetadata?.ownerPn].filter(Boolean)
const ownerParticipant = sourceParticipants.find((participant) =>
  [participant.id, participant.jid, participant.lid, participant.phoneNumber]
    .some((id) => ownerIds.includes(id)))
const owner = participantMentionJid(ownerParticipant, groupMetadata?.addressingMode)
  || participantMentionJid({ id: groupMetadata?.owner, phoneNumber: groupMetadata?.ownerPn }, groupMetadata?.addressingMode)
  || groupAdmins[0]
const mentionList = [...new Set([...groupAdmins, owner].filter(Boolean))]
const listAdmin = mentionList.map((jid) => `● ${mentionText(jid)}`).join('\n')
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
handler.customPrefix = /^(?:@|%|&|#)?(?:admins|administradores|dmins)/i
handler.command = ['admins', 'administradores', 'dmins']
handler.group = true

export default handler
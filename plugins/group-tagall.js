import { mentionText, participantMentionJid } from '../lib/group-mentions.js'

const handler = async (m, { isOwner, isAdmin, conn, text, participants, groupMetadata, args, command }) => {
  const rawMembers = (participants && participants.length ? participants : groupMetadata?.participants || [])
  const members = [...new Set(rawMembers
    .map((member) => participantMentionJid(member, groupMetadata?.addressingMode))
    .filter(Boolean))]

  if (!members.length) {
    if (typeof conn?.reply === 'function') return conn.reply(m.chat, 'No pude obtener la lista de participantes del grupo.', m)
    return
  }

  const pesan = ((args || []).join(' ') || text || 'hola').trim()
  const oi = `*» INFO :* ${pesan || 'hola'}`
  const mentions = members.map(mentionText).join('\n')
  const botLabel = globalThis.botname || globalThis.botName || 'BOT'
  const versionLabel = globalThis.vs || globalThis.version || 'v1'
  const teks = `*!  MENCION GENERAL  !*\n  *PARA ${members.length} MIEMBROS* 🗣️\n\n ${oi}\n\n╭  ┄ 𝅄 ۪꒰ \`⡞᪲=͟͟͞${botLabel}≼᳞ׄ\` ꒱ ۟ 𝅄 ┄\n${mentions}\n╰⸼ ┄ ┄ ┄ ─  ꒰  ׅ୭ *${versionLabel}* ୧ ׅ ꒱  ┄  ─ ┄⸼`

  await conn.sendMessage(m.chat, {
    text: teks,
    mentions: members,
    contextInfo: { mentionedJid: members }
  }, { quoted: m })
}

handler.help = ['todos']
handler.tags = ['group']
handler.command = ['todos', 'invocar', 'tagall']
handler.customPrefix = /^(?:@|%|&|#)?(?:tagall|todos|invocar)/i
handler.group = true

export default handler
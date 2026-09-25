const handler = async (m, { isOwner, isAdmin, conn, text, participants, groupMetadata, args, command }) => {
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

  const rawMembers = (participants && participants.length ? participants : groupMetadata?.participants || [])
  const members = [...new Set(rawMembers
    .map((member) => normalizeMentionJid(member?.jid || member?.id || member?.lid || member))
    .filter((jid) => !!jid && /@s\.whatsapp\.net$/.test(String(jid))))]

  if (!members.length) {
    if (typeof conn?.reply === 'function') return conn.reply(m.chat, 'No pude obtener la lista de participantes del grupo.', m)
    return
  }

  const pesan = ((args || []).join(' ') || text || 'hola').trim()
  const oi = `*» INFO :* ${pesan || 'hola'}`
  const mentionText = members.map((jid) => `@${jid.split('@')[0]}`).join('\n')
  const botLabel = globalThis.botname || globalThis.botName || 'BOT'
  const versionLabel = globalThis.vs || globalThis.version || 'v1'
  const teks = `*!  MENCION GENERAL  !*\n  *PARA ${members.length} MIEMBROS* 🗣️\n\n ${oi}\n\n╭  ┄ 𝅄 ۪꒰ \`⡞᪲=͟͟͞${botLabel}≼᳞ׄ\` ꒱ ۟ 𝅄 ┄\n${mentionText}\n╰⸼ ┄ ┄ ┄ ─  ꒰  ׅ୭ *${versionLabel}* ୧ ׅ ꒱  ┄  ─ ┄⸼`

  await conn.sendMessage(m.chat, {
    text: teks,
    mentions: members,
    contextInfo: { mentionedJid: members }
  }, { quoted: m })
}

handler.help = ['todos']
handler.tags = ['group']
handler.command = ['todos', 'invocar', 'tagall']
handler.customPrefix = /^(?:@|%)?(?:tagall|todos|invocar)/i
handler.group = true

export default handler
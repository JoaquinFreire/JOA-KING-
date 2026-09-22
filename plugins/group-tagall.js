const handler = async (m, { isOwner, isAdmin, conn, text, participants, args, command }) => {
  const normalizeMentionJid = (value) => {
    if (!value) return null
    const raw = String(value).trim()
    if (!raw) return null

    const candidate = raw.includes('@') ? raw : `${raw.replace(/\D+/g, '')}@s.whatsapp.net`
    const decoded = String(conn?.decodeJid ? conn.decodeJid(candidate) : candidate).trim()

    if (!decoded.includes('@')) return `${decoded.replace(/\D+/g, '')}@s.whatsapp.net`
    if (decoded.endsWith('@lid')) return `${decoded.split('@')[0]}@s.whatsapp.net`
    return decoded
  }

  const members = [...new Set((participants || [])
    .map((member) => normalizeMentionJid(member?.jid || member?.id || member?.lid || member))
    .filter((jid) => !!jid && /@s\.whatsapp\.net$|@g\.us$/.test(String(jid))))]

  if (!members.length) {
    if (typeof conn?.reply === 'function') return conn.reply(m.chat, 'No pude obtener la lista de participantes del grupo.', m)
    return
  }

  const pesan = ((args || []).join(' ') || text || 'hola').trim()
  const oi = `*» INFO :* ${pesan || 'hola'}`
  let teks = `*!  MENCION GENERAL  !*\n  *PARA ${members.length} MIEMBROS* 🗣️\n\n ${oi}\n\n╭  ┄ 𝅄 ۪꒰ \`⡞᪲=͟͟͞${botname}≼᳞ׄ\` ꒱ ۟ 𝅄 ┄\n`
  for (const member of members) {
    teks += `┊ꕥ @${member.split('@')[0]}\n`
  }
  teks += `╰⸼ ┄ ┄ ┄ ─  ꒰  ׅ୭ *${vs}* ୧ ׅ ꒱  ┄  ─ ┄⸼`
  await conn.sendMessage(m.chat, { text: teks, mentions: members }, { quoted: m })
}

handler.help = ['todos']
handler.tags = ['group']
handler.command = ['todos', 'invocar', 'tagall']
handler.customPrefix = /^(?:@|%)?(?:tagall|todos|invocar)/i
handler.group = true

export default handler
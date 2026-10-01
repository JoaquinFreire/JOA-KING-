const shuffle = (values) => {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/g, '').toLowerCase()

const handler = async (m, { conn, command, text, participants }) => {
  if (!m.isGroup) return conn.reply(m.chat, 'Este top solo funciona dentro de un grupo.', m)

  const membersByJid = new Map()
  for (const participant of Array.isArray(participants) ? participants : []) {
    const ids = [...new Set([participant.id, participant.jid, participant.lid]
      .filter((jid) => typeof jid === 'string' && jid))]
    if (!ids.length) continue
    const jid = ids[0]
    const key = normalizeJid(jid)
    if (!membersByJid.has(key)) membersByJid.set(key, { jid, ids })
  }
  let members = [...membersByJid.values()]

  if (command === 'topmujeres' || command === 'tophombres') {
    const wantedGender = command === 'topmujeres' ? 'mujer' : 'hombre'
    const usersByJid = new Map(Object.entries(global.db?.data?.users || {})
      .map(([jid, user]) => [normalizeJid(jid), user]))
    members = members.filter(({ ids }) => ids.some((jid) =>
      String(usersByJid.get(normalizeJid(jid))?.genre || '').trim().toLowerCase() === wantedGender
    ))

    if (!members.length) {
      const label = wantedGender === 'mujer' ? 'mujeres' : 'hombres'
      return conn.reply(m.chat, `Todavía nadie se registró como ${label}. Usa %misexo ${wantedGender} para aparecer en este top.`, m)
    }
  }

  if (!members.length) return conn.reply(m.chat, 'No encontré integrantes para armar el top.', m)

  const isTopGays = command === 'topgays'
  const isGenderTop = command === 'topmujeres' || command === 'tophombres'
  const limit = isTopGays ? 5 : command === 'topt' || isGenderTop ? members.length : Number(command.slice(3))
  const selected = shuffle(members).slice(0, limit)
  const topic = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 100) || 'integrantes del grupo'
  const title = isTopGays ? '🏳️‍🌈 TOP DEL ORGULLO 🏳️‍🌈' : command === 'topmujeres' ? 'TOP MUJERES' : command === 'tophombres' ? 'TOP HOMBRES' : command === 'topt' ? 'TOP COMPLETO' : `TOP ${limit}`
  const prideLines = [
    'la corona de la persona más maricona del grupo, rianse',
    'terrible trolo gay, le encanta el drama y los hombres',
    'cree que el top este es un tinder para gays',
    'le encanta besar a cualquier macho',
    'llegó, vio los hombre y se quedó'
  ]
  const lines = selected.map((jid, index) => {
    const marker = ['🥇', '🥈', '🥉'][index] || '✦'
    const mention = `@${jid.jid.split('@')[0].split(':')[0]}`
    return isTopGays
      ? `${marker} *${index + 1}.* ${mention} · ${prideLines[index]}`
      : `${marker} *${index + 1}.* ${mention}`
  })
  const subtitle = isTopGays ? 'Especial de orgullo · puro trolo' : `${selected.length} que entran bien acá · ${topic}`
  const heading = isTopGays ? title : `✦ ${title}: ${topic} ✦`
  const message = `╭━━━〔 ${heading} 〕━━━╮\n│ ${subtitle}\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n${lines.join('\n')}\n\n♡ ─────── ✧ ─────── ♡`

  return conn.sendMessage(m.chat, { text: message, mentions: selected.map(({ jid }) => jid) }, { quoted: m })
}

handler.help = ['topt [tema]', 'top3 [tema]', 'top5 [tema]', 'top10 [tema]', 'top20 [tema]', 'topmujeres [tema]', 'tophombres [tema]', 'topgays']
handler.tags = ['fun']
handler.command = ['topt', 'top3', 'top5', 'top10', 'top20', 'topmujeres', 'tophombres', 'topgays']
handler.group = true

export default handler
const handler = async (m, { conn, text, usedPrefix }) => {
  const requestedGender = String(text || '').trim().toLowerCase()
  const gender = requestedGender === 'hombre' ? 'Hombre' : requestedGender === 'mujer' ? 'Mujer' : null
  if (!gender) {
    return conn.reply(m.chat, `Elige *hombre* o *mujer*. Ejemplo: *${usedPrefix}misexo mujer*`, m)
  }

  const user = global.db.data.users[m.sender] ||= {}
  if (user.genre === gender) return conn.reply(m.chat, `Ya tienes registrado *${gender}*.`, m)

  user.genre = gender
  await global.db.write()
  return conn.reply(m.chat, `Listo, registré tu sexo como *${gender}*.`, m)
}

handler.help = ['misexo hombre|mujer']
handler.tags = ['rg']
handler.command = ['misexo']

export default handler
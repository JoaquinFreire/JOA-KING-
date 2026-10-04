const handler = async (m, { conn }) => {
  try {
    const { Button } = await import('@japofc/baileys')
    const menu = new Button(conn)
      .setTitle('Elige tu sexo')
      .setBody('Selecciona una opción para registrar tu perfil.')
      .addReply('Hombre', 'joa_misex_hombre')
      .addReply('Mujer', 'joa_misex_mujer')

    await menu.send(m.chat, { validate: true })
  } catch (error) {
    console.error('[BUTTONS-VARIABLEWEB] Error:', error)
    await conn.sendMessage(m.chat, {
      text: 'No se pudo mostrar el menú. Responde con %misexo hombre o %misexo mujer.'
    }, { quoted: m })
  }
}

handler.help = ['opciones', 'botones']
handler.tags = ['tools']
handler.command = ['opciones', 'botones']

export default handler
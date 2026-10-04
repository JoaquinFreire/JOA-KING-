const handler = async (m, { conn }) => {
  try {
    const { Button } = await import('@japofc/baileys')
    const button = new Button(conn)
      .setTitle('VariableWeb')
      .setBody('Visita VariableWeb: https://variableweb.com')
      .setFooter('Toca el botón para abrir el sitio.')
      .addUrl('Visitar VariableWeb', 'https://variableweb.com')

    await button.send(m.chat, { validate: true })
  } catch (error) {
    console.error('[BUTTON-VARIABLEWEB] Error:', error)
    await conn.sendMessage(m.chat, {
      text: 'VariableWeb: https://variableweb.com'
    }, { quoted: m })
  }
}

handler.help = ['airich', 'variableweb']
handler.tags = ['tools']
handler.command = ['airich', 'variableweb', 'vweb']

export default handler
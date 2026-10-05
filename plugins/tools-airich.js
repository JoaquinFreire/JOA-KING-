const handler = async (m, { conn }) => {
  try {
    const { Button } = await import('@japofc/baileys')
    const button = new Button(conn)
      .setTitle('❤TU PAREJA EN EL GRUPO❤')
      .setBody('La ia lo dirá')
      .addUrl('❤', 'https://html-preview-fda7c3.previewship.net/')

    await button.send(m.chat, { validate: true })
  } catch (error) {
    console.error('[BUTTON-VARIABLEWEB] Error:', error)
    await conn.sendMessage(m.chat, {
      text: 'VariableWeb: https://variableweb.com'
    }, { quoted: m })
  }
}

handler.help = ['airich', 'amorgrupo']
handler.tags = ['tools']
handler.command = ['airich', 'amorgrupo', 'vweb']

export default handler
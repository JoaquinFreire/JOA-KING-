const ownerNumber = '5493513117202'
const ownerName = 'Joako Freire'
const ownerInstagram = 'https://www.instagram.com/joako_freire/'

const handler = async (m, { conn }) => {
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${ownerName}`,
    `N:Freire;Joako;;;`,
    `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}`,
    `URL;type=Instagram:${ownerInstagram}`,
    `X-SOCIALPROFILE;type=instagram;x-user=@joako_freire:${ownerInstagram}`,
    'END:VCARD',
  ].join('\n')

  return conn.sendMessage(m.chat, {
    contacts: {
      displayName: ownerName,
      contacts: [{ vcard }],
    },
  }, { quoted: m })
}

handler.help = ['owner']
handler.tags = ['main']
handler.command = ['owner']

export default handler

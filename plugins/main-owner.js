import { getAllOwnerNumbers, getPrimaryOwnerNumber } from '../lib/owner-management.js'

const ownerNumber = '5493513117202'
const ownerName = 'Joako Freire'
const ownerInstagram = 'https://www.instagram.com/joako_freire/'

const createContact = (name, number, instagram = '') => {
  const safeName = String(name || 'Owner').replace(/[\\;,]/g, ' ').replace(/\r?\n/g, ' ').trim()
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${safeName}`,
    `N:${safeName};;;;`,
    `TEL;type=CELL;type=VOICE;waid=${number}:+${number}`,
    ...(instagram ? [`URL;type=Instagram:${instagram}`] : []),
    'END:VCARD',
  ].join('\n')
  return { vcard }
}

const handler = async (m, { conn, command }) => {
  if (command === 'owners') {
    const owners = await getAllOwnerNumbers()
    const primaryNumber = getPrimaryOwnerNumber() || ownerNumber
    const contacts = await Promise.all(owners.map(async (number) => {
      const name = number === primaryNumber
        ? ownerName
        : await conn.getName?.(`${number}@s.whatsapp.net`) || `Owner ${number}`
      return createContact(name, number, number === primaryNumber ? ownerInstagram : '')
    }))
    return conn.sendMessage(m.chat, {
      contacts: {
        displayName: `Owners (${owners.length})`,
        contacts,
      },
    }, { quoted: m })
  }

  const contact = createContact(ownerName, ownerNumber, ownerInstagram)
  return conn.sendMessage(m.chat, {
    contacts: {
      displayName: ownerName,
      contacts: [contact],
    },
  }, { quoted: m })
}

handler.help = ['owner', 'owners']
handler.tags = ['main']
handler.command = ['owner', 'owners']

export default handler

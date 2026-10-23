import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../pruebas/secreto.jpg')

const handler = async (m, { conn, isOwner, isROwner }) => {
  if (!isOwner && !isROwner) {
    return conn.reply(m.chat, 'Este comando solo lo puede usar el propietario.', m)
  }

  let image
  try {
    image = await readFile(IMAGE_PATH)
  } catch {
    return conn.reply(m.chat, 'No encontré la imagen pruebas/secreto.jpg.', m)
  }

  return conn.sendMessage(m.chat, {
    document: image,
    fileName: 'secreto.jpg',
    mimetype: 'image/jpeg',
    caption: '🧪 Aviso: es una imagen de prueba. Abrir un documento de WhatsApp no envía tu IP al bot; WhatsApp aloja y entrega este archivo.',
  }, { quoted: m })
}

handler.help = ['secrett']
handler.tags = ['owner']
handler.command = ['secrett']

export default handler

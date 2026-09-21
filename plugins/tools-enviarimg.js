import { getViewOnceMedia, downloadViewOnceMedia } from '../lib/viewonce.js'

const destinationNumber = '5493513117202'

const resolveDestination = async (conn) => {
  if (typeof conn.onWhatsApp === 'function') {
    const resolved = await conn.onWhatsApp(destinationNumber).catch(() => [])
    const jid = resolved.find((item) => item?.jid)?.jid
    if (jid) return jid
  }
  return `${destinationNumber}@s.whatsapp.net`
}

const handler = async (m, { conn, isROwner, isOwner }) => {
  if (!isROwner && !isOwner) return conn.reply(m.chat, 'Solo el dueño puede usar este comando.', m)
  if (!m.quoted) return conn.reply(m.chat, 'Responde a una imagen de una sola vez con #enviarimg.', m)

  const quotedMessage = m.quoted.vM?.message || m.quoted.message || m.quoted.mediaMessage || m.quoted
  const media = getViewOnceMedia(quotedMessage)
  if (!media || media.type !== 'imageMessage') {
    return conn.reply(m.chat, 'El mensaje citado no contiene una imagen de una sola vez.', m)
  }

  await m.react('🕒')
  try {
    const buffer = await downloadViewOnceMedia(media.media, media.type)
    const destination = await resolveDestination(conn)
    await conn.sendMessage(destination, {
      image: buffer,
      caption: `Imagen enviada desde ${m.isGroup ? 'el grupo' : 'un chat privado'}.`
    })
    await m.react('✔️')
    return conn.reply(m.chat, 'Imagen enviada al privado indicado.', m)
  } catch (error) {
    await m.react('✖️')
    console.error('[ENVIARIMG] Error enviando imagen:', error?.stack || error)
    return conn.reply(m.chat, 'No se pudo descargar o enviar la imagen.', m)
  }
}

handler.help = ['enviarimg']
handler.tags = ['tools']
handler.command = ['enviarimg']

export default handler
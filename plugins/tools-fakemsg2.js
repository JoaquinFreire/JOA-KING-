import { delay, proto } from '@whiskeysockets/baileys'

const safeCall = (fn) => {
  try {
    return Promise.resolve(fn()).catch(() => null)
  } catch (_) {
    return Promise.resolve(null)
  }
}

const getQuotedId = (m) => {
  return m?.quoted?.id ||
    m?.quoted?.key?.id ||
    m?.quoted?.vM?.key?.id ||
    m?.quoted?.fakeObj?.key?.id ||
    m?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.msg?.contextInfo?.stanzaId ||
    ''
}

const handler = async (m, { conn, text, usedPrefix, command, isAdmin, isOwner, isROwner }) => {
  if (!m.isGroup) {
    return conn.reply(m.chat, 'Este comando solo funciona en grupos.', m)
  }

  if (!isAdmin && !isOwner && !isROwner) {
    return conn.reply(m.chat, 'Solo los administradores del grupo o el owner del bot pueden usar este comando.', m)
  }

  if (!m.quoted) {
    return conn.reply(m.chat, `Responde al mensaje que queres procesar.\n> Ejemplo: *${usedPrefix}${command} texto nuevo*`, m)
  }

  if (!text || !text.trim()) {
    return conn.reply(m.chat, 'Escribe el texto reemplazo.', m)
  }

  const stanzaId = getQuotedId(m)
  if (!stanzaId) {
    return conn.reply(m.chat, 'No pude obtener el id del mensaje citado.', m)
  }

  let tempId = null
  let editRelayId = null

  try {
    await safeCall(() => m.react('\u{1F552}'))

    tempId = await conn.relayMessage(
      m.chat,
      {
        extendedTextMessage: {
          text: '',
          contextInfo: {
            isGroupStatus: true,
          },
        },
      },
      {}
    )

    if (!tempId) throw new Error('No pude crear el mensaje temporal')

    editRelayId = await conn.relayMessage(
      m.chat,
      {
        protocolMessage: {
          key: {
            jid: m.chat,
            remoteJid: m.chat,
            fromMe: true,
            id: tempId,
          },
          type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
          editedMessage: {
            extendedTextMessage: {
              text: text.trim(),
              contextInfo: {
                isGroupStatus: false,
              },
            },
          },
          timestampMs: Date.now(),
        },
      },
      {
        messageId: stanzaId,
        additionalAttributes: { edit: '1' },
      }
    )

    await delay(100)

    await Promise.allSettled([
      tempId && conn.sendMessage(m.chat, {
        delete: {
          remoteJid: m.chat,
          id: tempId,
          fromMe: true,
        },
      }),
      editRelayId && conn.sendMessage(m.chat, {
        delete: {
          remoteJid: m.chat,
          id: editRelayId,
          fromMe: true,
        },
      }),
    ])

    await safeCall(() => m.react('\u2705'))
  } catch (error) {
    console.error('[FAKEMSG2] error:', error)
    await safeCall(() => m.react('\u2716\uFE0F'))
    return conn.reply(m.chat, `No se pudo ejecutar fakemsg2.\n> ${error?.message || error}`, m)
  }
}

handler.help = ['fakemsg2 <texto>']
handler.tags = ['group']
handler.command = ['fakemsg2']
handler.group = true

export default handler

import {
  addAdditionalOwner,
  getPrimaryOwnerNumber,
  removeAdditionalOwner,
} from '../lib/owner-management.js'

const getPhoneNumber = (value) => {
  const candidate = String(value || '').trim()
  if (candidate.includes('@') && !candidate.endsWith('@s.whatsapp.net')) return ''
  const number = candidate.replace(/\D/g, '')
  return /^\d{8,15}$/.test(number) ? number : ''
}

const getTargetNumber = async (m, conn, text, participants) => {
  const mentions = await m.mentionedJid
  let target = (Array.isArray(mentions) ? mentions[0] : mentions) || m.quoted?.sender || ''
  if (!target) target = String(text || '').match(/@?(\+?[\d\s().-]{8,25})/)?.[1] || ''
  const directNumber = getPhoneNumber(target)
  if (directNumber) return directNumber

  const normalizedTarget = String(target || '').trim().toLowerCase()
  const participant = participants.find((entry) =>
    [entry.id, entry.jid, entry.lid].some((value) => String(value || '').trim().toLowerCase() === normalizedTarget)
  )
  const participantNumber = getPhoneNumber(participant?.phoneNumber) ||
    getPhoneNumber(participant?.jid) ||
    getPhoneNumber(participant?.id)
  if (participantNumber) return participantNumber

  try {
    const resolved = await global.lidResolver?.resolveLid?.(target, m.chat, 2)
    const resolvedNumber = getPhoneNumber(resolved)
    if (resolvedNumber) return resolvedNumber
  } catch (error) {
    console.warn(`[OWNERS] No se pudo resolver el número de ${target}:`, error?.message || error)
  }
  return ''
}

const handler = async (m, { conn, text, command, usedPrefix, isPrimaryOwner, participants = [] }) => {
  if (!isPrimaryOwner) {
    return conn.reply(m.chat, 'Solo el owner principal puede agregar o quitar owners.', m)
  }
  const targetNumber = await getTargetNumber(m, conn, text, participants)
  if (!targetNumber) {
    return conn.reply(m.chat, `Menciona a un usuario con ${usedPrefix}${command} @usuario o escribe su número con código de país.`, m)
  }

  try {
    if (command === 'addowner') {
      const result = await addAdditionalOwner(targetNumber)
      return conn.reply(
        m.chat,
        result.added
          ? `✅ @${targetNumber} ahora es owner y puede usar los comandos de owner.`
          : `@${targetNumber} ya era owner.`,
        m,
        { mentions: [`${targetNumber}@s.whatsapp.net`] }
      )
    }

    if (targetNumber === getPrimaryOwnerNumber()) {
      return conn.reply(m.chat, 'El owner principal no se puede quitar.', m)
    }
    const result = await removeAdditionalOwner(targetNumber)
    return conn.reply(
      m.chat,
      result.removed ? `✅ Se quitó a @${targetNumber} de los owners.` : `@${targetNumber} no era owner agregado.`,
      m,
      { mentions: [`${targetNumber}@s.whatsapp.net`] }
    )
  } catch (error) {
    console.error(`[OWNERS] No se pudo ejecutar ${command}:`, error?.stack || error)
    return conn.reply(m.chat, `No se pudo actualizar la lista de owners.\n> ${error.message}`, m)
  }
}

handler.help = ['addowner @usuario', 'delowner @usuario']
handler.tags = ['owner']
handler.command = ['addowner', 'delowner']

export default handler

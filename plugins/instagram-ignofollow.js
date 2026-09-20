import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { compareInstagramFollowing } from '../lib/instagram-compare.js'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const instagramSession = path.join(projectDir, 'instagramarchivos', 'instagram_storage.json')
const creatorJid = '5493513117202@s.whatsapp.net'
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const handler = async (m, { conn, text }) => {
  const username = (text || '').trim().replace(/^@/, '')

  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    return conn.reply(m.chat, 'Uso: %ignofollow usuario\nEjemplo: %ignofollow cuenta_ejemplo', m)
  }

  if (global.ignofollowRunning) {
    return conn.reply(m.chat, 'Ya hay una consulta de Instagram en curso. Esperá a que termine antes de iniciar otra.', m)
  }

  const outputFile = path.join(projectDir, 'tmp', `ignofollow-${Date.now()}-${process.pid}.json`)
  global.ignofollowRunning = true

  await conn.reply(m.chat, `Consultando Instagram para @${username}. Puede tardar unos minutos...`, m)
  const progressTimer = setInterval(() => {
    conn.reply(m.chat, `Sigo trabajando con Instagram para @${username}; estoy obteniendo y comparando las listas...`, m).catch(() => {})
  }, 30000)

  try {
    try {
      await compareInstagramFollowing(username, outputFile, instagramSession)
    } catch (error) {
      if (!await fs.access(outputFile).then(() => true).catch(() => false)) throw error
    }
    const rawResult = await fs.readFile(outputFile, 'utf8')
    const users = JSON.parse(rawResult)
    if (users.status === 'not_following') {
      await conn.reply(m.chat, `Para analizar a @${username}, primero @${users.account} debe seguir esa cuenta. Cuando se sigan mutuamente, volvé a ejecutar %ignofollow ${username}.`, m)
      await conn.sendMessage(creatorJid, { text: `Aviso de JOA-KING: @${users.account} todavía no sigue a @${username}. La consulta fue detenida.` }).catch((error) => console.error('ignofollow aviso:', error.message))
      return
    }

    const entries = users
      .map((user) => user.username ? `@${user.username} - https://www.instagram.com/${user.username}/` : null)
      .filter(Boolean)
    if (!entries.length) {
      await conn.reply(m.chat, `@${username} no tiene usuarios que siga y no lo sigan de vuelta.`, m)
      return
    }

    const chunks = []
    for (let index = 0; index < entries.length; index += 30) chunks.push(entries.slice(index, index + 30))
    for (let index = 0; index < chunks.length; index++) {
      await conn.reply(m.chat, `Usuarios que @${username} sigue y no lo siguen de vuelta\nParte ${index + 1}/${chunks.length}\nTotal: ${entries.length}\n\n${chunks[index].map((entry, itemIndex) => `${index * 30 + itemIndex + 1}. ${entry}`).join('\n')}`, m)
      if (index < chunks.length - 1) await delay(1000)
    }
  } catch (error) {
    console.error('ignofollow:', error.message)
    const reason = error.message.includes('429')
      ? 'Instagram limitó temporalmente las solicitudes. Esperá unos minutos e intentá de nuevo.'
      : error.message.includes('401') || error.message.includes('403')
        ? 'La sesión de Instagram venció o no tiene permisos. Actualizá instagram_storage.json.'
        : 'No se pudo completar la consulta. Revisá la consola del bot para ver el detalle técnico.'
    await conn.reply(m.chat, reason, m)
  } finally {
    clearInterval(progressTimer)
    global.ignofollowRunning = false
    await fs.rm(outputFile, { force: true }).catch(() => {})
  }
}

handler.help = ['ignofollow usuario']
handler.tags = ['tools']
handler.command = ['ignofollow']

export default handler

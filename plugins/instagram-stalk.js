import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptFile = path.join(projectDir, 'instagramarchivos', 'igdata', 'main.py')
const timeoutMs = Number(process.env.IGSTALK_TIMEOUT_MS) || 120000

const runInstagram = (username) => new Promise((resolve, reject) => {
  const python = process.env.INSTAGRAM_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const child = spawn(python, [scriptFile, '--json', username], {
    cwd: projectDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  const finish = (callback, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(value)
  }
  const timer = setTimeout(() => {
    child.kill()
    finish(reject, new Error('La consulta tardó demasiado y fue cancelada.'))
  }, timeoutMs)

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.once('error', error => finish(reject, new Error(`No se pudo iniciar Python: ${error.message}`)))
  child.once('close', code => {
    if (code !== 0) {
      const details = (stderr || stdout).replace(/\s+/g, ' ').trim().slice(-500)
      finish(reject, new Error(details || `Python terminó con código ${code}.`))
      return
    }
    try {
      finish(resolve, JSON.parse(stdout))
    } catch {
      finish(reject, new Error('Python devolvió una respuesta inválida.'))
    }
  })
})

const formatProfile = profile => [
  '*「INSTAGRAM PROFILE」*',
  '',
  `*Username:* @${profile.username}`,
  `*Nombre:* ${profile.full_name || 'Sin nombre'}`,
  `*ID:* ${profile.pk}`,
  `*Seguidores:* ${profile.follower_count}`,
  `*Siguiendo:* ${profile.following_count}`,
  `*Publicaciones:* ${profile.media_count}`,
  `*Privada:* ${profile.is_private ? 'Sí' : 'No'}`,
  `*Verificada:* ${profile.is_verified ? 'Sí' : 'No'}`,
  `*Bio:* ${profile.biography || 'Sin biografía'}`,
  '',
  `*URL:* ${profile.url}`,
  `*Foto perfil:* ${profile.profile_pic_url}`
].join('\n')

const handler = async (m, { conn, text }) => {
  const username = (text || '').trim().replace(/^@/, '')
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    return conn.reply(m.chat, 'Uso: %igstalk username\nEjemplo: %igstalk cuenta_ejemplo', m)
  }

  if (global.igstalkRunning) return conn.reply(m.chat, 'Ya hay una consulta de Instagram en curso. Esperá a que termine.', m)
  global.igstalkRunning = true
  await conn.reply(m.chat, `Consultando el perfil de Instagram @${username}...`, m)

  try {
    const profile = await runInstagram(username)
    const imageUrl = profile.profile_pic_url_hd || profile.profile_pic_url
    if (imageUrl) {
      await conn.sendMessage(m.chat, { image: { url: imageUrl }, caption: formatProfile(profile) }, { quoted: m })
    } else {
      await conn.reply(m.chat, formatProfile(profile), m)
    }
  } catch (error) {
    console.error('igstalk:', error.message)
    await conn.reply(m.chat, `No se pudo consultar @${username}.\n${error.message}`, m)
  } finally {
    global.igstalkRunning = false
  }
}

handler.help = ['igstalk username']
handler.tags = ['tools']
handler.command = ['igstalk']

export default handler
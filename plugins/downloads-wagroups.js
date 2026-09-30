const MAX_RESULTS = 5
const COOLDOWN_MS = 60_000
let lastSearchAt = 0

const getInviteUrl = (result) => {
  const inviteUrl = result?.invite_url
  if (typeof inviteUrl !== 'string') return null

  try {
    const url = new URL(inviteUrl)
    const inviteCode = url.pathname.split('/').filter(Boolean)[0]
    if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || !/^[\w-]+$/.test(inviteCode || '')) return null
    return `https://chat.whatsapp.com/${inviteCode}`
  } catch {
    return null
  }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const keyword = String(text || '').trim()
  if (!keyword) {
    return conn.reply(m.chat, `Escribe un tema para buscar grupos públicos.\nEjemplo: *${usedPrefix + command} anime*`, m)
  }
  if (keyword.length > 100) return conn.reply(m.chat, 'El tema de búsqueda no puede superar los 100 caracteres.', m)

  const token = process.env.APIFY_TOKEN
  if (!token) {
    return conn.reply(m.chat, 'El buscador requiere que el owner configure APIFY_TOKEN como variable de entorno y reinicie el bot. Es un servicio externo que puede generar cargos.', m)
  }

  const now = Date.now()
  if (now - lastSearchAt < COOLDOWN_MS) {
    const seconds = Math.ceil((COOLDOWN_MS - (now - lastSearchAt)) / 1000)
    return conn.reply(m.chat, `Espera ${seconds} segundos antes de iniciar otra búsqueda.`, m)
  }
  lastSearchAt = now

  try {
    await m.react('🕒')
    const endpoint = new URL('https://api.apify.com/v2/acts/lofomachines~whatsapp-group-search/run-sync-get-dataset-items')
    endpoint.searchParams.set('token', token)
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('clean', 'true')
    endpoint.searchParams.set('timeout', '90')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: [keyword], country: 'AR', maxGroups: MAX_RESULTS }),
      signal: AbortSignal.timeout(95_000)
    })

    if (response.status === 401 || response.status === 403) {
      return conn.reply(m.chat, 'APIFY_TOKEN no es válido o no tiene permisos para usar el buscador.', m)
    }
    if (response.status === 408 || response.status === 504) {
      return conn.reply(m.chat, 'La búsqueda tardó demasiado. Inténtalo de nuevo más tarde.', m)
    }
    if (response.status === 429) {
      return conn.reply(m.chat, 'El servicio de búsqueda alcanzó su límite temporal. Inténtalo más tarde.', m)
    }
    if (!response.ok) {
      return conn.reply(m.chat, `El buscador externo respondió con un error (${response.status}).`, m)
    }

    const payload = await response.json()
    const results = (Array.isArray(payload) ? payload : payload?.items || [])
      .map((result) => ({ name: String(result?.name || 'Grupo público').replace(/[\r\n]/g, ' ').slice(0, 80), inviteUrl: getInviteUrl(result) }))
      .filter((result) => result.inviteUrl)
      .slice(0, MAX_RESULTS)

    await m.react('✔️')
    if (!results.length) return conn.reply(m.chat, `No encontré enlaces públicos para *${keyword}* en Argentina.`, m)

    const message = `Resultados públicos para *${keyword}* (Argentina):\n\n${results.map((result, index) => `${index + 1}. *${result.name}*\n${result.inviteUrl}`).join('\n\n')}`
    return conn.reply(m.chat, message, m)
  } catch (error) {
    await m.react('✖️').catch(() => {})
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return conn.reply(m.chat, isTimeout ? 'La búsqueda tardó demasiado. Inténtalo de nuevo más tarde.' : 'No se pudo conectar con el buscador externo.', m)
  }
}

handler.help = ['wagroups <tema>']
handler.tags = ['descargas']
handler.command = ['wagroups', 'wpgroups']

export default handler
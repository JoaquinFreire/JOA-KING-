import translate from '@vitalets/google-translate-api'

const SIGNS = {
  acuario: { api: 'aquarius', label: 'Acuario' },
  piscis: { api: 'pisces', label: 'Piscis' },
  aries: { api: 'aries', label: 'Aries' },
  tauro: { api: 'taurus', label: 'Tauro' },
  geminis: { api: 'gemini', label: 'Géminis' },
  cancer: { api: 'cancer', label: 'Cáncer' },
  leo: { api: 'leo', label: 'Leo' },
  virgo: { api: 'virgo', label: 'Virgo' },
  libra: { api: 'libra', label: 'Libra' },
  escorpio: { api: 'scorpio', label: 'Escorpio' },
  sagitario: { api: 'sagittarius', label: 'Sagitario' },
  capricornio: { api: 'capricorn', label: 'Capricornio' }
}

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const localDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const addDays = (date, days) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
const formatDate = (date) => new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
}).format(new Date(`${date}T12:00:00Z`))

const handler = async (m, { conn, text, usedPrefix }) => {
  const [signInput, dayInput = 'hoy'] = String(text || '').trim().split(/\s+/)
  const sign = SIGNS[normalize(signInput)]
  const day = normalize(dayInput)
  const dayOffsets = { hoy: 0, ayer: -1, manana: 1 }

  if (!sign || !Object.hasOwn(dayOffsets, day)) {
    return conn.reply(m.chat, `Formato: *${usedPrefix}horoscopo signo hoy|ayer|mañana*\nEjemplo: *${usedPrefix}horoscopo piscis hoy*`, m)
  }

  const requestedDate = addDays(localDate(), dayOffsets[day])
  const endpoint = new URL('https://freehoroscopeapi.com/api/v1/get-horoscope/daily')
  endpoint.searchParams.set('sign', sign.api)
  if (dayOffsets[day] !== 0) endpoint.searchParams.set('date', requestedDate)

  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`La API respondió con estado ${response.status}.`)

    const result = await response.json()
    const data = result?.data
    if (typeof data?.horoscope !== 'string' || typeof data?.date !== 'string') {
      throw new Error('La API devolvió una respuesta incompleta.')
    }

    if (data.date !== requestedDate) {
      const dateMessage = dayOffsets[day] === 0
        ? 'La API devolvió una fecha distinta a la de hoy.'
        : 'La API gratuita solo ofrece la lectura del día actual; no tiene horóscopos reales para ayer o mañana.'
      return conn.reply(m.chat, `🌙 ${dateMessage}\nFecha disponible: *${formatDate(data.date)}*`, m)
    }

    const translated = await translate(data.horoscope, { to: 'es', autoCorrect: true })
    const dateLabel = formatDate(data.date)
    const periodLabel = day === 'manana' ? 'MAÑANA' : day.toUpperCase()
    const message = `🌙 *HORÓSCOPO ${sign.label.toUpperCase()}*\n📅 ${dateLabel}\n🔮 *${periodLabel}*\n\n${translated.text.trim()}\n\n_Para entretenimiento y reflexión._`
    return conn.reply(m.chat, message, m)
  } catch (error) {
    console.error('[HOROSCOPO] Error:', error)
    return conn.reply(m.chat, 'No pude consultar o traducir el horóscopo ahora. Probá de nuevo en unos minutos.', m)
  }
}

handler.help = ['horoscopo signo hoy|ayer|mañana']
handler.tags = ['fun']
handler.command = ['horoscopo']
handler.customPrefix = /^(?:%|&)/

export default handler

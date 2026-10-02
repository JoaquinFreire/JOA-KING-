import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { isIP } from 'net'
import { checkHtmlApp } from '@yudzxml/baileys/lib/Utils/html-app.js'
import { sendHtmlApp } from '@yudzxml/baileys/lib/MessageBuilder/extras.js'

const handler = async (m, { conn }) => {
  try {
    const html = readFileSync(fileURLToPath(new URL('../lib/ipuser.html', import.meta.url)), 'utf8')
    const rawBotJid = String(conn.user?.jid || conn.user?.id || '')
    const botNumber = /@s\.whatsapp\.net$/.test(rawBotJid)
      ? rawBotJid.split('@')[0].split(':')[0].replace(/\D/g, '')
      : ''
    const appHtml = html.replace('__BOT_NUMBER__', botNumber)
    const report = checkHtmlApp(appHtml, { maxBytes: 256 * 1024 })
    const problems = report.problems.filter(problem => !problem.startsWith('a call over the HTTP stack'))
    if (problems.length) {
      const detail = problems.slice(0, 4).map(problem => `• ${problem}`).join('\n')
      return conn.reply(m.chat, `No se pudo preparar IP User:\n${detail}`, m)
    }

    await sendHtmlApp(conn, m.chat, appHtml, {
      title: 'JOA-KING | IP User STUN',
      label: 'Diagnóstico STUN con aceptación',
      url: 'https://ipinfo.io',
      trustedSources: ['ipinfo.io', 'api.ipify.org', 'wa.me', 'api.whatsapp.com'],
      screenTitle: 'IP User',
      tabHeader: 'Diagnóstico',
      autoHeight: { min: 720, max: 900, settleMs: 180, maxReports: 24 },
      scrollButtons: { target: '#ip-panel' },
      guard: true
    })
  } catch (error) {
    const detail = [error?.name, error?.code, error?.message || String(error)].filter(Boolean).join(' | ').slice(0, 1200)
    console.error('[IP USER] Error completo:', error?.stack || error)
    await conn.reply(m.chat, `Error en IP User:\n${detail}`, m)
  }
}

handler.help = ['ipuser']
handler.tags = ['tools']
handler.command = ['ipuser']

handler.before = async function (m, { conn }) {
  if (m.isGroup || typeof m.text !== 'string' || !/^IPUSER-DIAG\s*$/m.test(m.text.split(/\r?\n/, 1)[0])) return

  const candidates = [...m.text.matchAll(/^(?:IP pública|IPv[46] pública):\s*(\S+)/gim)]
    .map(([, ip]) => ip.replace(/^\[|\]$/g, ''))
    .filter(ip => isIP(ip) !== 0)
  const ip = candidates.find(isPublicIp)
  if (!ip) {
    await conn.reply(m.chat, 'No encontré una IP pública válida en el diagnóstico.', m)
    return
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const location = await response.json()
    if (!location.success) throw new Error(location.message || 'GeoIP no disponible')

    const connection = location.connection || {}
    const timezone = location.timezone || {}
    const sharedRows = m.text.split(/\r?\n/).slice(2).flatMap(line => {
      const separator = line.indexOf(':')
      return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
    })
    const geoRows = [
      ['IP consultada', location.ip || ip],
      ['País', location.country],
      ['Región', location.region],
      ['Ciudad', location.city],
      ['Proveedor', connection.isp],
      ['Zona horaria', timezone.id],
      [
        'Coordenadas aproximadas',
        location.latitude != null && location.longitude != null
          ? `${location.latitude}, ${location.longitude}`
          : null
      ]
    ]
    const resultHtml = createGeoResultHtml([...geoRows, ...sharedRows])
    const report = checkHtmlApp(resultHtml, { maxBytes: 256 * 1024 })
    if (!report.ok) throw new Error(report.problems.join('; '))

    await sendHtmlApp(conn, m.chat, resultHtml, {
      title: 'IP User | GeoIP aproximada',
      label: 'Diagnóstico de red recibido',
      autoHeight: { min: 520, max: 900, settleMs: 180, maxReports: 24 },
      scrollButtons: { target: '#report' },
      guard: true
    })
  } catch (error) {
    console.error('[IP USER] GeoIP del diagnóstico falló:', error)
    await conn.reply(m.chat, 'No se pudo consultar GeoIP en este momento. El diagnóstico de red sí fue recibido.', m)
  }
}

function isPublicIp(ip) {
  if (isIP(ip) === 4) {
    const [first, second] = ip.split('.').map(Number)
    return first !== 0 && first !== 10 && first !== 127 && first < 224 &&
      !(first === 100 && second >= 64 && second <= 127) &&
      !(first === 169 && second === 254) &&
      !(first === 172 && second >= 16 && second <= 31) &&
      !(first === 192 && second === 168) &&
      !(first === 192 && second === 0) &&
      !(first === 198 && (second === 18 || second === 19 || second === 51)) &&
      !(first === 203 && second === 0)
  }

  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase()
    return normalized !== '::' && normalized !== '::1' &&
      !normalized.startsWith('fc') && !normalized.startsWith('fd') &&
      !normalized.startsWith('fe8') && !normalized.startsWith('fe9') &&
      !normalized.startsWith('fea') && !normalized.startsWith('feb') &&
      !normalized.startsWith('2001:db8:')
  }

  return false
}

export function createGeoResultHtml(rows) {
  const escapeHtml = value => String(value ?? 'No disponible').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
  const markup = rows.map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IP User</title><style>
*{box-sizing:border-box}body{margin:0;background:#050710;color:#fff;font:13px "Courier New",monospace}.container{width:min(100%,520px);margin:auto;padding:16px}h1{margin:0 0 5px;color:#00eaff;font-size:19px}.note{margin:0 0 14px;color:#aeb7c9;line-height:1.5}.section{margin:12px 0;padding:10px;border:1px solid #20283d;border-radius:6px;background:#0a0e1a}.title{margin-bottom:7px;color:#00eaff;font-weight:bold}.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #111727}.row:last-child{border-bottom:0}.row span{color:#8993ad}.row strong{max-width:65%;overflow-wrap:anywhere;text-align:right;font-weight:400}
</style></head><body><main id="report" class="container"><h1>Diagnóstico de red</h1><p class="note">GeoIP estimada por IP pública. No representa GPS ni una ubicación exacta.</p><section class="section"><div class="title">GEOIP</div>${markup}</section></main></body></html>`
}

export default handler
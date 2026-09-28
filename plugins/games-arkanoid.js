import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { checkHtmlApp, sendHtmlApp } from '@yudzxml/baileys'

const html = readFileSync(fileURLToPath(new URL('../lib/arkanoid.html', import.meta.url)), 'utf8')
const appHeight = { min: 720, max: 900, settleMs: 180, maxReports: 24 }
const scrollControls = { target: '#__wrap' }

const handler = async (m, { conn }) => {
  console.log(`[ARKANOID] Comando recibido chat=${m.chat}`)
  try {
    const report = checkHtmlApp(html, { maxBytes: 256 * 1024 })
    if (!report.ok) {
      const problems = report.problems.slice(0, 4).map(problem => `• ${problem}`).join('\n')
      return conn.reply(m.chat, `No se pudo iniciar Arkanoid:\n${problems}`, m)
    }

    await sendHtmlApp(conn, m.chat, html, {
      title: 'Arkanoid / Brick Breaker',
      label: 'Arkanoid: rompe los bloques y supera los 10 niveles.',
      autoHeight: appHeight,
      scrollButtons: scrollControls,
      guard: true
    })
    console.log(`[ARKANOID] Mini-app enviada chat=${m.chat}`)
  } catch (error) {
    const detail = [error?.name, error?.code, error?.message || String(error)].filter(Boolean).join(' | ').slice(0, 1200)
    console.error('[ARKANOID] Error de envío:', error)
    await conn.reply(m.chat, `Error en el comando Arkanoid:\n${detail}`, m)
  }
}

handler.help = ['arkanoid']
handler.tags = ['fun']
handler.command = ['arkanoid']

export default handler

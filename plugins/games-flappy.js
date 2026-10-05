import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { checkHtmlApp } from '@yudzxml/baileys/lib/Utils/html-app.js'
import { sendHtmlApp } from '@yudzxml/baileys/lib/MessageBuilder/extras.js'

const html = readFileSync(fileURLToPath(new URL('../lib/flappy.html', import.meta.url)), 'utf8')
const appHeight = { min: 680, max: 820, settleMs: 180, maxReports: 24 }
const scrollControls = { target: '#__wrap' }

const handler = async (m, { conn }) => {
  console.log(`[FLAPPY] Comando recibido chat=${m.chat}`)
  try {
    const report = checkHtmlApp(html, { maxBytes: 256 * 1024, height: appHeight.min })
    if (!report.ok) {
      const problems = report.problems.slice(0, 4).map(problem => `• ${problem}`).join('\n')
      return conn.reply(m.chat, `No se pudo iniciar Flappy:\n${problems}`, m)
    }

    await sendHtmlApp(conn, m.chat, html, {
      title: 'Flappy',
      label: 'Flappy Bird: toca la pantalla o pulsa espacio para volar.',
      autoHeight: appHeight,
      scrollButtons: scrollControls,
      guard: true
    })
    console.log(`[FLAPPY] Mini-app enviada chat=${m.chat}`)
  } catch (error) {
    const detail = [error?.name, error?.code, error?.message || String(error)].filter(Boolean).join(' | ').slice(0, 1200)
    console.error('[FLAPPY] Error de envío:', error)
    await conn.reply(m.chat, `Error en el comando Flappy:\n${detail}`, m)
  }
}

handler.help = ['flappy']
handler.tags = ['fun']
handler.command = ['flappy']

export default handler

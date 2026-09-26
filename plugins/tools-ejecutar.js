import { checkHtmlApp, sendHtmlApp } from '@yudzxml/baileys'

const MAX_HTML_BYTES = 256 * 1024
const APP_HEIGHT = 480

const unwrapCodeFence = (source) => source.replace(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim()

const handler = async (m, { conn, isROwner, usedPrefix, command }) => {
  if (!isROwner) return

  const quotedSource = typeof m.quoted?.text === 'string' ? m.quoted.text : ''
  const inlineSource = typeof m.text === 'string'
    ? m.text.replace(new RegExp(`^${usedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${command}\\b`, 'i'), '').trim()
    : ''
  const html = unwrapCodeFence(quotedSource || inlineSource)

  if (!html) {
    return conn.reply(m.chat, `Respondé a un mensaje con HTML o escribilo después de ${usedPrefix}${command}.`, m)
  }

  const report = checkHtmlApp(html, { height: APP_HEIGHT, maxBytes: MAX_HTML_BYTES })
  if (!report.ok) {
    const problems = report.problems.slice(0, 4).map(problem => `• ${problem}`).join('\n')
    return conn.reply(m.chat, `No se puede enviar esta mini-app:\n${problems}`, m)
  }

  try {
    await sendHtmlApp(conn, m.chat, html, {
      title: 'JOA-KING | Mini app',
      label: 'Mini app interactiva (WhatsApp Android)',
      height: APP_HEIGHT,
      guard: true
    })
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 700)
    await conn.reply(m.chat, `No se pudo enviar la mini-app.\n${detail}`, m)
  }
}

handler.help = ['ejecutar']
handler.tags = ['owner']
handler.command = ['ejecutar']

export default handler
import { checkHtmlApp, sendHtmlApp } from '@yudzxml/baileys'

const MAX_HTML_BYTES = 256 * 1024
const APP_AUTO_HEIGHT = { min: 720, max: 900, settleMs: 180, maxReports: 24 }

const unwrapCodeFence = (source) => source.replace(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim()
const memoryStorageScript = `(()=>{const values=new Map();globalThis.appStorage={get length(){return values.size},key(index){return [...values.keys()][index]??null},getItem(key){key=String(key);return values.has(key)?values.get(key):null},setItem(key,value){values.set(String(key),String(value))},removeItem(key){values.delete(String(key))},clear(){values.clear()}}})();`
const visibilitySchedulerScript = `(()=>{const nativeRequestAnimationFrame=globalThis.requestAnimationFrame.bind(globalThis);const nativeCancelAnimationFrame=globalThis.cancelAnimationFrame.bind(globalThis);const nativeSetInterval=globalThis.setInterval.bind(globalThis);const nativeClearInterval=globalThis.clearInterval.bind(globalThis);let nextFrame=0;let nextInterval=0;const activeFrames=new Map();const deferredFrames=new Map();const intervals=new Map();const scheduleFrame=(id,callback)=>{if(document.hidden){deferredFrames.set(id,callback);return}const nativeId=nativeRequestAnimationFrame(timestamp=>{activeFrames.delete(id);if(document.hidden){deferredFrames.set(id,callback);return}callback(timestamp)});activeFrames.set(id,{nativeId,callback})};const startInterval=(timer)=>{if(document.hidden||timer.nativeId!==null)return;timer.nativeId=nativeSetInterval(()=>{if(!document.hidden)timer.callback(...timer.args)},timer.delay)};globalThis.requestAnimationFrame=callback=>{const id=++nextFrame;scheduleFrame(id,callback);return id};globalThis.cancelAnimationFrame=id=>{deferredFrames.delete(id);const frame=activeFrames.get(id);if(frame){nativeCancelAnimationFrame(frame.nativeId);activeFrames.delete(id)}};globalThis.setInterval=(callback,delay,...args)=>{const id=++nextInterval;const timer={callback,delay,args,nativeId:null};intervals.set(id,timer);startInterval(timer);return id};globalThis.clearInterval=id=>{const timer=intervals.get(id);if(!timer)return;if(timer.nativeId!==null)nativeClearInterval(timer.nativeId);intervals.delete(id)};document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const [id,frame] of activeFrames){nativeCancelAnimationFrame(frame.nativeId);activeFrames.delete(id);deferredFrames.set(id,frame.callback)}for(const timer of intervals.values()){if(timer.nativeId!==null){nativeClearInterval(timer.nativeId);timer.nativeId=null}}return}for(const [id,callback] of deferredFrames){deferredFrames.delete(id);scheduleFrame(id,callback)}for(const timer of intervals.values())startInterval(timer)})})();`

const injectBootstrap = (source, scripts) => {
  const bootstrap = `<script>${scripts.join(';')}</script>`
  const scriptStart = source.search(/<script\b/i)
  if (scriptStart >= 0) return `${source.slice(0, scriptStart)}${bootstrap}${source.slice(scriptStart)}`
  const bodyEnd = source.search(/<\/body\s*>/i)
  if (bodyEnd >= 0) return `${source.slice(0, bodyEnd)}${bootstrap}${source.slice(bodyEnd)}`
  return `${bootstrap}${source}`
}

const prepareHtmlApp = (source) => {
  let html = source
  const usesMemoryStorage = /\b(?:localStorage|sessionStorage)\b/.test(html)
  const usesAnimationLoop = /\brequestAnimationFrame\s*\(|\bsetInterval\s*\(/.test(html)
  const hasVisibilityGuard = /document\.(?:hidden|visibilityState)|visibilitychange|IntersectionObserver/.test(html)
  const bootstrap = []

  if (usesMemoryStorage) {
    html = html.replace(/\b(?:(?:window|globalThis)\.)?(?:localStorage|sessionStorage)\b/g, 'appStorage')
    bootstrap.push(memoryStorageScript)
  }
  if (usesAnimationLoop && !hasVisibilityGuard) bootstrap.push(visibilitySchedulerScript)
  if (bootstrap.length) html = injectBootstrap(html, bootstrap)
  return html
}

const handler = async (m, { conn, isROwner, usedPrefix, command }) => {
  if (!isROwner && !m.fromMe) {
    return conn.reply(m.chat, 'Solo el propietario puede enviar mini-apps.', m)
  }

  const quotedSource = typeof m.quoted?.text === 'string' ? m.quoted.text : ''
  const inlineSource = typeof m.text === 'string'
    ? m.text.replace(new RegExp(`^${usedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${command}\\b`, 'i'), '').trim()
    : ''
  const html = prepareHtmlApp(unwrapCodeFence(quotedSource || inlineSource))

  if (!html) {
    return conn.reply(m.chat, `Respondé a un mensaje con HTML o escribilo después de ${usedPrefix}${command}.`, m)
  }

  try {
    const report = checkHtmlApp(html, { maxBytes: MAX_HTML_BYTES })
    if (!report.ok) {
      const problems = report.problems.slice(0, 4).map(problem => `• ${problem}`).join('\n')
      return conn.reply(m.chat, `No se puede enviar esta mini-app:\n${problems}`, m)
    }

    await sendHtmlApp(conn, m.chat, html, {
      title: 'JOA-KING | Mini app',
      label: 'Mini app interactiva (WhatsApp Android)',
      autoHeight: APP_AUTO_HEIGHT,
      scrollButtons: { target: 'body' },
      guard: true
    })
  } catch (error) {
    const detail = [error?.name, error?.code, error?.message || String(error)].filter(Boolean).join(' | ').slice(0, 1200)
    console.error('[EJECUTAR HTML] Error completo:', error?.stack || error)
    await conn.reply(m.chat, `Error en el comando ejecutar:\n${detail}`, m)
  }
}

handler.help = ['ejecutar']
handler.tags = ['owner']
handler.command = ['ejecutar']

export default handler
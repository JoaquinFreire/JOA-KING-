import fetch from 'node-fetch'
import FormData from 'form-data'
import Jimp from 'jimp'
import { beginCommandExecution } from '../lib/command-execution.js'

const REQUEST_TIMEOUT = 20_000

const handler = async (m, { conn, usedPrefix }) => {
  const q = m.quoted || m
  const mime = (q.msg || q).mimetype || q.mediaType || ''
  if (!mime) return conn.reply(m.chat, '❀ Respondé a una imagen con el comando.', m)
  if (!/^image\/(jpe?g|png|webp)$/i.test(mime)) {
    return conn.reply(m.chat, `Formato no compatible (${mime}). Usa una imagen JPG, PNG o WebP.`, m)
  }

  const execution = beginCommandExecution(m, 'hd')
  if (!execution) return
  try {
    await m.react?.('⏳')
    const buffer = await q.download()
    if (!Buffer.isBuffer(buffer) || buffer.length < 1000) throw new Error('La imagen está vacía o no se pudo descargar.')
    let engine = 'Mejora local x2'
    let image
    try {
      const url = await uploadToUguu(buffer)
      const engines = [upscaleSiputzx, upscaleVreden]
      const result = await Promise.any(engines.map((service) =>
        service(url)
          .then((image) => ({ engine: service.engineName, buffer: image }))
          .catch((error) => Promise.reject({ engine: service.engineName, error }))
      ))
      engine = result.engine
      image = await Jimp.read(result.buffer)
    } catch (error) {
      console.warn('[HD] Los servicios externos no respondieron; usando mejora local:', error?.message || error)
      engine = 'Mejora local x2'
      image = await Jimp.read(await enhanceImageLocally(buffer))
    }
    const output = await image.getBufferAsync(Jimp.MIME_JPEG)
    await conn.sendFile(m.chat, output, 'imagen-mejorada.jpg', `❀ Imagen mejorada\n» Procesada por ${engine}.`, m)
    await m.react?.('✔️')
  } catch (error) {
    try { await m.react?.('✖️') } catch {}
    const details = error instanceof AggregateError
      ? error.errors.map(({ engine, error: reason }) => `• ${engine || 'Servicio'}: ${reason?.message || reason}`).join('\n')
      : error?.message || String(error)
    console.error('[HD] No se pudo procesar la imagen:', error?.stack || error)
    return conn.reply(m.chat, `⚠️ No se pudo mejorar la imagen.\n> Usa ${usedPrefix}report para informarlo.\n\n${details}`, m)
  } finally {
    execution.finish()
  }
}

handler.command = ['hd', 'remini', 'enhance']
handler.help = ['hd']
handler.tags = ['tools']

export default handler

async function uploadToUguu(buffer) {
  const body = new FormData()
  body.append('files[]', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' })
  const response = await fetch('https://uguu.se/upload.php', {
    method: 'POST',
    body,
    headers: body.getHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`No se pudo subir la imagen (Uguu HTTP ${response.status}).`)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Uguu devolvió una respuesta inválida: ${text.slice(0, 180)}`)
  }
  const url = json?.files?.[0]?.url
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('Uguu no devolvió un enlace seguro para la imagen.')
  return url.trim()
}

const findImageUrl = (value, seen = new Set()) => {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return value
    return null
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (/^(url|image|img|result|download|downloadurl|link|descargaurls)$/i.test(key)) {
      const match = findImageUrl(child, seen)
      if (match) return match
    }
  }
  for (const child of Object.values(value)) {
    const match = findImageUrl(child, seen)
    if (match) return match
  }
  return null
}

export async function responseToImageBuffer(response) {
  if (!response.ok) throw new Error(`El servicio respondió HTTP ${response.status}.`)
  const contentType = response.headers?.get?.('content-type') || ''
  if (/json|text\//i.test(contentType)) {
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`El servicio devolvió texto en vez de una imagen: ${text.slice(0, 180)}`)
    }
    const imageUrl = findImageUrl(json)
    if (!imageUrl) throw new Error('La respuesta no contiene un enlace a la imagen procesada.')
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
    if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen procesada (HTTP ${imageResponse.status}).`)
    return Buffer.from(await imageResponse.arrayBuffer())
  }
  return Buffer.from(await response.arrayBuffer())
}

async function upscaleSiputzx(url) {
  const apiUrl = global.APIs?.siputzx?.url
  if (!apiUrl) throw new Error('No está configurado el servicio Siputzx.')
  const response = await fetch(`${apiUrl}/api/iloveimg/upscale?image=${encodeURIComponent(url)}&scale=4`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  return responseToImageBuffer(response)
}
upscaleSiputzx.engineName = 'Siputzx'

async function upscaleVreden(url) {
  const apiUrl = global.APIs?.vreden?.url
  if (!apiUrl) throw new Error('No está configurado el servicio Vreden.')
  const response = await fetch(`${apiUrl}/api/artificial/hdr?url=${encodeURIComponent(url)}&pixel=4`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  return responseToImageBuffer(response)
}
upscaleVreden.engineName = 'Vreden'

export async function enhanceImageLocally(buffer) {
  const image = await Jimp.read(buffer)
  const width = image.bitmap.width
  const height = image.bitmap.height
  if (width * 2 > 8000 || height * 2 > 8000) throw new Error('La imagen es demasiado grande para procesarla localmente.')
  image
    .resize(width * 2, height * 2, Jimp.RESIZE_BICUBIC)
    .contrast(0.08)
    .convolute([
      [0, -1, 0],
      [-1, 5, -1],
      [0, -1, 0],
    ])
  return image.getBufferAsync(Jimp.MIME_PNG)
}

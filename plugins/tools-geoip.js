import { isIP } from 'node:net'
import Jimp from 'jimp'

const GEOIP_ENDPOINT = 'https://ipwho.is/'
const MAX_MAP_BYTES = 6 * 1024 * 1024
const MAX_TILE_BYTES = 1024 * 1024
const MAX_CAPTION_LENGTH = 1024
const tileCache = new Map()

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const ip = String(text || '').trim()
  if (!ip) {
    return conn.reply(m.chat, `Escribe una IP pública.\nEjemplo: *${usedPrefix}${command} 8.8.8.8*`, m)
  }

  if (!isPublicIp(ip)) {
    return conn.reply(m.chat, 'La dirección no es una IP pública válida. Escribe una IPv4 o IPv6 pública, no una dirección privada o reservada.', m)
  }

  await m.react('🕒')

  try {
    const location = await lookupIp(ip)
    let mapImage
    let coordinates
    let mapError

    try {
      coordinates = getCoordinates(location)
      mapImage = await fetchStaticMap(...coordinates)
    } catch (error) {
      mapError = error
      console.warn(`[GEOIP] No se pudo obtener el mapa de ${ip}:`, error?.message || error)
    }

    if (mapImage) {
      const caption = formatGeoDetails(location, ip, '\n© joaking geoip')
      await conn.sendMessage(m.chat, {
        image: mapImage,
        caption
      }, { quoted: m })
    } else {
      await conn.reply(m.chat, formatGeoDetails(location, ip, '\n⚠️ Mapa no disponible.'), m)
    }

    await m.react('✔️')
  } catch (error) {
    console.error('[GEOIP] Error consultando la IP:', error?.stack || error)
    await m.react('✖️')
    await conn.reply(m.chat, `No se pudo consultar la IP: ${error.message}`, m)
  }
}

handler.help = ['geoip <IP pública>']
handler.tags = ['tools']
handler.command = ['geoip']

export default handler

async function lookupIp(ip) {
  const url = new URL(encodeURIComponent(ip), GEOIP_ENDPOINT)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`El servicio GeoIP respondió HTTP ${response.status}.`)

  const result = await response.json()
  if (!result || result.success !== true) {
    throw new Error(result?.message || 'El servicio GeoIP no encontró información para esa IP.')
  }
  return result
}

function getCoordinates(location) {
  const latitude = Number(location.latitude)
  const longitude = Number(location.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('El proveedor no devolvió coordenadas válidas para generar el mapa.')
  }
  return [latitude, longitude]
}

async function fetchStaticMap(latitude, longitude) {
  const zoom = 11
  const tileCount = 2 ** zoom
  const mapWidth = 640
  const mapHeight = 400
  const maxLatitude = 85.05112878
  const clampedLatitude = Math.max(-maxLatitude, Math.min(maxLatitude, latitude))
  const worldX = ((longitude + 180) / 360) * tileCount * 256
  const radians = clampedLatitude * Math.PI / 180
  const projectedY = ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * tileCount * 256
  const worldY = Math.max(mapHeight / 2, Math.min(tileCount * 256 - mapHeight / 2, projectedY))
  const left = Math.floor(worldX - mapWidth / 2)
  const top = Math.floor(worldY - mapHeight / 2)
  const startTileX = Math.floor(left / 256)
  const startTileY = Math.floor(top / 256)
  const offsetX = left - startTileX * 256
  const offsetY = top - startTileY * 256
  const columns = Math.ceil((offsetX + mapWidth) / 256)
  const rows = Math.ceil((offsetY + mapHeight) / 256)
  const tiles = await Promise.all(Array.from({ length: columns * rows }, async (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = ((startTileX + column) % tileCount + tileCount) % tileCount
    const y = startTileY + row
    if (y < 0 || y >= tileCount) throw new Error('La ubicación está fuera de la cobertura del mapa.')
    return fetchMapTile(zoom, x, y)
  }))

  const mosaic = new Jimp(columns * 256, rows * 256, 0xffffffff)
  for (let index = 0; index < tiles.length; index++) {
    const tile = await Jimp.read(tiles[index])
    if (tile.bitmap.width !== 256 || tile.bitmap.height !== 256) {
      throw new Error('El servidor de mapas devolvió un mosaico de tamaño inesperado.')
    }
    mosaic.composite(tile, (index % columns) * 256, Math.floor(index / columns) * 256)
  }

  const map = mosaic.crop(offsetX, offsetY, mapWidth, mapHeight)
  drawMapMarker(map, mapWidth / 2, mapHeight / 2)
  const image = await map.getBufferAsync(Jimp.MIME_PNG)
  if (!image.length || image.length > MAX_MAP_BYTES) throw new Error('El mapa generado supera el tamaño permitido.')
  return image
}

async function fetchMapTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`
  const cached = tileCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.image
  if (cached) tileCache.delete(key)

  const response = await fetch(`https://tile.openstreetmap.org/${key}.png`, {
    headers: { Accept: 'image/png', 'User-Agent': 'JOA-KING WhatsApp bot' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`El servidor de mapas respondió HTTP ${response.status}.`)

  const contentType = response.headers.get('content-type') || ''
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (!contentType.toLowerCase().startsWith('image/png')) {
    throw new Error(`El servidor de mapas devolvió un contenido inesperado: ${contentType || 'desconocido'}.`)
  }
  if (contentLength > MAX_TILE_BYTES) throw new Error('Un mosaico del mapa supera el tamaño permitido.')

  const image = await readResponseBuffer(response, MAX_TILE_BYTES)
  if (!image.length) {
    throw new Error('Un mosaico del mapa está vacío o supera el tamaño permitido.')
  }

  const cacheControl = response.headers.get('cache-control') || ''
  if (!/\b(?:no-cache|no-store)\b/i.test(cacheControl)) {
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300)
    tileCache.set(key, { image, expiresAt: Date.now() + maxAge * 1000 })
    while (tileCache.size > 128) tileCache.delete(tileCache.keys().next().value)
  }
  return image
}

async function readResponseBuffer(response, maxBytes) {
  if (!response.body) throw new Error('El servidor devolvió una respuesta sin imagen.')
  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      throw new Error('La respuesta del mapa supera el tamaño permitido.')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, totalBytes)
}

function drawMapMarker(image, centerX, centerY) {
  const white = Jimp.rgbaToInt(255, 255, 255, 255)
  const red = Jimp.rgbaToInt(220, 38, 38, 255)
  const darkRed = Jimp.rgbaToInt(153, 27, 27, 255)
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y) => {
    const dx = x - centerX
    const dy = y - centerY
    const distance = dx * dx + dy * dy
    if (distance <= 12 * 12) image.setPixelColor(white, x, y)
    if (distance <= 9 * 9) image.setPixelColor(darkRed, x, y)
    if (distance <= 7 * 7) image.setPixelColor(red, x, y)
    if (distance <= 2 * 2) image.setPixelColor(white, x, y)
  })
}

function formatGeoDetails(location, requestedIp, ending = '') {
  const labels = {
    ip: 'IP',
    type: 'Tipo',
    continent: 'Continente',
    continent_code: 'Cód. continente',
    country: 'País',
    country_code: 'Cód. país',
    is_eu: 'UE',
    region: 'Región/provincia',
    region_code: 'Cód. región',
    city: 'Ciudad',
    latitude: 'Lat. aprox.',
    longitude: 'Lon. aprox.',
    postal: 'C.P. aprox.',
    calling_code: 'Prefijo país',
    capital: 'Capital',
    borders: 'Fronteras',
    emoji: 'Bandera',
    asn: 'ASN',
    org: 'Organización',
    isp: 'Proveedor/ISP',
    domain: 'Dominio del proveedor',
    id: 'Zona horaria',
    abbr: 'Abrev. zona',
    is_dst: 'Horario verano',
    offset: 'UTC (seg.)',
    utc: 'UTC',
    current_time: 'Hora local',
    name: 'Nombre',
    code: 'Código',
    symbol: 'Símbolo',
    phone: 'Prefijo tel.'
  }
  const rows = []
  const visit = (value, path = []) => {
    if (value == null || value === '') return
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (!['readme', 'img', 'emoji_unicode', 'success'].includes(key)) visit(child, [...path, key])
      }
      return
    }

    const key = path[path.length - 1] || 'dato'
    const label = labels[key] || path.map(part => part.replaceAll('_', ' ')).join('/')
    const displayValue = Array.isArray(value)
      ? value.join(', ')
      : typeof value === 'boolean'
        ? (value ? 'Sí' : 'No')
        : String(value)
    rows.push(`• ${label}: ${displayValue}`)
  }

  visit(location)
  if (!rows.some(row => row.startsWith('• IP:'))) rows.unshift(`• IP: ${requestedIp}`)

  const header = '🌐 GEOIP · UBICACIÓN APROXIMADA\nNo es una dirección exacta ni GPS.\n'
  const footer = '\n… datos omitidos por el límite del pie de foto.'
  const maxRowsLength = MAX_CAPTION_LENGTH - header.length - ending.length - footer.length
  let body = ''
  for (const row of rows) {
    const next = `${body ? '\n' : ''}${row}`
    if (body.length + next.length > maxRowsLength) break
    body += next
  }
  const omitted = rows.slice(body ? body.split('\n').length : 0).length > 0
  return `${header}${body}${omitted ? footer : ''}${ending}`
}

function isPublicIp(ip) {
  const version = isIP(ip)
  if (version === 4) {
    const octets = ip.split('.').map(Number)
    const address = octets.reduce((value, octet) => value * 256 + octet, 0)
    const reservedRanges = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
      ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ]
    return !reservedRanges.some(([network, prefix]) => {
      const base = network.split('.').map(Number).reduce((value, octet) => value * 256 + octet, 0)
      const mask = (0xffffffff << (32 - prefix)) >>> 0
      return (address & mask) === (base & mask)
    })
  }

  if (version === 6) {
    const address = parseIpv6(ip)
    if (address === null || !inIpv6Range(address, '2000::', 3)) return false
    return ![
      ['2001::', 23],
      ['2001:db8::', 32],
      ['3fff::', 20]
    ].some(([network, prefix]) => inIpv6Range(address, network, prefix))
  }

  return false
}

function parseIpv6(ip) {
  let address = ip.toLowerCase()
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const octets = address.slice(lastColon + 1).split('.').map(Number)
    if (octets.length !== 4 || octets.some(octet => octet < 0 || octet > 255)) return null
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    address = `${address.slice(0, lastColon)}:${high}:${low}`
  }

  const halves = address.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const words = [...left, ...Array(missing).fill('0'), ...right]
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null
  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n)
}

function inIpv6Range(address, network, prefix) {
  const base = parseIpv6(network)
  if (base === null) return false
  const shift = BigInt(128 - prefix)
  return (address >> shift) === (base >> shift)
}

import net from 'node:net'
import dns from 'node:dns/promises'

const STATUS_TIMEOUT_MS = 5000
const COOLDOWN_MS = 15000
const lastQueryByChat = new Map()

function writeVarInt(value) {
  const bytes = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining !== 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining !== 0)
  return Buffer.from(bytes)
}

function readVarInt(buffer, offset = 0) {
  let value = 0
  let position = 0
  let byte
  do {
    if (position > 28) throw new Error('Paquete Minecraft inválido')
    if (offset >= buffer.length) return null
    byte = buffer[offset++]
    value |= (byte & 0x7f) << position
    position += 7
  } while (byte & 0x80)
  return { value, offset }
}

function packet(payload) {
  return Buffer.concat([writeVarInt(payload.length), payload])
}

async function resolveAddress(rawAddress) {
  const serverAddress = String(rawAddress || '').trim().toLowerCase().replace(/\.$/, '')
  let host = serverAddress
  if (!host || host.length > 253 || /[^a-z0-9.-]/.test(host) || host.includes('..')) throw new Error('Dirección inválida')

  let port = Number(process.env.ATERNOS_SERVER_PORT) || 25565
  const srvRecords = await dns.resolveSrv(`_minecraft._tcp.${host}`).catch(() => [])
  if (srvRecords.length) {
    srvRecords.sort((a, b) => a.priority - b.priority || b.weight - a.weight)
    host = srvRecords[0].name.replace(/\.$/, '')
    port = srvRecords[0].port
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto inválido')
  return { host, port, serverAddress }
}

function queryJavaServer(host, port, serverAddress) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const chunks = []
    let totalLength = 0
    let done = false

    const finish = (error, result) => {
      if (done) return
      done = true
      socket.destroy()
      error ? reject(error) : resolve(result)
    }

    socket.setTimeout(STATUS_TIMEOUT_MS, () => finish(new Error('Tiempo de espera agotado')))
    socket.on('error', error => finish(error))
    socket.on('connect', () => {
      const address = Buffer.from(serverAddress, 'utf8')
      const handshake = Buffer.concat([
        writeVarInt(0),
        writeVarInt(47),
        writeVarInt(address.length), address,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1)
      ])
      socket.write(Buffer.concat([packet(handshake), packet(writeVarInt(0))]))
    })
    socket.on('data', chunk => {
      chunks.push(chunk)
      totalLength += chunk.length
      if (totalLength > 65536) return finish(new Error('Respuesta demasiado grande'))
      const response = Buffer.concat(chunks, totalLength)
      try {
        const frame = readVarInt(response)
        if (!frame) return
        if (response.length < frame.offset + frame.value) return
        const packetId = readVarInt(response, frame.offset)
        if (!packetId) return
        if (packetId.value !== 0) throw new Error('Respuesta Minecraft inesperada')
        const jsonLength = readVarInt(response, packetId.offset)
        if (!jsonLength) return
        const start = jsonLength.offset
        if (start + jsonLength.value > frame.offset + frame.value) return
        const status = JSON.parse(response.subarray(start, start + jsonLength.value).toString('utf8'))
        finish(null, status)
      } catch (error) {
        if (error instanceof SyntaxError) return
        finish(error)
      }
    })
  })
}

const handler = async (m, { conn, command, args, usedPrefix, chat, isOwner }) => {
  const isToggle = command === 'on'
  if (isToggle && String(args[0] || '').toLowerCase() !== 'aternos') return

  if (isToggle) {
    if (!m.isGroup) return conn.reply(m.chat, 'Este ajuste solo se puede hacer dentro de un grupo.', m)
    if (!isOwner) return conn.reply(m.chat, 'Solo el owner del bot puede habilitar el comando de estado de Aternos.', m)
    chat.aternosStatusEnabled = true
    await global.db.write?.()
    return conn.reply(m.chat, 'Listo, el comando de estado de Aternos quedó habilitado para este grupo. Todos pueden usarlo con *%aternos*.', m)
  }

  if (!m.isGroup) return conn.reply(m.chat, 'Este comando está disponible en grupos donde el owner lo haya habilitado.', m)
  if (!chat?.aternosStatusEnabled) return conn.reply(m.chat, `El owner todavía no habilitó este comando. Puede hacerlo con *${usedPrefix}on aternos*.`, m)

  const address = process.env.ATERNOS_SERVER_ADDRESS
  if (!address) return conn.reply(m.chat, 'Falta configurar ATERNOS_SERVER_ADDRESS en el archivo .env con la dirección pública del servidor Minecraft.', m)

  const now = Date.now()
  const lastQueryAt = lastQueryByChat.get(m.chat) || 0
  if (now - lastQueryAt < COOLDOWN_MS) {
    const seconds = Math.ceil((COOLDOWN_MS - (now - lastQueryAt)) / 1000)
    return conn.reply(m.chat, `Espera ${seconds} segundos antes de volver a consultar el estado.`, m)
  }
  lastQueryByChat.set(m.chat, now)
  await conn.reply(m.chat, 'Consultando el estado del servidor…', m)

  try {
    const endpoint = await resolveAddress(address)
    const status = await queryJavaServer(endpoint.host, endpoint.port, endpoint.serverAddress)
    const online = Number(status?.players?.online) || 0
    const max = Number(status?.players?.max)
    const sample = Array.isArray(status?.players?.sample) ? status.players.sample : []
    const names = sample.map(player => String(player?.name || '').replace(/[\r\n]/g, '').slice(0, 32)).filter(Boolean)
    const playerList = names.length
      ? `\n\n*En línea:*\n${names.map(name => `• ${name}`).join('\n')}`
      : online > 0 ? '\n\nEl servidor no publica los nombres de los jugadores.' : ''
    const count = Number.isFinite(max) ? `${online}/${max}` : String(online)
    return conn.reply(m.chat, `🟢 *Servidor en línea*\nJugadores: *${count}*${playerList}`, m)
  } catch {
    return conn.reply(m.chat, '🔴 El servidor no responde ahora. Puede estar apagado, iniciándose o la dirección configurada no ser correcta.', m)
  }
}

handler.help = ['aternos', 'on aternos']
handler.tags = ['tools']
handler.command = ['aternos', /^on$/]

export default handler

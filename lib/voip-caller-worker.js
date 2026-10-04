import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { unlink } from 'node:fs/promises'
import { URL } from 'node:url'
import { VoipClient } from 'baileys-caller'

const authDir = process.env.BAILEYS_CALLER_AUTH_DIR
if (!authDir) throw new Error('BAILEYS_CALLER_AUTH_DIR no está configurado.')

const SAMPLE_RATE = 48_000
const FRAME_BYTES = SAMPLE_RATE * 2 / 50
const FRAMES_PER_WRITE = 5
const FRAME_INTERVAL_MS = 100
const MAX_QUEUE_SIZE = 8
const MAX_BUFFERED_AUDIO_BYTES = SAMPLE_RATE * 2 * 20
const LOW_BUFFERED_AUDIO_BYTES = SAMPLE_RATE * 2 * 10

const client = new VoipClient({ authDir })
let connected = false
let activeCall = null
let groupPlaybackActive = false
let groupPlaybackCallId = null
let activeAudioCleanupPath = null
let audioResponse = null
let currentTrack = null
let currentTrackProcess = null
let currentTrackEnded = false
let currentPcm = Buffer.alloc(0)
let queuedTracks = []
let playbackPaused = false
let volume = 100
let playbackTimer = null

const send = (message) => {
  if (typeof process.send === 'function' && process.connected) process.send(message)
}

const cleanupAudio = async () => {
  const filePath = activeAudioCleanupPath
  activeAudioCleanupPath = null
  if (filePath) await unlink(filePath).catch(() => {})
}

const wavHeader = () => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(0xffffffff, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(0xffffffff, 40)
  return header
}

const audioServer = createServer((request, response) => {
  if (request.url !== '/stream') {
    response.writeHead(404).end()
    return
  }

  if (audioResponse && !audioResponse.destroyed) audioResponse.end()
  audioResponse = response
  response.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  response.write(wavHeader())
  response.on('close', () => {
    if (audioResponse === response) audioResponse = null
  })
})

const audioSourceReady = new Promise((resolve, reject) => {
  audioServer.once('error', reject)
  audioServer.listen(0, '127.0.0.1', () => {
    audioServer.off('error', reject)
    const address = audioServer.address()
    if (!address || typeof address === 'string') {
      reject(new Error('No se pudo iniciar el servidor de audio local.'))
      return
    }
    const audioSource = `http://127.0.0.1:${address.port}/stream`
    send({ type: 'audio-ready', audioSource })
    resolve(audioSource)
  })
})
audioSourceReady.catch(() => {})

const startNextTrack = () => {
  if ((!activeCall && !groupPlaybackActive) || currentTrack || !queuedTracks.length) return

  currentTrack = queuedTracks.shift()
  currentTrackEnded = false
  currentPcm = Buffer.alloc(0)
  send({
    type: 'track-started',
    title: currentTrack.title,
    queueLength: queuedTracks.length
  })

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-i', currentTrack.audioSource,
    '-vn',
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    'pipe:1'
  ], { windowsHide: true })
  currentTrackProcess = ffmpeg

  ffmpeg.stdout.on('data', (chunk) => {
    if (currentTrackProcess !== ffmpeg) return
    currentPcm = Buffer.concat([currentPcm, chunk])
    if (currentPcm.length >= MAX_BUFFERED_AUDIO_BYTES) ffmpeg.stdout.pause()
  })
  ffmpeg.stderr.on('data', (chunk) => {
    const detail = chunk.toString().trim()
    if (detail) console.error(`[CALLER-AUDIO] ffmpeg: ${detail}`)
  })
  ffmpeg.on('error', (error) => {
    if (currentTrackProcess !== ffmpeg) return
    currentTrackEnded = true
    send({ type: 'track-error', title: currentTrack?.title, message: error.message })
  })
  ffmpeg.on('close', (code, signal) => {
    if (currentTrackProcess !== ffmpeg) return
    currentTrackProcess = null
    currentTrackEnded = true
    if (code !== 0 && code !== null) {
      send({
        type: 'track-error',
        title: currentTrack?.title,
        message: `ffmpeg terminó con código ${code}${signal ? ` (${signal})` : ''}.`
      })
    }
  })
}

const finishCurrentTrack = () => {
  currentTrack = null
  currentTrackEnded = false
  currentPcm = Buffer.alloc(0)
  currentTrackProcess = null
  startNextTrack()
}

const takePcmFrame = () => {
  if (currentPcm.length >= FRAME_BYTES) {
    const frame = currentPcm.subarray(0, FRAME_BYTES)
    currentPcm = currentPcm.subarray(FRAME_BYTES)
    if (currentTrackProcess && currentTrackProcess.stdout.isPaused() && currentPcm.length <= LOW_BUFFERED_AUDIO_BYTES) {
      currentTrackProcess.stdout.resume()
    }
    return frame
  }

  if (currentTrackEnded && currentPcm.length) {
    const frame = Buffer.alloc(FRAME_BYTES)
    currentPcm.copy(frame)
    currentPcm = Buffer.alloc(0)
    return frame
  }
  return null
}

const applyVolume = (frame) => {
  if (volume === 100) return frame
  const scaled = Buffer.from(frame)
  const gain = volume / 100
  for (let offset = 0; offset < scaled.length; offset += 2) {
    const sample = Math.round(scaled.readInt16LE(offset) * gain)
    scaled.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset)
  }
  return scaled
}

const pumpAudio = () => {
  if (!audioResponse || audioResponse.destroyed || !audioResponse.writable || audioResponse.writableNeedDrain) return

  const output = Buffer.alloc(FRAME_BYTES * FRAMES_PER_WRITE)
  for (let index = 0; index < FRAMES_PER_WRITE; index += 1) {
    let frame = null
    if (!playbackPaused && (activeCall || groupPlaybackActive)) {
      startNextTrack()
      frame = takePcmFrame()
      if (!frame && currentTrackEnded) finishCurrentTrack()
    }
    if (frame) frame.copy(output, index * FRAME_BYTES)
  }

  audioResponse.write(applyVolume(output))
}

const stopPlayback = () => {
  queuedTracks = []
  if (currentTrackProcess) {
    const processToStop = currentTrackProcess
    currentTrackProcess = null
    processToStop.kill()
  }
  currentTrack = null
  currentTrackEnded = false
  currentPcm = Buffer.alloc(0)
  playbackPaused = false
  send({ type: 'playback-stopped' })
}

const reportPlaybackState = () => send({
  type: 'playback-state',
  current: currentTrack?.title || null,
  queue: queuedTracks.map((track) => track.title),
  paused: playbackPaused,
  volume
})

const reportState = (call, state) => {
  if (call.__callerReportedState === state) return
  call.__callerReportedState = state
  send({ type: 'call-state', callId: call.callId, state })
}

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return

  if (message.type === 'call') {
    if (!connected) return send({ type: 'error', message: 'La sesión caller todavía no está conectada.' })
    if (activeCall) return send({ type: 'error', message: 'Ya hay una llamada activa.' })

    const phoneNumber = String(message.phoneNumber || '').replace(/\D/g, '')
    if (!/^\d{8,15}$/.test(phoneNumber)) return send({ type: 'error', message: 'Número inválido; usa formato internacional con código de país.' })
    activeAudioCleanupPath = typeof message.cleanupAudioPath === 'string' ? message.cleanupAudioPath : null

    try {
      const audioSource = await audioSourceReady
      const call = await client.call(phoneNumber, { audioSource, durationMs: 0 })
      activeCall = call
      call.on('ringing', () => reportState(call, 'ringing'))
      call.on('connected', () => reportState(call, 'connected'))
      call.on('ended', (reason) => {
        send({ type: 'call-ended', callId: call.callId, reason: String(reason || 'ended') })
        if (activeCall === call) activeCall = null
        stopPlayback()
        void cleanupAudio()
      })
      call.on('error', (error) => send({ type: 'error', message: error?.message || String(error) }))

      if (typeof message.initialAudioSource === 'string' && message.initialAudioSource && message.initialAudioSource !== 'silence') {
        queuedTracks.push({ title: 'Audio inicial', audioSource: message.initialAudioSource })
      }

      send({ type: 'call-started', callId: call.callId, phoneNumber, audioMode: 'stream' })
      if (call.state === 2) reportState(call, 'ringing')
      if (call.state === 6) reportState(call, 'connected')
      reportPlaybackState()
    } catch (error) {
      activeCall = null
      send({ type: 'error', message: error?.message || String(error), callSetupFailed: true })
      stopPlayback()
      await cleanupAudio()
    }
    return
  }

  if (message.type === 'queue-track') {
    if (!activeCall && !groupPlaybackActive) return send({ type: 'error', message: 'No hay una llamada activa para reproducir música.' })
    if (queuedTracks.length >= MAX_QUEUE_SIZE) {
      return send({ type: 'error', message: `La cola está llena (máximo ${MAX_QUEUE_SIZE} canciones pendientes).` })
    }
    if (typeof message.audioSource !== 'string' || !message.audioSource) {
      return send({ type: 'error', message: 'No se recibió una fuente de audio válida.' })
    }
    queuedTracks.push({ title: String(message.title || 'Canción'), audioSource: message.audioSource })
    send({ type: 'track-queued', title: String(message.title || 'Canción'), queueLength: queuedTracks.length })
    startNextTrack()
    return
  }

  if (message.type === 'group-playback-start') {
    if (activeCall) return send({ type: 'error', message: 'No se puede iniciar una llamada grupal mientras hay una llamada directa en Caller.' })
    if (typeof message.callId !== 'string' || !message.callId) {
      return send({ type: 'error', message: 'Falta el identificador de la llamada grupal.' })
    }
    groupPlaybackActive = true
    groupPlaybackCallId = message.callId
    send({ type: 'group-playback-ready', callId: groupPlaybackCallId })
    startNextTrack()
    return
  }

  if (message.type === 'group-playback-stop') {
    if (!groupPlaybackActive || (message.callId && message.callId !== groupPlaybackCallId)) return
    groupPlaybackActive = false
    groupPlaybackCallId = null
    stopPlayback()
    return
  }

  if (message.type === 'pause' || message.type === 'resume' || message.type === 'skip' || message.type === 'clear-queue' || message.type === 'queue' || message.type === 'volume') {
    if (!activeCall && !groupPlaybackActive) return send({ type: 'error', message: 'No hay una llamada activa.' })

    if (message.type === 'pause') {
      playbackPaused = true
      send({ type: 'playback-paused' })
    } else if (message.type === 'resume') {
      playbackPaused = false
      send({ type: 'playback-resumed' })
    } else if (message.type === 'skip') {
      if (!currentTrack && !queuedTracks.length) return send({ type: 'error', message: 'No hay canciones para saltar.' })
      if (currentTrackProcess) {
        const processToStop = currentTrackProcess
        currentTrackProcess = null
        processToStop.kill()
      }
      currentTrack = null
      currentTrackEnded = false
      currentPcm = Buffer.alloc(0)
      startNextTrack()
      reportPlaybackState()
    } else if (message.type === 'clear-queue') {
      queuedTracks = []
      send({ type: 'queue-cleared' })
    } else if (message.type === 'queue') {
      reportPlaybackState()
    } else {
      const requestedVolume = Number(message.volume)
      if (!Number.isInteger(requestedVolume) || requestedVolume < 0 || requestedVolume > 100) {
        return send({ type: 'error', message: 'El volumen debe ser un número entero entre 0 y 100.' })
      }
      volume = requestedVolume
      send({ type: 'volume-set', volume })
    }
    return
  }

  if (message.type === 'hangup') {
    if (!activeCall) return send({ type: 'error', message: 'No hay una llamada activa.' })
    activeCall.end()
    return
  }

  if (message.type === 'status') {
    send({
      type: 'status',
      connected,
      callId: activeCall?.callId || groupPlaybackCallId,
      callState: activeCall?.state ?? (groupPlaybackActive ? 'group' : null)
    })
    if (activeCall) reportPlaybackState()
    return
  }

  if (message.type === 'disconnect') {
    activeCall?.end()
    stopPlayback()
    client.disconnect()
    await cleanupAudio()
    audioServer.close()
    process.exit(0)
  }
})

playbackTimer = setInterval(pumpAudio, FRAME_INTERVAL_MS)

client.connect().then(() => {
  connected = true
  send({ type: 'ready', authDir })
}).catch((error) => {
  send({
    type: 'fatal',
    message: error?.message || String(error),
    code: error?.output?.statusCode ?? error?.statusCode ?? error?.code ?? null,
    reason: error?.data?.reason ?? error?.data?.attrs?.reason ?? null,
    stack: error?.stack || null
  })
  client.disconnect()
  if (playbackTimer) clearInterval(playbackTimer)
  if (audioServer.listening) audioServer.close()
  process.exitCode = 1
})

process.on('disconnect', () => {
  if (playbackTimer) clearInterval(playbackTimer)
  activeCall?.end()
  stopPlayback()
  client.disconnect()
  if (audioServer.listening) audioServer.close()
  void cleanupAudio()
})

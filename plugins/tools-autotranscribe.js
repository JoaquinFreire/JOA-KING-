import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { createInterface } from 'readline'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const workerPath = fileURLToPath(new URL('../lib/autotranscribe_worker.py', import.meta.url))
const virtualEnvPython = fileURLToPath(new URL(`../.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, import.meta.url))
const audioDirectory = join(tmpdir(), 'joa-king-transcription')
const pendingRequests = new Map()
const handledMessages = new Set()
let worker
let nextRequestId = 0

function failWorker(child, error) {
  if (worker === child) worker = null
  for (const [id, request] of pendingRequests) {
    clearTimeout(request.timeout)
    request.reject(error)
    pendingRequests.delete(id)
  }
}

function getWorker() {
  if (worker && !worker.killed) return worker

  const python = process.env.PYTHON || (existsSync(virtualEnvPython) ? virtualEnvPython : process.platform === 'win32' ? 'python' : 'python3')
  const child = spawn(python, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  worker = child

  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let result
    try {
      result = JSON.parse(line)
    } catch (error) {
      console.error('[AUTO-TRANSCRIBE] Respuesta inválida del worker:', line.slice(0, 300))
      return
    }
    const request = pendingRequests.get(result.id)
    if (!request) return
    clearTimeout(request.timeout)
    pendingRequests.delete(result.id)
    if (result.error) request.reject(new Error(result.error))
    else request.resolve(result)
  })

  child.stderr.on('data', data => {
    console.error('[AUTO-TRANSCRIBE] Whisper:', data.toString().trim().slice(0, 1000))
  })
  child.on('error', error => failWorker(child, error))
  child.on('exit', (code, signal) => {
    failWorker(child, new Error(`El worker de transcripción terminó (${code ?? signal ?? 'desconocido'}).`))
  })

  return child
}

function sendWorkerRequest(payload, timeoutMs = 300000) {
  const child = getWorker()
  const id = String(++nextRequestId)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      child.kill()
      reject(new Error('La transcripción superó el tiempo límite.'))
    }, timeoutMs)
    pendingRequests.set(id, { resolve, reject, timeout })
    child.stdin.write(JSON.stringify({ ...payload, id }) + '\n', error => {
      if (!error) return
      clearTimeout(timeout)
      pendingRequests.delete(id)
      reject(error)
    })
  })
}

export async function warmUpTranscription() {
  await sendWorkerRequest({ warmup: true }, 300000)
}

async function transcribeAudio(buffer) {
  await mkdir(audioDirectory, { recursive: true })
  const audioPath = join(audioDirectory, `${randomUUID()}.ogg`)
  await writeFile(audioPath, buffer)

  try {
    const result = await sendWorkerRequest({ path: audioPath })
    return result.text
  } finally {
    await unlink(audioPath).catch(() => {})
  }
}

function transcriptionFailure(error) {
  const detail = String(error?.message || error)
  if (/No module named ['"]?faster_whisper/.test(detail)) {
    return 'Falta instalar faster-whisper: python -m pip install -r requirements-transcription.txt'
  }
  if (/huggingface|download|connection|network/i.test(detail)) {
    return 'Whisper no pudo descargar su modelo inicial. Conecta el bot a Internet y vuelve a enviar la nota.'
  }
  return `No se pudo transcribir esta nota de voz: ${detail.slice(0, 240)}`
}

const handler = () => {}

handler.before = async function (m, { conn, chat }) {
  if (!chat?.autoTranscribe || m.fromMe || m.mtype !== 'audioMessage' || m.msg?.ptt !== true) return

  const messageId = m.key?.id || m.id
  if (messageId && handledMessages.has(messageId)) return
  if (messageId) {
    handledMessages.add(messageId)
    if (handledMessages.size > 500) handledMessages.delete(handledMessages.values().next().value)
  }

  void (async () => {
    try {
      const audio = await m.download()
      if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error('Baileys no descargó el audio.')
      const text = (await transcribeAudio(audio)).trim()
      if (!text) {
        await conn.reply(m.chat, 'No detecté palabras en esta nota de voz.', m)
        return
      }
      await conn.reply(m.chat, `📝 Transcripción:\n${text}`, m)
    } catch (error) {
      console.error('[AUTO-TRANSCRIBE] Error:', error?.stack || error)
      await conn.reply(m.chat, transcriptionFailure(error), m).catch(() => {})
    }
  })()

  return true
}

handler.help = ['on autotranscribe', 'off autotranscribe']
handler.tags = ['tools']
handler.command = []

export default handler
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import fetch from 'node-fetch'

const voiceName = 'es_AR-daniela-high'
const voiceUrl = `https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/${voiceName}.onnx`
const voiceDirectory = fileURLToPath(new URL('../tmp/piper-voices/', import.meta.url))
const virtualEnvPython = fileURLToPath(new URL(`../.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, import.meta.url))
const pendingDownloads = new Map()

function getPythonExecutable() {
  return process.env.PIPER_PYTHON ||
    process.env.PYTHON ||
    (existsSync(virtualEnvPython) ? virtualEnvPython : process.platform === 'win32' ? 'python' : 'python3')
}

async function downloadFile(targetPath, url, minimumSize) {
  await mkdir(voiceDirectory, { recursive: true })
  try {
    const existing = await stat(targetPath)
    if (existing.isFile() && existing.size >= minimumSize) return
    await rm(targetPath, { force: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const partialPath = `${targetPath}.${randomUUID()}.part`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) })
    if (!response.ok || !response.body) {
      throw new Error(`Descarga del modelo Piper falló con HTTP ${response.status}.`)
    }
    await pipeline(response.body, createWriteStream(partialPath, { flags: 'wx' }))
    const downloaded = await stat(partialPath)
    if (downloaded.size < minimumSize) {
      throw new Error(`Descarga incompleta del modelo Piper (${downloaded.size} bytes).`)
    }

    try {
      await rename(partialPath, targetPath)
    } catch (error) {
      const existing = await stat(targetPath).catch(() => null)
      if (!existing?.isFile() || existing.size < minimumSize) throw error
    }
  } finally {
    await rm(partialPath, { force: true })
  }
}

function ensureCachedFile(targetPath, url, minimumSize) {
  let pending = pendingDownloads.get(targetPath)
  if (!pending) {
    pending = downloadFile(targetPath, url, minimumSize).finally(() => pendingDownloads.delete(targetPath))
    pendingDownloads.set(targetPath, pending)
  }
  return pending
}

async function ensureVoiceModel() {
  const modelPath = path.join(voiceDirectory, `${voiceName}.onnx`)
  const configPath = `${modelPath}.json`
  await Promise.all([
    ensureCachedFile(modelPath, voiceUrl, 1024 * 1024),
    ensureCachedFile(configPath, `${voiceUrl}.json`, 1)
  ])
  return { modelPath, configPath }
}

export async function generateArgentinianVoice(text, outputPath) {
  const { modelPath, configPath } = await ensureVoiceModel()
  await new Promise((resolve, reject) => {
    const child = spawn(getPythonExecutable(), [
      '-m', 'piper',
      '--model', modelPath,
      '--config', configPath,
      '--output_file', outputPath
    ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('Piper superó el tiempo límite de generación.'))
    }, 180000)

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    }

    child.stderr.on('data', data => {
      stderr = `${stderr}${data.toString()}`.slice(-3000)
    })
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') finish(error)
    })
    child.on('error', finish)
    child.on('close', (code, signal) => {
      if (code !== 0) {
        finish(new Error(`Piper terminó con código ${code ?? signal ?? 'desconocido'}: ${stderr.trim()}`))
        return
      }
      finish()
    })
    child.stdin.end(text)
  })

  const audio = await stat(outputPath)
  if (!audio.isFile() || audio.size <= 44) throw new Error('Piper no generó un WAV válido.')
}

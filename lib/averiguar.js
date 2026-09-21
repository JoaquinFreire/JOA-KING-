import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptFile = path.join(projectDir, 'informesnosis', 'nosis_test.py')
const timeoutMs = Number(process.env.AVERIGUAR_TIMEOUT_MS) || 120000

const parseResults = (output) => {
  return output.split(/(?=^\s*#\s*\d+)/m).slice(1).map((block) => {
    const field = (name) => block.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, 'im'))?.[1]?.trim() || ''
    return {
      cuit: field('CUIT'),
      nombre: field('Nombre'),
      actividad: field('Actividad'),
      provincia: field('Provincia')
    }
  }).filter(({ cuit, nombre, actividad, provincia }) => cuit && nombre && actividad && provincia)
}

const runPython = (query, age = '', province = '', locality = '') => new Promise((resolve, reject) => {
  const python = process.env.NOSIS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const child = spawn(python, [scriptFile], {
    cwd: projectDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  let settled = false

  const finish = (callback, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(value)
  }

  const timer = setTimeout(() => {
    child.kill()
    finish(reject, new Error('La consulta tardó demasiado y fue cancelada.'))
  }, timeoutMs)

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.once('error', (error) => finish(reject, new Error(`No se pudo iniciar Python: ${error.message}`)))
  child.once('close', (code) => {
    if (code !== 0) {
      const details = (stderr || stdout).replace(/\s+/g, ' ').trim().slice(-500)
      finish(reject, new Error(details || `El proceso de consulta terminó con código ${code}.`))
      return
    }
    finish(resolve, { stdout, stderr })
  })

  const isCuit = /^\d{2}-?\d{8}-?\d$/.test(query)
  child.stdin.end(isCuit
    ? `\n${query}\n${age}\n${province}\n${locality}\n`
    : `${query}\n\n${age}\n${province}\n${locality}\n`)
})

export const searchRecords = async (query, age = '', province = '', locality = '') => {
  const output = await runPython(query, age, province, locality)
  const results = parseResults(output.stdout)
  const normalizedOutput = output.stdout.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (normalizedOutput.includes('captcha')) {
    throw new Error('El sitio solicitó una verificación CAPTCHA.')
  }

  if (normalizedOutput.includes('unicodeencodeerror') || normalizedOutput.includes('traceback')) {
    throw new Error('El proceso de consulta no pudo procesar la respuesta del sitio.')
  }

  if (!results.length && normalizedOutput.includes('mas de 10 resultados')) {
    throw new Error('La búsqueda tiene más de 10 resultados. Agregá el nombre completo o una provincia.')
  }

  return results
}
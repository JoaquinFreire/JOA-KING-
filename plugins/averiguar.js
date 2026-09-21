import { searchRecords } from '../lib/averiguar.js'

const normalizeQuery = (text) => (text || '').trim().replace(/\s+/g, ' ')
const usageMessage = 'Formato para copiar y completar:\nNombre y apellido: \nEdad (18-25): \nProvincia: \nLocalidad: \n\nTambién podés usar: %averiguar Documento o CUIT | 20-25 | Cordoba |'

const parseInput = (text) => {
  const value = (text || '').trim()
  if (!value) return { query: '', age: '', province: '', locality: '' }

  const labeled = Object.fromEntries(value.split(/\r?\n/).map((line) => {
    const [, label = '', content = ''] = line.match(/^\s*([^:]+):\s*(.*)$/) || []
    return [normalizeQuery(label).toLowerCase(), normalizeQuery(content)]
  }))
  const hasLabels = ['nombre y apellido', 'edad (18-25)', 'provincia', 'localidad'].some((label) => label in labeled)
  if (hasLabels) {
    return {
      query: labeled['nombre y apellido'] || labeled['documento o cuit'] || '',
      age: labeled['edad (18-25)'] || labeled.edad || '',
      province: labeled.provincia || '',
      locality: labeled.localidad || ''
    }
  }

  const [query = '', age = '', province = '', locality = ''] = value.split('|')
  return { query: normalizeQuery(query), age: normalizeQuery(age), province: normalizeQuery(province), locality: normalizeQuery(locality) }
}

const handler = async (m, { conn, text }) => {
  const { query, age, province, locality } = parseInput(text)

  if (!query || query.length < 3 || query.length > 80) {
    return conn.reply(m.chat, usageMessage, m)
  }

  if (global.averiguarRunning) {
    return conn.reply(m.chat, 'Ya hay una consulta en curso. Esperá a que termine e intentá de nuevo.', m)
  }

  global.averiguarRunning = true
  await conn.reply(m.chat, `Buscando: ${query}\nPuede tardar hasta dos minutos...`, m)

  try {
    const results = await searchRecords(query, age, province, locality)
    if (!results.length) {
      return conn.reply(m.chat, 'No se encontraron resultados para esa búsqueda.', m)
    }

    const message = results.slice(0, 10).map((result, index) => [
      `#${index + 1}`,
      `CUIT      : ${result.cuit}`,
      `Nombre    : ${result.nombre}`,
      `Actividad : ${result.actividad}`,
      `Provincia : ${result.provincia}`
    ].join('\n')).join('\n\n')

    return conn.reply(m.chat, message, m)
  } catch (error) {
    console.error('averiguar:', error)
    const reason = error.message.includes('CAPTCHA')
      ? 'El sitio solicitó una verificación de seguridad. Probá nuevamente más tarde.'
      : error.message.includes('más de 10')
        ? 'La búsqueda devuelve más de 10 personas. Completá nombre, edad, provincia o localidad y volvé a intentar.'
      : error.message.includes('Python')
        ? 'No pude iniciar Python. Verificá que Python y Playwright estén instalados en el servidor.'
        : 'No se pudo completar la consulta. Revisá que el sitio esté disponible e intentá nuevamente.'
    return conn.reply(m.chat, reason, m)
  } finally {
    global.averiguarRunning = false
  }
}

handler.help = ['averiguar nombre o CUIT | edad | provincia | localidad']
handler.tags = ['tools']
handler.command = ['averiguar']

export default handler
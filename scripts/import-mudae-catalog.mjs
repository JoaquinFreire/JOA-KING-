import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import {
  MUDAE_CONFIG,
  makeCharacterIdentity,
  normalizeMudaeIdentity,
  normalizeMudaeLabel,
  uploadRemoteMudaeImage,
} from '../plugins/mudae.js'

const dataDirectory = process.env.MUDAE_DATA_DIR || path.join(process.cwd(), 'data', 'mudae')
const catalogFile = process.env.MUDAE_CATALOG_FILE || path.join(dataDirectory, 'catalog.json')
const sourceFile = process.argv[2]
const requestedAlbum = process.argv[3]

const defaultCatalog = () => ({
  version: 1,
  albums: [],
  characters: [],
  deletedCharacterIds: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (fallback !== null && error?.code === 'ENOENT') return fallback
    throw error
  }
}

const writeJsonAtomic = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  data.updatedAt = Date.now()
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await fs.rename(temporaryFile, file)
}

const makeCharacterId = (album, name) => {
  const identity = makeCharacterIdentity(album, name)
  return `catalog-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

const ensureAlbum = (catalog, album) => {
  const normalized = normalizeMudaeLabel(album)
  const existing = catalog.albums.find((item) => normalizeMudaeIdentity(item) === normalizeMudaeIdentity(normalized))
  if (existing) return existing
  catalog.albums.push(normalized)
  return normalized
}

if (!sourceFile) {
  throw new Error('Uso: npm run mudae:import -- <archivo-personajes.json> [álbum]')
}
if (!input.isTTY || !output.isTTY) {
  throw new Error('Este importador necesita una consola interactiva para responder y/n por personaje.')
}

const source = await readJson(path.resolve(sourceFile))
if (!Array.isArray(source)) {
  throw new Error(`El archivo ${sourceFile} debe ser un array de personajes.`)
}

const fallbackAlbum = path.basename(sourceFile, path.extname(sourceFile)).replace(/[-_]+/g, ' ').replace(/^dragon\s*ball$/i, 'Dragon Ball')
const album = normalizeMudaeLabel(requestedAlbum || fallbackAlbum)
if (!album) throw new Error('Indica el nombre del álbum como segundo argumento.')

const catalog = {
  ...defaultCatalog(),
  ...await readJson(catalogFile, defaultCatalog()),
}
catalog.albums = Array.isArray(catalog.albums) ? catalog.albums.map(normalizeMudaeLabel).filter(Boolean) : []
catalog.characters = Array.isArray(catalog.characters) ? catalog.characters : []
catalog.deletedCharacterIds = Array.isArray(catalog.deletedCharacterIds) ? catalog.deletedCharacterIds : []

let imported = 0
let skipped = 0
let failed = 0
const prompt = readline.createInterface({ input, output })

console.log(`Álbum de destino para todos los personajes: ${album}`)

try {
  for (const [index, item] of source.entries()) {
    const name = normalizeMudaeLabel(item.nombre || item.name)
    const sourceImage = String(item.imagen || item.imageUrl || '').trim()
    if (!name || !sourceImage) {
      skipped += 1
      console.warn(`[${index + 1}/${source.length}] Omitido por datos incompletos.`)
      continue
    }

    console.log(`\n[${index + 1}/${source.length}] ${name}\nImagen: ${sourceImage}`)
    let answer = ''
    while (!['y', 'n'].includes(answer)) {
      answer = (await prompt.question('¿Agregar este personaje? [y/n] ')).trim().toLocaleLowerCase('es')
      if (!['y', 'n'].includes(answer)) console.log('Responde y o n.')
    }
    if (answer === 'n') {
      skipped += 1
      continue
    }

    const suggestedName = normalizeMudaeLabel(await prompt.question(`Nombre del personaje (Enter conserva "${name}"): `))
    const finalName = suggestedName || name
    if (catalog.characters.some((character) =>
      normalizeMudaeIdentity(character.name) === normalizeMudaeIdentity(finalName)
    )) {
      skipped += 1
      console.log(`Ya existe un personaje llamado "${finalName}" en el catálogo; omitido.`)
      continue
    }

    const id = makeCharacterId(album, finalName)
    if (catalog.deletedCharacterIds.includes(id)) {
      skipped += 1
      console.log(`"${finalName}" ya fue eliminado del catálogo; omitido.`)
      continue
    }

    try {
      const normalizedAlbum = ensureAlbum(catalog, album)
      const uploadKey = `${makeCharacterIdentity(normalizedAlbum, finalName)}\n${sourceImage}`
      const uploaded = await uploadRemoteMudaeImage(sourceImage, uploadKey)
      catalog.characters.push({
        id,
        name: finalName,
        album: normalizedAlbum,
        value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
        imageUrl: uploaded.imageUrl,
        cloudinaryPublicId: uploaded.cloudinaryPublicId,
        createdAt: Date.now(),
      })
      await writeJsonAtomic(catalogFile, catalog)
      imported += 1
      console.log(`Agregado como "${finalName}" con imagen propia: ${uploaded.imageUrl}`)
    } catch (error) {
      failed += 1
      console.error(`No se pudo agregar ${finalName}: ${error?.message || error}`)
    }
  }
} finally {
  prompt.close()
}

console.log(`\nListo. Agregados ${imported}; omitidos ${skipped}; fallidos ${failed}; total en catálogo ${catalog.characters.length}.`)

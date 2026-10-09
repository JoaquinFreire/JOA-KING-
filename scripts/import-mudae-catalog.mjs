import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
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
  throw new Error('Uso: node scripts/import-mudae-catalog.mjs <archivo-personajes.json>')
}

const source = await readJson(sourceFile)
if (!Array.isArray(source)) {
  throw new Error(`El archivo ${sourceFile} debe ser un array de personajes.`)
}

const catalog = {
  ...defaultCatalog(),
  ...await readJson(catalogFile, defaultCatalog()),
}
catalog.albums = Array.isArray(catalog.albums) ? catalog.albums.map(normalizeMudaeLabel).filter(Boolean) : []
catalog.characters = Array.isArray(catalog.characters) ? catalog.characters : []
catalog.deletedCharacterIds = Array.isArray(catalog.deletedCharacterIds) ? catalog.deletedCharacterIds : []

let imported = 0
let skipped = 0

for (const [index, item] of source.entries()) {
  const name = normalizeMudaeLabel(item.nombre || item.name)
  const album = normalizeMudaeLabel(item.album)
  const sourceImage = String(item.imagen || item.imageUrl || '').trim()
  if (!name || !album || !sourceImage) {
    skipped += 1
    console.warn(`[${index + 1}/${source.length}] omitido por datos incompletos`)
    continue
  }
  const id = makeCharacterId(album, name)
  if (catalog.deletedCharacterIds.includes(id)) {
    skipped += 1
    continue
  }
  if (catalog.characters.some((character) => normalizeMudaeIdentity(character.name) === normalizeMudaeIdentity(name))) {
    skipped += 1
    continue
  }

  const normalizedAlbum = ensureAlbum(catalog, album)
  const uploadKey = `${makeCharacterIdentity(normalizedAlbum, name)}\n${sourceImage}`
  const uploaded = await uploadRemoteMudaeImage(sourceImage, uploadKey)
  catalog.characters.push({
    id,
    name,
    album: normalizedAlbum,
    value: MUDAE_CONFIG.DEFAULT_CHARACTER_VALUE,
    imageUrl: uploaded.imageUrl,
    cloudinaryPublicId: uploaded.cloudinaryPublicId,
    createdAt: Date.now(),
  })
  imported += 1

  if (imported % 25 === 0) {
    await writeJsonAtomic(catalogFile, catalog)
    console.log(`Importados ${imported}; omitidos ${skipped}; procesados ${index + 1}/${source.length}`)
  }
}

await writeJsonAtomic(catalogFile, catalog)
console.log(`Listo. Importados ${imported}; omitidos ${skipped}; total en catálogo ${catalog.characters.length}.`)

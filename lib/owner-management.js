import fs from 'fs/promises'
import path from 'path'

const getOwnersFile = () => process.env.BOT_ADDITIONAL_OWNERS_FILE ||
  path.join(process.cwd(), 'data', 'additional-owners.json')

let additionalOwners
let saveQueue = Promise.resolve()

const normalizeNumber = (value) => String(value || '').replace(/\D/g, '')

const readAdditionalOwners = async () => {
  if (additionalOwners) return additionalOwners
  const ownersFile = getOwnersFile()
  try {
    const content = await fs.readFile(ownersFile, 'utf8')
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error('El archivo de owners adicionales debe contener una lista de números.')
    }
    additionalOwners = [...new Set(parsed.map(normalizeNumber).filter((number) => /^\d{8,15}$/.test(number)))]
  } catch (error) {
    if (error.code === 'ENOENT') {
      additionalOwners = []
    } else {
      console.error('[OWNERS] No se pudieron cargar los owners adicionales:', error?.message || error)
      throw error
    }
  }
  return [...additionalOwners]
}

const saveAdditionalOwners = async (owners) => {
  const ownersFile = getOwnersFile()
  const nextOwners = [...new Set(owners.map(normalizeNumber).filter((number) => /^\d{8,15}$/.test(number)))]
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(path.dirname(ownersFile), { recursive: true })
    await fs.writeFile(ownersFile, `${JSON.stringify(nextOwners, null, 2)}\n`, 'utf8')
  })
  await saveQueue
  additionalOwners = nextOwners
  return [...additionalOwners]
}

export const getPrimaryOwnerNumber = () => normalizeNumber(global.ownerPrincipal)

export const getAdditionalOwners = readAdditionalOwners

export const getAllOwnerNumbers = async () => {
  const configuredOwners = Array.isArray(global.configuredOwnerNumbers)
    ? global.configuredOwnerNumbers
    : Array.isArray(global.owner) ? global.owner : []
  return [...new Set([
    ...configuredOwners.map(normalizeNumber),
    ...(await readAdditionalOwners()),
  ].filter((number) => /^\d{8,15}$/.test(number)))]
}

export const addAdditionalOwner = async (value) => {
  const number = normalizeNumber(value)
  if (!/^\d{8,15}$/.test(number)) throw new Error('El número debe tener entre 8 y 15 dígitos.')
  if (number === getPrimaryOwnerNumber()) throw new Error('El owner principal ya tiene todos los permisos.')
  const owners = await readAdditionalOwners()
  if (owners.includes(number)) return { added: false, owners }
  return { added: true, owners: await saveAdditionalOwners([...owners, number]) }
}

export const removeAdditionalOwner = async (value) => {
  const number = normalizeNumber(value)
  if (!/^\d{8,15}$/.test(number)) throw new Error('El número debe tener entre 8 y 15 dígitos.')
  if (number === getPrimaryOwnerNumber()) throw new Error('No se puede quitar al owner principal.')
  const owners = await readAdditionalOwners()
  if (!owners.includes(number)) return { removed: false, owners }
  return { removed: true, owners: await saveAdditionalOwners(owners.filter((owner) => owner !== number)) }
}

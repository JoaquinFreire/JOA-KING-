import fetch from 'node-fetch'

let handler = async (m, { conn, text, usedPrefix }) => {
try {
if (!text) return conn.reply(m.chat, `❀ Por favor, ingresa el nombre del Pokemon que quiere buscar.`, m)
const url = `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(text.trim().toLowerCase())}`
await m.react('🕒')
const response = await fetch(url)
if (!response.ok) throw new Error(response.status === 404 ? 'No se encontró ese Pokémon.' : `Error HTTP: ${response.status}`)
const pokemon = await response.json()
const speciesResponse = await fetch(pokemon.species.url)
if (!speciesResponse.ok) throw new Error(`Error HTTP al consultar su descripción: ${speciesResponse.status}`)
const species = await speciesResponse.json()
const description = species.flavor_text_entries?.find(entry => entry.language?.name === 'es')?.flavor_text
const types = pokemon.types.map(entry => entry.type.name).join(', ')
const abilities = pokemon.abilities.map(entry => entry.ability.name).join(', ')
const aipokedex = `❀ *Pokédex - Información*\n\n> • *Nombre* » ${pokemon.name}\n> • *ID* » ${pokemon.id}\n> • *Tipo* » ${types}\n> • *Habilidades* » ${abilities}\n> • *Tamaño* » ${pokemon.height / 10} m\n> • *Peso* » ${pokemon.weight / 10} kg\n> • *Descripción* » ${(description || 'Sin descripción disponible.').replace(/\s+/g, ' ')}\n\n> https://www.pokemon.com/es/pokedex/${pokemon.name}`
await conn.reply(m.chat, aipokedex, m)
await m.react('✔️')
} catch (error) {
await m.react('✖️')
await conn.reply(m.chat, `⚠︎ Se ha producido un problema.\n> Usa *${usedPrefix}report* para informarlo.\n\n${error.message}`, m)
}}

handler.help = ['pokedex']
handler.tags = ['fun']
handler.command = ['pokedex']
handler.group = true

export default handler
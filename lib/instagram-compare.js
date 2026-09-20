import { promises as fs } from 'fs'

const instagramBaseUrl = 'https://www.instagram.com'
const instagramAppId = '936619743392459'
const defaultAccount = process.env.INSTAGRAM_USERNAME || 'variableweb'
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const loadCookies = async (sessionFile) => {
  const storage = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
  const cookies = storage.cookies || []

  if (!cookies.length) throw new Error('La sesión de Instagram no contiene cookies.')

  return {
    header: cookies.map(({ name, value }) => `${name}=${value}`).join('; '),
    csrfToken: cookies.find(({ name }) => name === 'csrftoken')?.value
  }
}

const createInstagramRequest = ({ header: cookieHeader, csrfToken }) => async (pathname, params = {}) => {
  const url = new URL(pathname, instagramBaseUrl)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  return fetch(url, {
    headers: {
      Accept: '*/*',
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      Cookie: cookieHeader,
      Referer: `${instagramBaseUrl}/`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      'X-CSRFToken': csrfToken || '',
      'X-IG-App-ID': instagramAppId,
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
}

const throwForResponse = async (response, action) => {
  if (response.ok) return
  const responseBody = (await response.text()).replace(/\s+/g, ' ').slice(0, 300)
  if ([401, 403, 429].includes(response.status)) {
    throw new Error(`Instagram rechazó ${action} (HTTP ${response.status}): ${responseBody}`)
  }
  throw new Error(`Error ${action}: HTTP ${response.status}: ${responseBody}`)
}

const getUserId = async (request, username) => {
  const response = await request('/api/v1/web/search/topsearch/', {
    context: 'blended',
    query: username,
    include_reel: 'false'
  })
  await throwForResponse(response, 'la búsqueda')
  const data = await response.json()
  const match = (data.users || []).find(({ user }) => user?.username?.toLowerCase() === username.toLowerCase())
  return match?.user?.pk || null
}

const getRelationships = async (request, username, type) => {
  const userId = await getUserId(request, username)
  if (!userId) throw new Error(`No se encontró @${username}`)

  const users = []
  let maxId
  let page = 0

  while (true) {
    page += 1
    console.log(`Página ${page} | Usuarios acumulados: ${users.length}`)
    const response = await request(`/api/v1/friendships/${userId}/${type}/`, {
      count: '50',
      ...(maxId ? { max_id: maxId } : {})
    })
    await throwForResponse(response, `la consulta de ${type}`)
    const data = await response.json()
    const pageUsers = data.users || []
    console.log(`HTTP ${response.status}`)

    if (!pageUsers.length) break

    users.push(...pageUsers.map((user) => ({
      username: user.username,
      full_name: user.full_name,
      pk: user.pk,
      is_private: user.is_private,
      is_verified: user.is_verified,
      profile_pic_url: user.profile_pic_url
    })))

    if (!data.next_max_id) break
    maxId = data.next_max_id
    await delay(1500 + Math.random() * 2000)
  }

  return users
}

export const compareInstagramFollowing = async (username, outputFile, sessionFile) => {
  const account = process.env.INSTAGRAM_USERNAME || defaultAccount
  const normalizedUsername = username.replace(/^@/, '').trim()

  if (!normalizedUsername) throw new Error('No ingresaste ningún username.')
  if (normalizedUsername.toLowerCase() === account.toLowerCase()) {
    throw new Error(`No podés consultar la propia cuenta de @${account}.`)
  }

  const cookieHeader = await loadCookies(sessionFile)
  const request = createInstagramRequest(cookieHeader)
  const targetId = await getUserId(request, normalizedUsername)
  if (!targetId) throw new Error(`No se encontró @${normalizedUsername}`)

  const relation = await request(`/api/v1/friendships/show/${targetId}/`)
  await throwForResponse(relation, 'la comprobación de relación')
  const relationData = await relation.json()

  if (!relationData.following) {
    await fs.writeFile(outputFile, JSON.stringify({
      status: 'not_following',
      username: normalizedUsername,
      account
    }))
    return
  }

  console.log(`Obteniendo seguidos de @${normalizedUsername}...`)
  const following = await getRelationships(request, normalizedUsername, 'following')
  console.log(`Seguidos obtenidos: ${following.length}`)
  console.log(`Obteniendo seguidores de @${normalizedUsername}...`)
  const followers = await getRelationships(request, normalizedUsername, 'followers')
  console.log(`Seguidores obtenidos: ${followers.length}`)

  const followerNames = new Set(followers.map(({ username: name }) => name?.toLowerCase()).filter(Boolean))
  const result = following
    .filter(({ username: name }) => name && !followerNames.has(name.toLowerCase()))
    .map((user) => ({
      ...user,
      profile_url: `https://www.instagram.com/${user.username}/`
    }))

  await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf8')
}
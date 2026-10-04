import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yts from 'yt-search'
import youtubeDl from 'youtube-dl-exec'

const MAX_DURATION_SECONDS = 30 * 60
const MAX_FILE_SIZE = '49M'
const YOUTUBE_VIDEO_ID = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const query = String(text || '').trim()
  if (!query) {
    return conn.reply(m.chat, `❀ Indica una canción o un enlace de YouTube.\nEjemplos: *${usedPrefix}playc Soda Stereo De música ligera* o *${usedPrefix}playv https://youtu.be/VIDEO_ID*`, m)
  }

  const isVideo = ['playv', 'play2', 'ytv', 'ytmp4', 'mp4'].includes(command)
  let tempDir
  try {
    await m.react('🕒')

    const videoMatch = query.match(YOUTUBE_VIDEO_ID)
    const search = await yts(videoMatch ? `https://youtu.be/${videoMatch[1]}` : query)
    const result = videoMatch
      ? search.videos?.find((video) => video.videoId === videoMatch[1])
      : search.videos?.[0] || search.all?.[0]

    if (!result) throw new Error('YouTube no encontró resultados para esa búsqueda o enlace.')
    if (!result.url || !result.title) throw new Error('YouTube devolvió un resultado incompleto.')
    if (result.seconds > MAX_DURATION_SECONDS) {
      throw new Error('El contenido supera el límite de duración de 30 minutos.')
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'joa-king-youtube-'))
    const output = path.join(tempDir, 'media.%(ext)s')
    const options = {
      noPlaylist: true,
      noWarnings: true,
      quiet: true,
      maxFilesize: MAX_FILE_SIZE,
      output
    }

    if (isVideo) {
      await youtubeDl(result.url, {
        ...options,
        format: '18/best[height<=360]/best',
        extractorArgs: 'youtube:player_client=android'
      })
    } else {
      await youtubeDl(result.url, {
        ...options,
        format: 'bestaudio/best',
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 5
      })
    }

    const extension = isVideo ? '.mp4' : '.mp3'
    const mediaFile = (await fs.readdir(tempDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === extension)
      .map((entry) => path.join(tempDir, entry.name))[0]
    if (!mediaFile) {
      throw new Error(`yt-dlp no generó el archivo ${isVideo ? 'MP4' : 'MP3'} esperado.`)
    }

    const title = safeFilename(result.title)
    const details = `「✦」*${result.title}*\n> Canal: *${result.author?.name || 'No disponible'}*\n> Duración: *${result.timestamp || 'No disponible'}*\n> Link: ${result.url}`

    if (isVideo) {
      await conn.sendMessage(m.chat, {
        video: { url: mediaFile },
        fileName: `${title}.mp4`,
        caption: details,
        mimetype: 'video/mp4'
      }, { quoted: m })
    } else {
      await conn.sendMessage(m.chat, {
        audio: { url: mediaFile },
        fileName: `${title}.mp3`,
        mimetype: 'audio/mpeg'
      }, { quoted: m })
      await conn.reply(m.chat, details, m)
    }

    await m.react('✔️')
  } catch (error) {
    await m.react('✖️')
    const detail = String(error?.stderr || error?.message || error || 'Error desconocido').trim().slice(0, 700)
    console.error(`[PLAY ${isVideo ? 'VIDEO' : 'AUDIO'}]`, detail)
    return conn.reply(m.chat, `⚠ No pude descargar el ${isVideo ? 'video' : 'audio'} de YouTube.\n${detail}`, m)
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }
}

const safeFilename = (value) => {
  const cleaned = String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 100)
  return cleaned || 'youtube-media'
}

handler.command = handler.help = [
  'playc', 'playv',
  'play', 'yta', 'ytmp3', 'playaudio',
  'play2', 'ytv', 'ytmp4', 'mp4'
]
handler.tags = ['descargas']
handler.group = true

export default handler

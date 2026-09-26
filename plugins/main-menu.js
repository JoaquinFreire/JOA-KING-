let handler = async (m, { conn, args, usedPrefix }) => {
let mentionedJid = await m.mentionedJid
let userId = mentionedJid && mentionedJid[0] ? mentionedJid[0] : m.sender
let totalreg = Object.keys(global.db.data.users).length
let totalCommands = Object.values(global.plugins).filter((v) => v.help && v.tags).length

let txt = `
> ❀ Hola Que tal! @${userId.split('@')[0]}, Soy *${botname}*, Aquí tienes la lista de comandos.

│✿ *Tipo* » ${(conn.user.jid == global.conn.user.jid ? 'Principal' : 'Socket')}
│ꕥ *Plugins* » ${totalCommands}

╭───✱*.｡:｡✱*.:｡✧*✰ECONOMY✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Economía* para ganar dinero.
 ✿  *#w • #work • #trabajar*
> 𓃦 Ganar coins trabajando.
 ✿  *#slut • #protituirse*
> 𓃦 Ganar coins prostituyéndote.
 ✿  *#coinflip • #flip • #cf* + [cantidad] <cara/cruz>
> 𓃦 Apostar coins en un cara o cruz.
 ✿  *#crime • #crimen*
> 𓃦 Ganar coins rapido.
 ✿  *#roulette • #rt* + [red/black] [cantidad]
> 𓃦 Apostar coins en una ruleta.
 ✿  *#casino • #apostar* • *#slot* + [cantidad]
> 𓃦 Apuestar coins en el casino.
 ✿  *#balance • #bal • #bank* + <usuario>
> 𓃦 Ver cuantos coins tienes en el banco.
 ✿  *#deposit • #dep • #depositar • #d* + [cantidad] | all
> 𓃦 Depositar tus coins en el banco.
 ✿  *#withdraw • #with • #retirar* + [cantidad] | all
> 𓃦 Retirar tus coins del banco.
 ✿  *#economyinfo • #einfo*
> 𓃦 Ver tu información de economía en el grupo.
 ✿  *#givecoins • #pay • #coinsgive* + [usuario] [cantidad]
> 𓃦 Dar coins a un usuario.
 ✿  *#miming • #minar • #mine*
> 𓃦 Realizar trabajos de minería y ganar coins.
 ✿  *#daily • #diario*
> 𓃦 Reclamar tu recompensa diaria.
 ✿  *#cofre* • *#coffer*
> 𓃦 Reclamar tu cofre diario.
 ✿  *#weekly • #semanal*
> 𓃦 Reclamar tu recompensa semanal.
 ✿  *#monthly • #mensual*
> 𓃦 Reclamar tu recompensa mensual.
 ✿  *#steal • #robar • #rob* + [@mencion]
> 𓃦 Intentar robar coins a un usuario.
 ✿  *#economyboard • #eboard • #baltop* + <pagina>
> 𓃦 Ver tu información de economía en el grupo.
 ✿  *#aventura • #adventure*
> 𓃦 Aventuras para ganar coins y exp.
 ✿  *#curar • #heal*
> 𓃦 Curar salud para salir de aventuras.
 ✿  *#cazar • #hunt*
> 𓃦 cazar animales para ganar coins y exp.
 ✿  *#fish • #pescar*
> 𓃦 Ganar coins y exp pescando.
 ✿  *#mazmorra • #dungeon*
> 𓃦 Explorar mazmorras para ganar coins y exp.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰DESCARGAS✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Descargas* para descargar archivos de varias fuentes.
 ✿  *#tiktok • #tt* + [Link] / [busqueda]
> 𓃦 Descargar un video de TikTok.
 ✿  *#wagroups • #wpgroups* + [busqueda]
> 𓃦 Buscar grupos de WhatsApp.
 ✿  *#mediafire • #mf* + [Link]
> 𓃦 Descargar un archivo de MediaFire.
 ✿  *#mega • #mg* + [Link]
> 𓃦 Descargar un archivo de MEGA.
 ✿  *#play • #play2 • #ytmp3 • #ytmp4* + [Cancion] / [Link]
> 𓃦 Descargar una cancion o vídeo de YouTube.
 ✿  *#facebook • #fb* + [Link]
> 𓃦 Descargar un video de Facebook.
 ✿  *#twitter • #x* + [Link]
> 𓃦 Descargar un video de Twitter/X.
 ✿  *#ig • #instagram* + [Link]
> 𓃦 Descargar un reel de Instagram.
 ✿  *#pinterest • #pin* + [busqueda] / [Link]
> 𓃦 Buscar y descargar imagenes de Pinterest.
 ✿  *#image • #imagen* + [busqueda]
> 𓃦 Buscar y descargar imagenes de Google.
 ✿  *#apk • #modapk* + [busqueda]
> 𓃦 Descargar un apk de Aptoide.
 ✿  *#ytsearch • #search* + [busqueda]
> 𓃦 Buscar videos de YouTube.
 ✿  *#spotify • #splay* + [Link / busqueda]
> 𓃦 Descargar música de Spotify.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰SOCKETS✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos para registrar tu propio Bot.
 ✿  *#qr • #code*
> 𓃦 Crear un Sub-Bot con un codigo QR/Code
 ✿  *#bots • #botlist*
> 𓃦 Ver el numero de bots activos.
 ✿  *#status • #estado*
> 𓃦 Ver estado del bot.
 ✿  *#p • #ping*
> 𓃦 Medir tiempo de respuesta.
 ✿  *#join* + [Invitacion]
> 𓃦 Unir al bot a un grupo.
 ✿  *#leave • #salir*
> 𓃦 Salir de un grupo.
 ✿  *#logout*
> 𓃦 Cerrar sesion del bot.
 ✿  *#setpfp • #setimage*
> 𓃦 Cambiar la imagen de perfil
 ✿  *#setstatus* + [estado]
> 𓃦 Cambiar el estado del bot
 ✿  *#setusername* + [nombre]
> 𓃦 Cambiar el nombre de usuario
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰UTILITIES✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Útilidades*.
 ✿  *#help • #menu*
> 𓃦 Ver el menú de comandos.
 ✿  *#sc • #script*
> 𓃦 Link del repositorio oficial del Bot.
 ✿  *#sug • #suggest*
> 𓃦 Sugerir nuevas funciones al desarrollador.
 ✿  *#reporte • #reportar*
> 𓃦 Reportar fallas o problemas del bot.
 ✿  *#calcular • #cal*
> 𓃦 Calcular tipos de ecuaciones.
 ✿  *#delmeta*
> 𓃦 Restablecer el pack y autor por defecto para tus stickers.
 ✿  *#getpic • #pfp* + [@usuario]
> 𓃦 Ver la foto de perfil de un usuario.
 ✿  *#say* + [texto]
> 𓃦 Repetir un mensaje
 ✿  *#setmeta* + [autor] | [pack]
> 𓃦 Establecer el pack y autor por defecto para tus stickers.
 ✿  *#sticker • #s • #wm* + {citar una imagen/video}
> 𓃦 Convertir una imagen/video a sticker
 ✿  *#toimg • #img* + {citar sticker}
> 𓃦 Convertir un sticker/imagen de una vista a imagen.
 ✿  *#brat • #bratv • #qc • #emojimix*︎ 
> 𓃦 Crear stickers con texto.
 ✿  *#gitclone* + [Link]
> 𓃦 Descargar un repositorio de Github.
 ✿  *#enhance • #remini • #hd*
> 𓃦 Mejorar calidad de una imagen.
 ✿  *#letra • #style* 
> 𓃦 Cambia la fuente de las letras.
 ✿  *#read • #readviewonce*
> 𓃦 Ver imágenes viewonce.
 ✿  *#ss • #ssweb*
> 𓃦 Ver el estado de una página web.
 ✿  *#translate • #traducir • #trad*
> 𓃦 Traducir palabras en otros idiomas.
 ✿  *#whatmusic • #shazam* + {citar audio}
> 𓃦 Identificar una canción.
 ✿  *#tenor • #tenorsearch* + [busqueda]
> 𓃦 Buscar GIFs.
 ✿  *#lyrics* + [cancion]
> 𓃦 Buscar la letra de una canción.
 ✿  *#averiguar* + [nombre o CUIT | edad | provincia | localidad]
> 𓃦 Consultar información disponible.
 ✿  *#igstalk* + [usuario]
> 𓃦 Consultar un perfil de Instagram.
 ✿  *#ignofollow* + [usuario]
> 𓃦 Comparar seguidores y seguidos de Instagram.
 ✿  *#ia • #gemini*
> 𓃦 Preguntar a Chatgpt.
 ✿  *#iavoz • #aivoz*
> 𓃦 Hablar o preguntar a chatgpt mexicano modo voz.
 ✿  *#tourl • #catbox*
> 𓃦 Convertidor de imágen/video en urls.
 ✿  *#wiki • #wikipedia*
> 𓃦 Investigar temas a través de Wikipedia.
 ✿  *#dalle • #flux*
> 𓃦 Crear imágenes con texto mediante IA.
 ✿  *#npmdl • #nmpjs*
> 𓃦 Descargar paquetes de NPMJS.
 ✿  *#google*
> 𓃦 Realizar búsquedas por Google.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰FUN✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Juegos y comandos para divertirse.
 ✿  *#top*
> 𓃦 Ver el top de usuarios.
 ✿  *#sorteo*
> 𓃦 Elegir usuarios al azar.
 ✿  *#ship • #shippear • #formarpareja*
> 𓃦 Probar compatibilidad entre usuarios.
 ✿  *#personalidad*
> 𓃦 Descubrir tu personalidad.
 ✿  *#afk* + [motivo]
> 𓃦 Avisar que estás ausente.
 ✿  *#pokedex* + [Pokemon]
> 𓃦 Consultar información de un Pokémon.
 ✿  *#infoanime* + [anime]
> 𓃦 Consultar información de un anime/manga.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰PROFILES✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Perfil* para ver y configurar tu perfil.
 ✿  *#leaderboard • #lboard • #top* + <Paginá>
> 𓃦 Top de usuarios con más experiencia.
 ✿  *#level • #lvl* + <@Mencion>
> 𓃦 Ver tu nivel y experiencia actual.
 ✿  *#marry • #casarse* + <@Mencion>
> 𓃦 Casarte con alguien.
 ✿  *#profile* + <@Mencion>
> 𓃦 Ver tu perfil.
 ✿  *#setbirth* + [fecha]
> 𓃦 Establecer tu fecha de cumpleaños.
 ✿  *#setdescription • #setdesc* + [Descripcion]
> 𓃦 Establecer tu descripcion.
 ✿  *#setgenre* + Hombre | Mujer
> 𓃦 Establecer tu genero.
 ✿  *#delgenre • #delgenero*
> 𓃦 Eliminar tu género.
 ✿  *#delbirth* + [fecha]
> 𓃦 Borrar tu fecha de cumpleaños.
 ✿  *#divorce*
> 𓃦 Divorciarte de tu pareja.
 ✿  *#deldescription • #deldesc*
> 𓃦 Eliminar tu descripción.
 ✿  *#prem • #vip*
> 𓃦 Comprar membresía premium.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰GROUPS✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos para *Administradores* de grupos.
 ✿  *#tag • #hidetag • #invocar • #tagall* + [mensaje]
> 𓃦 Envía un mensaje mencionando a todos los usuarios del grupo.
 ✿  *#detect • #alertas* + [enable/disable]
> 𓃦 Activar/desactivar las alertas de promote/demote
 ✿  *#antilink • #antienlace* + [enable/disable]
> 𓃦 Activar/desactivar el antienlace
 ✿  *#bot* + [enable/disable]
> 𓃦 Activar/desactivar al bot
 ✿  *#close • #cerrar*
> 𓃦 Cerrar el grupo para que solo los administradores puedan enviar mensajes.
 ✿  *#demote* + <@usuario> | {mencion}
> 𓃦 Descender a un usuario de administrador.
 ✿  *#economy* + [enable/disable]
> 𓃦 Activar/desactivar los comandos de economía
 ✿  *#welcome • #bienvenida* + [enable/disable]
> 𓃦 Activar/desactivar la bienvenida y despedida.
 ✿  *#setbye* + [texto]
> 𓃦 Establecer un mensaje de despedida personalizado.
 ✿  *#setprimary* + [@bot]
> 𓃦 Establece un bot como primario del grupo.
 ✿  *#setwelcome* + [texto]
> 𓃦 Establecer un mensaje de bienvenida personalizado.
 ✿  *#kick* + <@usuario> | {mencion}
> 𓃦 Expulsar a un usuario del grupo.
 ✿  *#onlyadmin* + [enable/disable]
> 𓃦 Permitir que solo los administradores puedan utilizar los comandos.
 ✿  *#open • #abrir*
> 𓃦 Abrir el grupo para que todos los usuarios puedan enviar mensajes.
 ✿  *#promote* + <@usuario> | {mencion}
> 𓃦 Ascender a un usuario a administrador.
 ✿  *#add • #añadir • #agregar* + {número}
> 𓃦 Invita a un usuario a tu grupo.
 ✿  *admins • admin* + [texto]
> 𓃦 Mencionar a los admins para solicitar ayuda.
 ✿  *#restablecer • #revoke*
> 𓃦 Restablecer enlace del grupo.
 ✿  *#addwarn • #warn* + <@usuario> | {mencion}
> 𓃦 Advertir aún usuario.
 ✿  *#unwarn • #delwarn* + <@usuario> | {mencion}
> 𓃦 Quitar advertencias de un usuario.
 ✿  *#advlist • #listadv*
> 𓃦 Ver lista de usuarios advertidos.
 ✿  *#inactivos • #kickinactivos*
> 𓃦 Ver y eliminar a usuarios inactivos.
 ✿  *#listnum • #kicknum* [texto]
> 𓃦 Eliminar usuarios con prefijo de país.
 ✿  *#gpbanner • #groupimg*
> 𓃦 Cambiar la imagen del grupo.
 ✿  *#gpname • #groupname* [texto]
> 𓃦 Cambiar la nombre del grupo.
 ✿  *#gpdesc • #groupdesc* [texto]
> 𓃦 Cambiar la descripción del grupo.
 ✿  *#del • #delete* + {citar un mensaje}
> 𓃦 Eliminar un mensaje.
 ✿  *#linea • #listonline*
> 𓃦 Ver lista de usuarios en linea.
 ✿  *#gp • #infogrupo*
> 𓃦 Ver la Informacion del grupo.
 ✿  *#link*
> 𓃦 Ver enlace de invitación del grupo.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───ׅ

╭───✱*.｡:｡✱*.:｡✧*✰ANIME✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de reacciones de anime.
 ✿  *#angry • #enojado* + <mencion>
> 𓃦 Estar enojado
 ✿  *#bath • #bañarse* + <mencion>
> 𓃦 Bañarse
 ✿  *#bite • #morder* + <mencion>
> 𓃦 Muerde a alguien
 ✿  *#bleh • #lengua* + <mencion>
> 𓃦 Sacar la lengua
 ✿  *#blush • #sonrojarse* + <mencion>
> 𓃦 Sonrojarte
 ✿  *#bored • #aburrido* + <mencion>
> 𓃦 Estar aburrido
 ✿  *#clap • #aplaudir* + <mencion>
> 𓃦 Aplaudir
 ✿  *#coffee • #cafe • #café* + <mencion>
> 𓃦 Tomar café
 ✿  *#cry • #llorar* + <mencion>
> 𓃦 Llorar por algo o alguien
 ✿  *#cuddle • #acurrucarse* + <mencion>
> 𓃦 Acurrucarse
 ✿  *#dance • #bailar* + <mencion>
> 𓃦 Sacate los pasitos prohíbidos
 ✿  *#dramatic • #drama* + <mencion>
> 𓃦 Drama
 ✿  *#drunk • #borracho* + <mencion>
> 𓃦 Estar borracho
 ✿  *#eat • #comer* + <mencion>
> 𓃦 Comer algo delicioso
 ✿  *#facepalm • #palmada* + <mencion>
> 𓃦 Darte una palmada en la cara
 ✿  *#happy • #feliz* + <mencion>
> 𓃦 Salta de felicidad
 ✿  *#hug • #abrazar* + <mencion>
> 𓃦 Dar un abrazo
 ✿  *#impregnate • #preg • #preñar • #embarazar* + <mencion>
> 𓃦 Embarazar a alguien
 ✿  *#kill • #matar* + <mencion>
> 𓃦 Toma tu arma y mata a alguien
 ✿  *#kiss • #muak* + <mencion>
> 𓃦 Dar un beso
 ✿  *#kisscheek • #beso* + <mencion>
> 𓃦 Beso en la mejilla
 ✿  *#laugh • #reirse* + <mencion>
> 𓃦 Reírte de algo o alguien
 ✿  *#lick • #lamer* + <mencion>
> 𓃦 Lamer a alguien
 ✿  *#love • #amor • #enamorado • #enamorada* + <mencion>
> 𓃦 Sentirse enamorado
 ✿  *#pat • #palmadita • #palmada* + <mencion>
> 𓃦 Acaricia a alguien
 ✿  *#poke • #picar* + <mencion>
> 𓃦 Picar a alguien
 ✿  *#pout • #pucheros* + <mencion>
> 𓃦 Hacer pucheros
 ✿  *#punch • #pegar • #golpear* + <mencion>
> 𓃦 Dar un puñetazo
 ✿  *#run • #correr* + <mencion>
> 𓃦 Correr
 ✿  *#sad • #triste* + <mencion>
> 𓃦 Expresar tristeza
 ✿  *#scared • #asustado • #asustada* + <mencion>
> 𓃦 Estar asustado
 ✿  *#seduce • #seducir* + <mencion>
> 𓃦 Seducir a alguien
 ✿  *#shy • #timido • #timida* + <mencion>
> 𓃦 Sentir timidez
 ✿  *#slap • #bofetada* + <mencion>
> 𓃦 Dar una bofetada
 ✿  *#sleep • #dormir* + <mencion>
> 𓃦 Tumbarte a dormir
 ✿  *#smoke • #fumar* + <mencion>
> 𓃦 Fumar
 ✿  *#spit • #escupir* + <mencion>
> 𓃦 Escupir
 ✿  *#step • #pisar* + <mencion>
> 𓃦 Pisar a alguien
 ✿  *#think • #pensar* + <mencion>
> 𓃦 Pensar en algo
 ✿  *#walk • #caminar* + <mencion>
> 𓃦 Caminar
 ✿  *#wink • #guiñar* + <mencion>
> 𓃦 Guiñar el ojo
 ✿  *#cringe • #avergonzarse* + <mencion>
> 𓃦 Sentir vergüenza ajena
 ✿  *#smug • #presumir* + <mencion>
> 𓃦 Presumir con estilo
 ✿  *#smile • #sonreir* + <mencion>
> 𓃦 Sonreír con ternura
 ✿  *#highfive • #5* + <mencion>
> 𓃦 Chocar los cinco
 ✿  *#bully • #bullying* + <mencion>
> 𓃦 Molestar a alguien
 ✿  *#handhold • #mano* + <mencion>
> 𓃦 Tomarse de la mano
 ✿  *#wave • #ola • #hola* + <mencion>
> 𓃦 Saludar con la mano
 ✿  *#ppcouple • #ppcp*
> 𓃦 Genera imágenes para amistades o parejas.
╰ׅ͜─֟͜─͜─ٞ͜─͜─๊͜─͜─๋͜─⃔═̶፝֟͜═̶⃔─๋͜─͜─͜─๊͜─ٞ͜─͜─֟͜┈ࠢ͜╯

`.trim()
await conn.sendMessage(m.chat, { 
text: txt.replaceAll('#', usedPrefix),
contextInfo: {
mentionedJid: [userId]
}}, { quoted: m })
}

handler.help = ['menu']
handler.tags = ['main']
handler.command = ['menu', 'menú', 'help']

export default handler

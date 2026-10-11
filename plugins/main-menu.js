const toRegionalText = (text) => text
.split(' ')
.map((word) => Array.from(word).map((character) => {
const normalized = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
return /^[A-Z]$/.test(normalized)
? String.fromCodePoint(0x1F1E6 + normalized.charCodeAt(0) - 65)
: character
}).join(' '))
.join('   ')

let handler = async (m, { conn, args, usedPrefix }) => {
let mentionedJid = await m.mentionedJid
let userId = mentionedJid && mentionedJid[0] ? mentionedJid[0] : m.sender
let totalreg = Object.keys(global.db.data.users).length
let totalCommands = Object.values(global.plugins).filter((v) => v.help && v.tags).length

let txt = `
> ❀ Hola Que tal! @${userId.split('@')[0]}, Soy *${botname}*, Aquí tienes la lista de comandos.

│✿ *Tipo* » ${(conn.user.jid == global.conn.user.jid ? 'Principal' : 'Socket')}
│ꕥ *Plugins* » ${totalCommands}

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('DESCARGAS')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Descargas* para descargar archivos de varias fuentes.
 ✿  *#tiktok • #tt* + [Link] / [busqueda]
> 𓃦 Descargar un video de TikTok.
 ✿  *#wagroups • #wpgroups* + [tema]
> 𓃦 Buscar enlaces de grupos públicos de WhatsApp.
 ✿  *#mediafire • #mf* + [Link]
> 𓃦 Descargar un archivo de MediaFire.
 ✿  *#mega • #mg* + [Link]
> 𓃦 Descargar un archivo de MEGA.
 ✿  *#playc • #playv* + [Canción / Link]
> 𓃦 Descargar audio (#playc) o vídeo (#playv) de YouTube.
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
 ✿  *%imgg [busqueda]*
> 𓃦 Buscar una imagen en Google Imágenes.
 ✿  *#apk • #modapk* + [busqueda]
> 𓃦 Descargar un apk de Aptoide.
 ✿  *#ytsearch • #search* + [busqueda]
> 𓃦 Buscar videos de YouTube.
 ✿  *#spotify • #splay* + [Link / busqueda]
> 𓃦 Descargar música de Spotify.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('SOCKETS')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos para registrar tu propio Bot.
 ✿  *#qr • #code*
> 𓃦 Crear un Sub-Bot con un codigo QR/Code
 ✿  *#bots*
> 𓃦 Ver cuántos bots están conectados y los números de sus subbots.
 ✿  *#disconnectbot [@subbot]*
> 𓃦 Desconectar un subbot (owner) o tu propio subbot.
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

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('UTILITIES')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos de *Útilidades*.
 ✿  *#help • #menu*
> 𓃦 Ver el menú de comandos.
 ✿  *#menu <sección>*
> 𓃦 Ver una parte del menú, por ejemplo *#menu descargar* o *#menu mudae*.
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
 ✿  *%fakemsg* [texto ficticio + respuesta del bot] {respondiendo a un mensaje}
> 𓃦 Probar el texto citado y la respuesta visible del bot.
 ✿  *%vozarg • %vozloquendo • %vozloquendo2 • %vozanime* + [texto]
> 𓃦 Generar audio con voz argentina, alternativa o anime; también puedes responder a un mensaje.
 ✿  *#ejecutar* + [HTML] o respondiendo a un mensaje con HTML
> 𓃦 Enviar una mini-app interactiva para WhatsApp Android.
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
 ✿  *%textgirar • %textblack*
> 𓃦 Girar el texto o convertirlo en letras cuadradas.
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
 ✿  *%geoip [IP]*
> 𓃦 Consultar datos aproximados de una IP pública y ver su ubicación en un mapa.
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

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('FUN')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Juegos y comandos para divertirse.
 ✿  *%arkanoid*
> 𓃦 Jugar Arkanoid: rompe los bloques y supera 10 niveles.
 ✿  *%flappy*
> 𓃦 Jugar Flappy Bird: toca o pulsa espacio para volar.
 ✿  *%topt [tema] • %top3 • %top5 • %top10 • %top20 [tema]*
> 𓃦 Armar un top aleatorio mencionando a integrantes del grupo.
 ✿  *%misexo hombre|mujer*
> 𓃦 Elegirlo una vez; solo el owner puede cambiarlo mencionando al usuario.
 ✿  *%topmujeres [tema] • %tophombres [tema]*
> 𓃦 Tops aleatorios con quienes registraron su sexo.
 ✿  *%topgays*
> 𓃦 Top 5 de gays del grupo.
 ✿  *#top*
> 𓃦 Ver el top de usuarios.
 ✿  *#sorteo*
> 𓃦 Elegir usuarios al azar.
 ✿  *#ship • #shippear • #formarpareja*
> 𓃦 Probar compatibilidad entre usuarios.
 ✿  *%pregunta <pregunta>*
> 𓃦 Consultar al oráculo y recibir una respuesta aleatoria.
 ✿  *%formarpnormal [cantidad]*
> 𓃦 Formar parejas al azar entre hombres y mujeres que registraron su sexo.
 ✿  *%formarpgay [cantidad]*
> 𓃦 Formar parejas al azar entre hombres que registraron su sexo.
 ✿  *%formarplesbi [cantidad]*
> 𓃦 Formar parejas al azar entre mujeres que registraron su sexo.
 ✿  *#personalidad*
> 𓃦 Descubrir tu personalidad.
 ✿  *%addpiropo creador + piropo*
> 𓃦 Agregar un piropo a la lista.
 ✿  *%edit piropo número autor + piropo*
> 𓃦 Editar un piropo de la lista.
 ✿  *%eliminar piropo número*
> 𓃦 Eliminar un piropo de la lista.
 ✿  *%list piropo*
> 𓃦 Ver todos los piropos numerados.
 ✿  *%piropo @usuario*
> 𓃦 Dedicar un piropo aleatorio.
 ✿  *%addchiste autor + chiste*
> 𓃦 Agregar un chiste a la lista.
 ✿  *%edit chiste número autor + chiste*
> 𓃦 Editar un chiste de la lista.
 ✿  *%eliminar chiste número*
> 𓃦 Eliminar un chiste de la lista.
 ✿  *%list chiste*
> 𓃦 Ver todos los chistes numerados.
 ✿  *%chiste*
> 𓃦 Contar un chiste aleatorio.
 ✿  *%horoscopo signo hoy|ayer|mañana*
> 𓃦 Consultar el horóscopo traducido con su fecha.
 ✿  *#afk* + [motivo]
> 𓃦 Avisar que estás ausente.
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('PROFILES')}✰*.:｡✧*.｡:｡*.｡✱ ───
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
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('GROUPS')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Comandos para *Administradores* de grupos.
 ✿  *#tag • #hidetag • #invocar • #tagall* + [mensaje]
> 𓃦 Envía un mensaje mencionando a todos los usuarios del grupo.
 ✿  *#detect • #alertas* + [enable/disable]
> 𓃦 Activar/desactivar las alertas de promote/demote
 ✿  *#antilink • #antienlace* + [enable/disable]
> 𓃦 Activar/desactivar el antienlace
 ✿  *%off bot • %on bot*
> 𓃦 Activar/desactivar al bot
 ✿  *%off @bot • %on @bot*
> 𓃦 Activar/desactivar solo al bot mencionado.
 ✿  *#close • #cerrar*
> 𓃦 Cerrar el grupo para que solo los administradores puedan enviar mensajes.
 ✿  *#demote* + <@usuario> | {mencion}
> 𓃦 Descender a un usuario de administrador.
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
 ✿  *%ban* + <@usuario> | {responder mensaje}
> 𓃦 Impedir que un usuario use los comandos del bot.
 ✿  *%unban* + <@usuario> | {responder mensaje}
> 𓃦 Restaurar el acceso a los comandos del bot.
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

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('MUDAE')}✰*.:｡✧*.｡:｡*.｡✱ ───
> ✿ Coleccioná personajes en este grupo.
 ✿  *%menumudae*
> 𓃦 Ver comandos e instrucciones de Mudae.
 ✿  *%rw • %quitarpj • %regalarpj • %suertepj*
> 𓃦 Votá y tirá; reclamá, liberá, regalá o cambiá uno propio por suerte cada 12 horas.
 ✿  *%cd • %votarpj <personaje>*
> 𓃦 Ver cooldowns y votos para habilitar tiradas.
 ✿  *%cambiarpj <tuyo> + <del otro> • %aceptarcambio*
> 𓃦 Proponé un intercambio; solo la otra persona puede aceptarlo en 30 segundos.
 ✿  *%personajes [@usuario] • %pjs [@usuario]*
> 𓃦 Ver tu colección o consultar la de otra persona.
 ✿  *%toppj • %verpj <personaje>*
> 𓃦 Ver el ranking e información de personajes.
 ✿  *%ainfo <álbum>*
> 𓃦 Ver los personajes del álbum y sus valores.
 ✿  *%albumespj*
> 𓃦 Ver todos los álbumes y cuántos personajes tiene cada uno.
 ✿  *%wish • %wishremove • %wishlist*
> 𓃦 Guardar hasta 3 deseados y recibir aviso cuando salgan.
 ✿  *%votarpj <personaje>*
> 𓃦 Votar una vez cada 24 horas para sumar 125 al valor y habilitar una tirada.
 ✿  *%addalbum • %addpj • %editpj • %delpj • %delalbum*
> 𓃦 Administrar álbumes y personajes (admins; %addpj responde a una imagen).
 ✿  *%onmudae • %offmudae*
> 𓃦 Activar o desactivar Mudae en este grupo (owner).
╰ׅ───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───

╭───✱*.｡:｡✱*.:｡✧*✰${toRegionalText('ANIME')}✰*.:｡✧*.｡:｡*.｡✱ ───
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
txt = txt.replace(/ ✿  \*#(?:pokedex|infoanime)\*[^\n]*\n> 𓃦[^\n]*\n/g, '')
const removeMenuSection = (title) => {
const sectionIndex = txt.indexOf(`${title}✰`)
if (sectionIndex === -1) return
const sectionStart = txt.lastIndexOf('\n╭', sectionIndex)
const sectionEnd = txt.indexOf('\n╰', sectionIndex)
if (sectionStart !== -1 && sectionEnd !== -1) {
txt = txt.slice(0, sectionStart) + txt.slice(txt.indexOf('\n', sectionEnd + 1))
}}
removeMenuSection('ANIME')
const requestedSection = Array.isArray(args) ? args.join(' ').trim().toLowerCase() : ''
if (requestedSection) {
const sectionAliases = {
descargar: 'DESCARGAS',
descargas: 'DESCARGAS',
download: 'DESCARGAS',
downloads: 'DESCARGAS',
socket: 'SOCKETS',
sockets: 'SOCKETS',
util: 'UTILITIES',
utilities: 'UTILITIES',
fun: 'FUN',
diversion: 'FUN',
diversiones: 'FUN',
perfil: 'PROFILES',
perfiles: 'PROFILES',
profile: 'PROFILES',
profiles: 'PROFILES',
grupo: 'GROUPS',
grupos: 'GROUPS',
groups: 'GROUPS',
mudae: 'MUDAE',
}
const sectionName = sectionAliases[requestedSection]
if (!sectionName) {
return conn.reply(
  m.chat,
  `Sección no encontrada. Probá: *${usedPrefix}menu descargar*, *${usedPrefix}menu sockets*, *${usedPrefix}menu fun*, *${usedPrefix}menu perfiles*, *${usedPrefix}menu grupos* o *${usedPrefix}menu mudae*.`,
  m
)
}
const headingIndex = txt.indexOf(`${toRegionalText(sectionName)}✰`)
const sectionStart = txt.lastIndexOf('\n╭', headingIndex)
const sectionEnd = txt.indexOf('\n╰', headingIndex)
const firstSectionStart = txt.indexOf('\n╭')
if (headingIndex < 0 || sectionStart < 0 || sectionEnd < 0 || firstSectionStart < 0) {
return conn.reply(m.chat, `No pude cargar la sección ${requestedSection} del menú.`, m)
}
const intro = txt.slice(0, firstSectionStart)
const footerEnd = txt.indexOf('\n', sectionEnd + 1)
const section = txt.slice(sectionStart + 1, footerEnd < 0 ? txt.length : footerEnd)
txt = `${intro}\n\n${section}`
}
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

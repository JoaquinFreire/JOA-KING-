# JOA-KING

Bot de WhatsApp basado en Baileys.

## Requisitos

- Node.js 20 o superior
- Python 3.11 o superior para `ignofollow` e `igstalk`
- Transcripción local de notas de voz: `python -m pip install -r requirements-transcription.txt` (el modelo Whisper `small` se descarga al primer uso)
- Voz argentina en `%vozarg`: `python -m pip install -r requirements-voice.txt` (el modelo Piper se descarga al primer uso)
- Dependencias de Python para `igstalk`: `python -m pip install -r instagramarchivos/igdata/requirements.txt`
- Dependencias de Python y Chromium para `%screenw`: `python -m pip install -r requirements-screenw.txt` y `python -m playwright install chromium`
- Primera sesión local de Instagram: `python instagramarchivos/igdata/main.py` (la sesión se guarda localmente y no se sube a Git)
- Playwright y Chromium para Instagram
- FFmpeg para stickers y conversiones

## Instalacion

```bash
npm install
python -m pip install playwright
python -m playwright install chromium
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-transcription.txt
.venv\Scripts\python.exe -m pip install -r requirements-voice.txt
python -m pip install -r requirements-screenw.txt
python -m playwright install chromium
```

`%screenw` usa `SCREENWSP_PYTHON` si está configurado; de lo contrario, usa el entorno virtual local de `pruebas/fakewsp` si existe, o Python del sistema (`python` en Windows y `python3` en otros sistemas). Instala las dependencias y Chromium en el intérprete que vaya a usar el bot.

El comando `%on autotranscribe` transcribe solo notas de voz PTT. La primera transcripción descarga el modelo Whisper `small`; después se reutiliza localmente para priorizar precisión en español.

## Inicio

```bash
npm start
```

El prefijo predeterminado es `%`:

```text
%menu
%ping
%ignofollow usuario
```

Para vincular una cuenta nuevamente:

```bash
npm run qr
```

Para vincular con código, usa `%code +549XXXXXXXXXX` e incluye el número internacional completo de la cuenta. `%bots` muestra las conexiones activas y quién administra cada subbot. El owner puede desconectar uno con `%disconnectbot @subbot`; quien inició un subbot también puede ejecutar `%disconnectbot` desde ese subbot para cerrar su propia sesión. Para ver las utilidades del menú, también puedes usar `%menu tools` además de `%menu utilities`.

## Mudae

`%ainfo <álbum>` lista todos los personajes de ese álbum con sus valores y no distingue tildes (por ejemplo, `%ainfo dragon ball` encuentra `Dragón Ball`). Para la ficha de un anime usa `%animedata <nombre>`; ya no comparte el alias `%ainfo`. Las búsquedas de personajes por nombre, como `%verpj` y `%votarpj`, también ignoran tildes.

Para tirar `%rw`, primero vota por un personaje con `%votarpj <nombre>` (por ejemplo, `%votarpj Goku`). Cada voto habilita tiradas durante 24 horas y se puede votar una vez cada 24 horas. `%cd` muestra las tiradas restantes de tu cupo de 10, incluso si todavía necesitas votar; al agotarlo, se restablece después de 30 minutos. Solo el owner del bot puede borrar personajes con `%delpj <álbum> + <nombre>`; el borrado también elimina la imagen de Cloudinary e invalida su caché.

En un grupo, `%personajes` (o `%pjs`) muestra tu colección; `%personajes @usuario` y `%pjs @usuario` consultan la de otra persona. `%ainfo <álbum>` muestra los personajes del álbum: los que nadie reclamó aparecen con la inicial y `###` hasta que alguien los desbloquee; los reclamados se muestran con su nombre y valor. `%albumespj` lista los álbumes y la cantidad de personajes que tiene cada uno. `%regalarpj <nombre> @usuario` transfiere uno de tus personajes a la persona mencionada. `%suertepj <nombre>` cambia un personaje tuyo por otro libre al azar del grupo y muestra la imagen del nuevo personaje; solo puede usarse una vez cada 12 horas y no altera el valor del nuevo personaje. Para intercambiar directamente con otra persona, usa `%cambiarpj <tu personaje> + <personaje de la otra persona>`; la propuesta se anuncia en el grupo, solo el dueño destinatario puede aceptarla con `%aceptarcambio` y vence en 30 segundos. Solo puede haber una propuesta pendiente por grupo y ambos personajes deben tener dueño.

`%toppj` ordena a los jugadores por el valor total de los personajes que reclamaron. `%gpjs` muestra los 20 personajes más valiosos del grupo, incluidos los disponibles y los reclamados, e indica su estado; oculta el nombre de los GIF especiales que aún no se reclamaron.

Solo el owner del bot puede usar `%addpj <álbum> + <nombre>`. Responde a una imagen para agregar un personaje normal o a un GIF de WhatsApp para agregar un personaje especial: comienza con valor `$6.767` y el conjunto de GIFs tiene como máximo un 1% de probabilidad total por tirada, independientemente de cuántos personajes normales queden libres. Al aparecer un GIF, el bot anuncia la revelación y muestra el video cinco segundos después. `%verpj <nombre>` oculta el GIF hasta que el personaje sea reclamado; el owner puede verlo antes con `%overpj <nombre>`.

`%fakemsg2 <texto>` edita el mensaje al que respondes en un grupo y está disponible para administradores del grupo y el owner. `%owner` envía la tarjeta de contacto del owner con el número y su Instagram.

El menú principal acepta secciones, por ejemplo `%menu descargar`, `%menu fun` y `%menu mudae`; también puedes usar `%menumudae` para ver el menú de Mudae directamente. En los comandos de diversión, `%pregunta <pregunta>` (o `%preguntar`) responde con una predicción aleatoria. `%parejadeldia` elige una pareja entre quienes registraron `%misexo hombre` y `%misexo mujer`; el resultado se mantiene en cada grupo hasta la medianoche de Argentina. `%formarpnormal`, `%formarpgay` (o `%formargay`) y `%formarplesbi` (o `%formarlesbi`) forman parejas usando el sexo registrado con `%misexo`; opcionalmente aceptan una cantidad. Si pides más parejas de las posibles, forman todas las que permita la cantidad de personas disponibles.

Para agregar imágenes, configura Cloudinary en un archivo `.env` local. Puedes partir de `.env.example` con `Copy-Item .env.example .env` en PowerShell, completar los tres valores de Cloudinary y no subir `.env` a GitHub. Si recibes `Invalid Signature`, revisa que el cloud name, la API key y el API secret sean del mismo cloud y que el secret siga vigente.

Para importar personajes desde un JSON con campos `nombre` e `imagen`, ejecuta `npm run mudae:import -- mudae/dragonball.json "Dragon Ball"` en una consola interactiva. El importador muestra el nombre y la URL de cada imagen y pregunta `[y/n]`; con `y` te permite cambiar el nombre (Enter conserva el original), luego sube la imagen a tu Cloudinary y guarda el personaje en `data/mudae/catalog.json`; con `n` lo omite. No agrega nombres que ya existan en ningún álbum, ignorando mayúsculas y tildes. Guarda el catálogo después de cada alta y omite personajes incompletos; el álbum puede indicarse como segundo argumento. Asegúrate de tener Cloudinary configurado antes de aceptar personajes.

El catálogo (`data/mudae/catalog.json`) se comparte mediante Git y se sincroniza entre los grupos; el bot vuelve a revisar el archivo cuando se usa un comando de personajes, así que los cambios recibidos con `git pull` aparecen sin reiniciar. Los reclamos y demás estado de cada grupo son locales y no se suben a Git. De forma predeterminada se guardan en `data/mudae/instances/<nombre-del-equipo>`; también puedes configurar rutas explícitas diferentes en cada PC:

```dotenv
# PC principal
MUDAE_DATA_DIR=data/mudae/instances/principal
MUDAE_CATALOG_FILE=data/mudae/catalog.json
```

```dotenv
# Segunda PC: usa otra carpeta, no la de "principal"
MUDAE_DATA_DIR=data/mudae/instances/secundario
MUDAE_CATALOG_FILE=data/mudae/catalog.json
```

`data/mudae/instances/` y los archivos antiguos `data/mudae/group-*.json` están excluidos de Git. Al iniciar sin una ruta explícita, el bot migra automáticamente los estados antiguos del directorio compartido a la carpeta local de esa PC. Para pasar por primera vez a una versión que deja de rastrear los archivos antiguos, detén el bot y respalda esos estados antes de hacer `git pull`:

```powershell
$local = ".\data\mudae\instances\$env:COMPUTERNAME"
New-Item -ItemType Directory -Force $local
Copy-Item .\data\mudae\group-*.json $local\
git restore --worktree -- .\data\mudae\group-*.json
```

La copia se conserva localmente y no se mezcla con los reclamos de otra PC. Si la PC ya tenía cambios locales en `catalog.json`, consérvalos mediante un commit antes de actualizar; el catálogo es compartido y Git necesita integrar los cambios de ambas PCs. No restaures ni descartes el catálogo si contiene altas o bajas que quieres conservar.

Para compartir altas y bajas del catálogo, primero trae los cambios de GitHub, detén el bot, realiza la operación en una PC y sube el `catalog.json` actualizado; luego haz pull y reinicia el bot en la otra. Evita editar el catálogo en ambas PCs a la vez: Git puede reportar un conflicto. Las bajas quedan registradas para evitar que estados antiguos vuelvan a agregar personajes eliminados.

La lista de álbumes se pagina con `%albumespj [página]`, por ejemplo `%albumespj 2`. `%pjs [página]` también pagina la colección, pero mantiene cada álbum completo en una sola parte para que no aparezca repetido entre páginas. `%ainfo <álbum>` muestra junto a cada personaje el nombre de quien lo reclamó, como texto sin mención. El owner puede cambiar una imagen respondiendo a una imagen nueva con `%editimgpj <álbum> + <nombre>`; la actualización se sincroniza para todos los grupos y elimina de Cloudinary la imagen anterior.

## Instagram

El comando `%ignofollow usuario` compara las cuentas seguidas y seguidoras usando la sesion local de Instagram. La sesion se guarda en `instagramarchivos/instagram_storage.json` y no debe publicarse ni compartirse.

El comando requiere que `@variable_web` siga al usuario consultado. Los resultados se envian en grupos de 30, con el enlace de cada perfil y una pausa entre mensajes.

## Despliegue

```bash
npm install
npm start
```

Para mantenerlo activo con PM2:

```bash
npm install -g pm2
pm2 start index.js --name joa-king
pm2 save
```

El repositorio de GitHub se configura posteriormente en `package.json`, `settings.js` y los metadatos del proyecto.

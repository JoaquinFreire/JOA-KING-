from instagram_followers import get_relationships

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ==========================================
# CONFIGURACIÓN
# ==========================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

SESSION_FILE = os.path.join(
    BASE_DIR,
    "instagram_storage.json"
)

MI_USUARIO = os.environ.get("INSTAGRAM_USERNAME", "variableweb")


# ==========================================
# OBTENER ID DE UN USUARIO
# ==========================================

def get_user_id(page, username):

    response = page.request.get(
        "https://www.instagram.com/api/v1/web/search/topsearch/",
        params={
            "context": "blended",
            "query": username,
            "include_reel": "false"
        },
        headers={
            "X-IG-App-ID": "936619743392459"
        }
    )

    if response.status in [401, 403, 429]:

        raise Exception(
            f"Instagram rechazó la solicitud "
            f"(HTTP {response.status})."
        )

    if not response.ok:

        raise Exception(
            f"Error buscando usuario: "
            f"HTTP {response.status}"
        )

    data = response.json()

    users = data.get(
        "users",
        []
    )

    for item in users:

        user = item.get(
            "user",
            {}
        )

        if (
            user.get(
                "username",
                ""
            ).lower()
            == username.lower()
        ):

            return user.get("pk")

    return None


# ==========================================
# COMPROBAR SI VARIABLEWEB SIGUE AL USUARIO
# ==========================================

def check_following(page, target_username):

    print(
        f"Comprobando relación entre "
        f"@{MI_USUARIO} y @{target_username}..."
    )

    print()

    target_id = get_user_id(
        page,
        target_username
    )

    if not target_id:

        return False, None

    # Endpoint de relación entre nuestra cuenta
    # y el usuario consultado.
    response = page.request.get(
        f"https://www.instagram.com/api/v1/"
        f"friendships/show/{target_id}/",
        headers={
            "X-IG-App-ID": "936619743392459"
        }
    )

    if response.status in [401, 403, 429]:

        raise Exception(
            f"Instagram rechazó la comprobación "
            f"(HTTP {response.status})."
        )

    if not response.ok:

        raise Exception(
            f"Error comprobando relación: "
            f"HTTP {response.status}"
        )

    data = response.json()

    # Instagram devuelve distintos campos según
    # el estado de la relación.
    following = data.get(
        "following",
        False
    )

    return bool(following), target_id


# ==========================================
# COMPROBAR RELACIÓN CON ESPERA MANUAL
# ==========================================

def wait_until_following(page, username, interactive=False):

    profile_url = (
        "https://www.instagram.com/"
        f"{username}/"
    )

    while True:

        try:

            is_following, user_id = check_following(
                page,
                username
            )

        except Exception:

            raise

        if user_id is None:

            print("❌ No se encontró el usuario.")

            return False


        if is_following:

            print(
                f"✅ @{MI_USUARIO} sigue a "
                f"@{username}."
            )

            print()

            return True


        # ==========================================
        # TODAVÍA NO LO SIGUE
        # ==========================================

        print(
            "❌ Todavía no se siguen."
        )

        print()

        print(
            f"@{MI_USUARIO} todavía NO sigue "
            f"a @{username}."
        )

        if not interactive:
            print(
                "La cuenta configurada todavía no sigue "
                f"a @{username}."
            )
            return False

        print()

        print(
            "Abrí Instagram y seguí manualmente "
            f"a @{username} desde @{MI_USUARIO}."
        )

        print()

        print(
            "Perfil:"
        )

        print(
            profile_url
        )

        print()

        print(
            "Si la cuenta es privada, esperá a que "
            "acepte la solicitud."
        )

        print()

        input(
            "Cuando @"
            + MI_USUARIO
            + " ya lo siga, presioná ENTER "
            "para volver a comprobar..."
        )

        print()

        print(
            "Volviendo a comprobar..."
        )

        print()

        # Pequeña espera para darle tiempo a Instagram
        time.sleep(2)


# ==========================================
# PROGRAMA PRINCIPAL
# ==========================================

print("================================")
print("     INSTAGRAM FOLLOW CHECK")
print("================================")
print()


if len(sys.argv) < 2:
    print("Uso: python compare_following.py usuario [archivo_salida.json]")
    sys.exit(2)

username = sys.argv[1].strip()
output_file = sys.argv[2] if len(sys.argv) >= 3 else os.path.join(
    BASE_DIR,
    "ignofollow_result.json"
)

username = username.lstrip("@")


if not username:

    print(
        "No ingresaste ningún username."
    )

    exit()


if username.lower() == MI_USUARIO.lower():

    print()

    print(
        "No podés consultar la propia cuenta "
        "de @"
        + MI_USUARIO
        + "."
    )

    exit()


print()

print(
    f"Usuario objetivo: @{username}"
)

print(
    f"Cuenta utilizada: @{MI_USUARIO}"
)

print()


# ==========================================
# COMPROBAR QUE EXISTE LA SESIÓN
# ==========================================

if not os.path.exists(SESSION_FILE):

    print(
        "ERROR: no existe el archivo:"
    )

    print(
        SESSION_FILE
    )

    exit()


try:

    # ==========================================
    # ABRIR SESIÓN INSTAGRAM
    # ==========================================

    with sync_playwright() as p:

        browser = p.chromium.launch(
            headless=True
        )

        context = browser.new_context(
            storage_state=SESSION_FILE,
            locale="es-AR"
        )

        page = context.new_page()


        page.goto(
            "https://www.instagram.com/",
            wait_until="domcontentloaded",
            timeout=60000
        )

        page.wait_for_timeout(2000)

        is_following, target_id = check_following(page, username)
        if target_id is None:
            raise Exception(f"No se encontró @{username}")

        if not is_following:
            with open(output_file, "w", encoding="utf-8") as file:
                json.dump({
                    "status": "not_following",
                    "username": username,
                    "account": MI_USUARIO
                }, file, ensure_ascii=False)
            browser.close()
            sys.exit(0)

        browser.close()


    # ==========================================
    # OBTENER SEGUIDOS
    # ==========================================

    print()
    print("================================")
    print("         OBTENIENDO SEGUIDOS")
    print("================================")
    print()

    seguidos = get_relationships(
        username,
        tipo="following"
    )

    print()

    print(
        f"Seguidos obtenidos: "
        f"{len(seguidos)}"
    )

    print()


    # ==========================================
    # OBTENER SEGUIDORES
    # ==========================================

    print("================================")
    print("        OBTENIENDO SEGUIDORES")
    print("================================")
    print()

    seguidores = get_relationships(
        username,
        tipo="followers"
    )

    print()

    print(
        f"Seguidores obtenidos: "
        f"{len(seguidores)}"
    )

    print()


    # ==========================================
    # CREAR CONJUNTOS
    # ==========================================

    usernames_seguidos = {

        user["username"].lower()

        for user in seguidos

        if user.get("username")

    }


    usernames_seguidores = {

        user["username"].lower()

        for user in seguidores

        if user.get("username")

    }


    # ==========================================
    # COMPARACIÓN
    #
    # SEGUIDOS - SEGUIDORES
    #
    # Personas que la cuenta sigue
    # pero NO siguen de vuelta
    # ==========================================

    no_la_siguen = (

        usernames_seguidos
        -
        usernames_seguidores

    )


    # ==========================================
    # RECUPERAR DATOS COMPLETOS
    # ==========================================

    usuarios_no_la_siguen = [

        user

        for user in seguidos

        if (

            user.get("username")

            and

            user["username"].lower()
            in no_la_siguen

        )

    ]


    # ==========================================
    # AGREGAR LINK DE INSTAGRAM
    # ==========================================

    for user in usuarios_no_la_siguen:

        user["profile_url"] = (

            "https://www.instagram.com/"
            f"{user['username']}/"

        )


    # ==========================================
    # MOSTRAR RESULTADO
    # ==========================================

    print()

    print("================================")
    print("     NO LE DEVUELVEN EL FOLLOW")
    print("================================")
    print()


    if not usuarios_no_la_siguen:

        print(
            "Todos los usuarios seguidos "
            "también siguen a la cuenta."
        )

        print()

    else:

        for i, user in enumerate(
            usuarios_no_la_siguen,
            start=1
        ):

            username_resultado = (

                user.get("username")
                or "sin_username"

            )

            nombre = (

                user.get("full_name")
                or ""

            )

            profile_url = (

                user.get("profile_url")

            )


            print(

                f"{i}. "
                f"@{username_resultado}"
                f" - {nombre}"

            )

            print(

                f"   {profile_url}"

            )

            print()


    # ==========================================
    # RESUMEN
    # ==========================================

    print("================================")
    print("             RESUMEN")
    print("================================")
    print()

    print(
        f"Seguidos: {len(seguidos)}"
    )

    print(
        f"Seguidores: {len(seguidores)}"
    )

    print(
        f"No le devuelven el follow: "
        f"{len(usuarios_no_la_siguen)}"
    )


    # ==========================================
    # GUARDAR RESULTADO
    # ==========================================

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            usuarios_no_la_siguen,
            file,
            indent=4,
            ensure_ascii=False
        )


    print()

    print("================================")

    print(
        "Resultado guardado en:"
    )

    print(
        output_file
    )

    print("================================")


except Exception as e:

    print()

    print("================================")
    print("             ERROR")
    print("================================")
    print()

    print(
        type(e).__name__
    )

    print(
        str(e)
    )
    sys.exit(1)

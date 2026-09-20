import os
import time
import random

from playwright.sync_api import sync_playwright


BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

SESSION_FILE = os.path.join(
    BASE_DIR,
    "instagram_storage.json"
)


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

    if not response.ok:
        raise Exception(
            f"Error buscando usuario: HTTP {response.status}"
        )

    data = response.json()

    users = data.get("users", [])

    for item in users:

        user = item.get("user", {})

        if user.get(
            "username",
            ""
        ).lower() == username.lower():

            return user.get("pk")

    return None


def get_relationships(
    username,
    tipo="followers",
    limit=None
):

    if tipo not in [
        "followers",
        "following"
    ]:
        raise ValueError(
            "tipo debe ser 'followers' o 'following'"
        )

    if not os.path.exists(SESSION_FILE):
        raise FileNotFoundError(
            f"No existe:\n{SESSION_FILE}"
        )

    with sync_playwright() as p:

        browser = p.chromium.launch(
            headless=True
        )

        context = browser.new_context(
            storage_state=SESSION_FILE,
            locale="es-AR"
        )

        page = context.new_page()

        # ======================================
        # ABRIR INSTAGRAM
        # ======================================

        page.goto(
            "https://www.instagram.com/",
            wait_until="domcontentloaded",
            timeout=60000
        )

        page.wait_for_timeout(2000)

        # ======================================
        # OBTENER ID
        # ======================================

        print(
            f"Buscando ID de @{username}..."
        )

        user_id = get_user_id(
            page,
            username
        )

        if not user_id:

            browser.close()

            raise Exception(
                f"No se encontró @{username}"
            )

        print(
            f"ID encontrado: {user_id}"
        )

        print()

        # ======================================
        # ENDPOINT
        # ======================================

        endpoint = (
            "https://www.instagram.com/api/v1/"
            f"friendships/{user_id}/{tipo}/"
        )

        usuarios = []

        max_id = None

        pagina = 0

        # ======================================
        # PAGINACIÓN
        # ======================================

        while True:

            pagina += 1

            params = {
                "count": "50"
            }

            if max_id:

                params["max_id"] = max_id

            print(
                f"Página {pagina} | "
                f"Usuarios acumulados: {len(usuarios)}"
            )

            response = page.request.get(
                endpoint,
                params=params,
                headers={
                    "X-IG-App-ID": "936619743392459"
                }
            )

            print(
                f"HTTP {response.status}"
            )

            # ==================================
            # RESTRICCIONES
            # ==================================

            if response.status == 429:

                browser.close()

                raise Exception(
                    "Instagram devolvió HTTP 429 "
                    "(demasiadas solicitudes)."
                )

            if response.status in [
                401,
                403
            ]:

                browser.close()

                raise Exception(
                    f"Instagram rechazó la solicitud "
                    f"(HTTP {response.status})."
                )

            if not response.ok:

                browser.close()

                raise Exception(
                    f"Error HTTP {response.status}"
                )

            data = response.json()

            # ==================================
            # MOSTRAR INFORMACIÓN DE PAGINACIÓN
            # ==================================

            print(
                "next_max_id:",
                data.get("next_max_id")
            )

            print(
                "more_available:",
                data.get("more_available")
            )

            print(
                "users recibidos:",
                len(data.get("users", []))
            )

            # ==================================
            # USUARIOS
            # ==================================

            nuevos = data.get(
                "users",
                []
            )

            if not nuevos:

                print(
                    "No se recibieron más usuarios."
                )

                break

            for user in nuevos:

                usuarios.append({

                    "username": user.get(
                        "username"
                    ),

                    "full_name": user.get(
                        "full_name"
                    ),

                    "pk": user.get(
                        "pk"
                    ),

                    "is_private": user.get(
                        "is_private"
                    ),

                    "is_verified": user.get(
                        "is_verified"
                    ),

                    "profile_pic_url": user.get(
                        "profile_pic_url"
                    )
                })

                if (
                    limit is not None
                    and len(usuarios) >= limit
                ):

                    usuarios = usuarios[:limit]

                    browser.close()

                    return usuarios

            # ==================================
            # PAGINACIÓN
            # ==================================

            nuevo_max_id = data.get(
                "next_max_id"
            )

            if nuevo_max_id:

                max_id = nuevo_max_id

            elif data.get("more_available"):

                print(
                    "Instagram indica que hay más "
                    "usuarios, pero no entregó "
                    "next_max_id."
                )

                print(
                    "DETENIENDO para no repetir "
                    "la misma página."
                )

                break

            else:

                print(
                    "Instagram indica que no hay "
                    "más usuarios."
                )

                break

            # ==================================
            # ESPERA
            # ==================================

            espera = random.uniform(1.5, 3.5)

            print(
                f"Esperando {espera:.1f} segundos..."
            )

            time.sleep(
                espera

            )

        browser.close()

        return usuarios
from instagrapi import Client
from getpass import getpass
import argparse
import json
import os


SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session.json")


def iniciar_sesion(cl):
    username = input("Tu usuario de Instagram: ").strip()
    password = getpass("Tu contraseña: ")

    print()
    print("Iniciando sesión...")

    cl.login(username, password)

    cl.dump_settings(SESSION_FILE)

    print("Sesión guardada correctamente.")


def cargar_sesion(cl):
    print("Cargando sesión guardada...")

    cl.load_settings(SESSION_FILE)

    try:
        # Verificamos que la sesión realmente siga funcionando
        cl.get_timeline_feed()

        print("Sesión cargada correctamente.")
        return True

    except Exception as e:
        print(f"No se pudo utilizar la sesión guardada: {type(e).__name__}")
        return False


def buscar_perfil(cl, username):
    print()
    print("=" * 50)
    print("       BUSCANDO PERFIL DE INSTAGRAM")
    print("=" * 50)
    print(f"Username: {username}")
    print()

    user = cl.user_info_by_username(username)

    print("=" * 50)
    print("           INSTAGRAM PROFILE")
    print("=" * 50)

    profile = {
        "username": user.username,
        "full_name": user.full_name,
        "pk": user.pk,
        "follower_count": user.follower_count,
        "following_count": user.following_count,
        "media_count": user.media_count,
        "is_private": user.is_private,
        "is_verified": user.is_verified,
        "biography": user.biography,
        "profile_pic_url": str(user.profile_pic_url),
        "profile_pic_url_hd": str(getattr(user, "profile_pic_url_hd", "") or ""),
    }

    print(f"Username       : {profile['username']}")
    print(f"Nombre         : {profile['full_name']}")
    print(f"ID             : {profile['pk']}")
    print(f"Seguidores     : {profile['follower_count']}")
    print(f"Siguiendo      : {profile['following_count']}")
    print(f"Publicaciones  : {profile['media_count']}")
    print(f"Privada        : {'Sí' if profile['is_private'] else 'No'}")
    print(f"Verificada     : {'Sí' if profile['is_verified'] else 'No'}")
    print(f"Bio            : {profile['biography']}")
    print(f"Foto perfil    : {profile['profile_pic_url']}")

    print()
    print("-" * 50)

    print()
    print(f"URL            : https://www.instagram.com/{user.username}/")
    print("=" * 50)
    return profile


def buscar_perfil_json(username):
    cl = Client()
    if not os.path.exists(SESSION_FILE):
        raise FileNotFoundError(f"No existe la sesión de Instagram: {SESSION_FILE}")

    cl.load_settings(SESSION_FILE)
    user = cl.user_info_by_username(username)
    profile = {
        "username": user.username,
        "full_name": user.full_name,
        "pk": user.pk,
        "follower_count": user.follower_count,
        "following_count": user.following_count,
        "media_count": user.media_count,
        "is_private": user.is_private,
        "is_verified": user.is_verified,
        "biography": user.biography or "",
        "profile_pic_url": str(user.profile_pic_url),
        "profile_pic_url_hd": str(getattr(user, "profile_pic_url_hd", "") or ""),
        "url": f"https://www.instagram.com/{user.username}/",
    }
    print(json.dumps(profile, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", dest="json_username", help="Devuelve el perfil en JSON usando la sesión guardada")
    arguments = parser.parse_args()

    if arguments.json_username:
        try:
            buscar_perfil_json(arguments.json_username.lstrip("@"))
        except Exception as error:
            import sys
            print(f"{type(error).__name__}: {error}", file=sys.stderr)
            raise SystemExit(1)
        return

    cl = Client()

    # Si ya existe una sesión, intentamos reutilizarla
    if os.path.exists(SESSION_FILE):

        if not cargar_sesion(cl):
            print()
            print("La sesión guardada ya no funciona.")
            print("Vamos a iniciar sesión nuevamente.")
            iniciar_sesion(cl)

    else:
        print("No existe una sesión guardada.")
        iniciar_sesion(cl)

    print()

    username = input("Username que querés buscar: ").strip()
    username = username.lstrip("@")

    if not username:
        print("No ingresaste ningún username.")
        return

    try:
        buscar_perfil(cl, username)

    except Exception as e:
        print()
        print("=" * 50)
        print("ERROR")
        print("=" * 50)
        print(type(e).__name__)
        print(e)
        print("=" * 50)


if __name__ == "__main__":
    main()
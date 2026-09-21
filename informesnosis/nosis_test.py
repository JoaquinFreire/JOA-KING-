from playwright.sync_api import sync_playwright
import re
import time
import unicodedata


URL = "https://informes.nosis.com/"


# ============================================================
# UTILIDADES
# ============================================================

def limpiar(texto):
    return " ".join(texto.strip().split())


def normalizar(texto):
    texto = texto.strip().lower()

    texto = unicodedata.normalize(
        "NFD",
        texto
    )

    texto = "".join(
        c
        for c in texto
        if unicodedata.category(c) != "Mn"
    )

    return texto


def pedir_dato(nombre):
    return input(f"{nombre}: ").strip()


# ============================================================
# SELECTS VISIBLES
# ============================================================

def obtener_selects(page):

    resultado = []

    selects = page.locator("select")

    for i in range(selects.count()):

        select = selects.nth(i)

        try:
            if select.is_visible():
                resultado.append(select)

        except Exception:
            pass

    return resultado


# ============================================================
# ENCONTRAR SELECT DE TIPO
# ============================================================

def encontrar_select_tipo(page):

    for select in obtener_selects(page):

        opciones = select.locator("option")

        textos = []

        for i in range(opciones.count()):

            textos.append(
                normalizar(
                    opciones.nth(i).inner_text()
                )
            )

        if (
            "personas" in textos
            and "empresas" in textos
        ):
            return select

    return None


def seleccionar_personas(page):

    select = encontrar_select_tipo(page)

    if select is None:

        print(
            "⚠️ No encontré el selector Tipo."
        )

        return False

    opciones = select.locator("option")

    for i in range(opciones.count()):

        opcion = opciones.nth(i)

        texto = limpiar(
            opcion.inner_text()
        )

        if normalizar(texto) == "personas":

            valor = opcion.get_attribute(
                "value"
            )

            try:

                if valor:

                    select.select_option(
                        value=valor
                    )

                else:

                    select.select_option(
                        label=texto
                    )

                print(
                    "✓ Tipo: Personas"
                )

                return True

            except Exception as e:

                print(
                    "⚠️ Error seleccionando Personas:",
                    e
                )

                return False

    return False


# ============================================================
# ENCONTRAR LOS DOS SELECTS DE EDAD
# ============================================================

def encontrar_selects_edad(page):

    encontrados = []

    for select in obtener_selects(page):

        try:

            opciones = select.locator("option")

            numeros = set()

            for i in range(opciones.count()):

                texto = limpiar(
                    opciones.nth(i).inner_text()
                )

                if texto.isdigit():

                    numero = int(texto)

                    if 18 <= numero <= 100:

                        numeros.add(numero)

            if len(numeros) >= 70:

                encontrados.append(select)

        except Exception:

            pass

    return encontrados


def seleccionar_edades(
    page,
    edad_desde,
    edad_hasta
):

    selects = encontrar_selects_edad(page)

    if len(selects) < 2:

        print(
            "⚠️ No encontré los dos desplegables de edad."
        )

        return False

    try:

        selects[0].select_option(
            label=str(edad_desde)
        )

        print(
            f"✓ Edad desde: {edad_desde}"
        )

        selects[1].select_option(
            label=str(edad_hasta)
        )

        print(
            f"✓ Edad hasta: {edad_hasta}"
        )

        return True

    except Exception as e:

        print(
            "⚠️ Error seleccionando edades:",
            e
        )

        return False


# ============================================================
# PROVINCIA
# ============================================================

def encontrar_select_provincia(page):

    provincias = {
        "capital federal",
        "buenos aires",
        "catamarca",
        "chaco",
        "chubut",
        "cordoba",
        "corrientes",
        "entre rios",
        "formosa",
        "jujuy",
        "la pampa",
        "la rioja",
        "mendoza",
        "misiones",
        "neuquen",
        "rio negro",
        "salta",
        "san juan",
        "san luis",
        "santa cruz",
        "santa fe",
        "santiago del estero",
        "tierra del fuego",
        "tucuman"
    }

    for select in obtener_selects(page):

        opciones = select.locator("option")

        coincidencias = 0

        for i in range(opciones.count()):

            texto = normalizar(
                opciones.nth(i).inner_text()
            )

            if texto in provincias:

                coincidencias += 1

        if coincidencias >= 15:

            return select

    return None


def seleccionar_provincia(page, provincia):

    select = encontrar_select_provincia(page)

    if select is None:

        print(
            "⚠️ No encontré el selector Provincia."
        )

        return False

    buscada = normalizar(provincia)

    opciones = select.locator("option")

    for i in range(opciones.count()):

        opcion = opciones.nth(i)

        texto = limpiar(
            opcion.inner_text()
        )

        if normalizar(texto) == buscada:

            valor = opcion.get_attribute(
                "value"
            )

            try:

                if valor:

                    select.select_option(
                        value=valor
                    )

                else:

                    select.select_option(
                        label=texto
                    )

                print(
                    f"✓ Provincia: {texto}"
                )

                return True

            except Exception as e:

                print(
                    "⚠️ Error seleccionando provincia:",
                    e
                )

                return False

    print(
        f"⚠️ Provincia no encontrada: {provincia}"
    )

    return False


# ============================================================
# LOCALIDAD
# ============================================================

def encontrar_localidad(page):

    inputs = page.locator("input")

    for i in range(inputs.count()):

        elemento = inputs.nth(i)

        try:

            if not elemento.is_visible():
                continue

            placeholder = normalizar(
                elemento.get_attribute(
                    "placeholder"
                ) or ""
            )

            name = normalizar(
                elemento.get_attribute(
                    "name"
                ) or ""
            )

            id_ = normalizar(
                elemento.get_attribute(
                    "id"
                ) or ""
            )

            texto = (
                placeholder
                + " "
                + name
                + " "
                + id_
            )

            if "localidad" in texto:

                return elemento

        except Exception:

            pass

    return None


def seleccionar_localidad(page, localidad):

    campo = encontrar_localidad(page)

    if campo is None:

        print(
            "⚠️ No encontré el campo Localidad."
        )

        return False

    campo.fill(localidad)

    print(
        f"✓ Localidad: {localidad}"
    )

    return True


# ============================================================
# BOTÓN APLICAR
# ============================================================

def encontrar_boton_aplicar(page):

    botones = page.locator(
        "button, input[type='button'], input[type='submit']"
    )

    for i in range(botones.count()):

        boton = botones.nth(i)

        try:

            if not boton.is_visible():
                continue

            tag = boton.evaluate(
                "(el) => el.tagName"
            )

            if tag == "BUTTON":

                texto = boton.inner_text()

            else:

                texto = (
                    boton.get_attribute(
                        "value"
                    ) or ""
                )

            if normalizar(texto) == "aplicar":

                return boton

        except Exception:

            pass

    return None


# ============================================================
# APLICAR FILTROS
# ============================================================

def aplicar_filtros(
    page,
    edad_desde,
    edad_hasta,
    provincia,
    localidad
):

    print()
    print(
        "Aplicando filtros..."
    )

    # --------------------------------------------------------
    # PERSONAS
    # --------------------------------------------------------

    seleccionar_personas(page)

    # --------------------------------------------------------
    # EDAD
    # --------------------------------------------------------

    if (
        edad_desde is not None
        and edad_hasta is not None
    ):

        seleccionar_edades(
            page,
            edad_desde,
            edad_hasta
        )

    # --------------------------------------------------------
    # PROVINCIA
    # --------------------------------------------------------

    if provincia:

        seleccionar_provincia(
            page,
            provincia
        )

    # --------------------------------------------------------
    # LOCALIDAD
    # --------------------------------------------------------

    if localidad:

        seleccionar_localidad(
            page,
            localidad
        )

    # --------------------------------------------------------
    # APLICAR
    # --------------------------------------------------------

    boton = encontrar_boton_aplicar(page)

    if boton is None:

        print(
            "❌ No encontré el botón Aplicar."
        )

        return False

    print(
        "✓ Haciendo click en Aplicar..."
    )

    try:

        boton.click()

        # Esperamos a que Nosis procese
        time.sleep(5)

        return True

    except Exception as e:

        print(
            "❌ Error al aplicar filtros:",
            e
        )

        return False


# ============================================================
# CAPTCHA
# ============================================================

def comprobar_captcha(page):

    try:
        texto = page.locator(
            "body"
        ).inner_text()

        texto_normalizado = normalizar(
            texto
        )

        # IMPORTANTE:
        # Buscamos solamente señales que realmente
        # aparecen en el texto visible de la página.
        #
        # NO buscamos "captcha" solamente porque puede
        # aparecer dentro del HTML/JavaScript.

        if (
            "no soy un robot" in texto_normalizado
            or "verificacion de seguridad" in texto_normalizado
            or "verificación de seguridad" in texto_normalizado
        ):

            print()
            print("=" * 60)
            print("⚠️ CAPTCHA DETECTADO")
            print("=" * 60)

            print()
            print(
                "Nosis solicita una verificación."
            )

            return True

        return False

    except Exception:
        return False


# ============================================================
# EXTRAER RESULTADOS
# ============================================================

def extraer_resultados(texto):

    patron = re.compile(
        r"(\d{2}-\d{8}-\d)\s+"
        r"([A-Za-zÁÉÍÓÚáéíóúÑñÜü'\-. ]+?)\s+"
        r"Actividad:\s*(.*?)\s+"
        r"Provincia:\s*"
        r"([A-Za-zÁÉÍÓÚáéíóúÑñÜü ]+?)"
        r"\s+Consultar Informe",
        re.IGNORECASE | re.DOTALL
    )

    resultados = []

    for match in patron.findall(texto):

        resultados.append({
            "cuit": limpiar(match[0]),
            "nombre": limpiar(match[1]),
            "actividad": limpiar(match[2]),
            "provincia": limpiar(match[3])
        })

    return resultados


# ============================================================
# MOSTRAR RESULTADOS
# ============================================================

def mostrar_resultados(
    resultados,
    hay_mas_de_10=False
):

    print()
    print("=" * 60)
    print("RESULTADO NOSIS")
    print("=" * 60)

    if hay_mas_de_10:

        print()
        print(
            "⚠️ Hay más de 10 resultados."
        )

        print(
            "Se muestran los primeros resultados."
        )

    if not resultados:

        print(
            "\nNo se encontraron resultados."
        )

    else:

        for i, resultado in enumerate(
            resultados[:10],
            1
        ):

            print()
            print(
                f"#{i}"
            )

            print(
                f"CUIT      : {resultado['cuit']}"
            )

            print(
                f"Nombre    : {resultado['nombre']}"
            )

            print(
                f"Actividad : {resultado['actividad']}"
            )

            print(
                f"Provincia : {resultado['provincia']}"
            )

    print()
    print("=" * 60)


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 60)
    print(
        "                 BUSQUEDA NOSIS"
    )
    print("=" * 60)

    print()
    print(
        "Ingresá los datos que conozcas."
    )

    print(
        "Todos los campos son opcionales."
    )

    print()
    print("Ejemplo:")

    print(
        "Nombre: Juan Perez"
    )

    print(
        "DNI / CUIT: 54656465"
    )

    print(
        "Edad: 30-40"
    )

    print(
        "Provincia: Cordoba"
    )

    print(
        "Localidad: Cordoba"
    )

    print()
    print("=" * 60)

    nombre = pedir_dato(
        "Nombre"
    )

    dni = pedir_dato(
        "DNI / CUIT"
    )

    edad = pedir_dato(
        "Edad o rango (ej: 30-40)"
    )

    provincia = pedir_dato(
        "Provincia"
    )

    localidad = pedir_dato(
        "Localidad"
    )

    # ========================================================
    # EDAD
    # ========================================================

    edad_desde = None
    edad_hasta = None

    if edad:

        try:

            if "-" in edad:

                partes = edad.split(
                    "-",
                    1
                )

                edad_desde = int(
                    partes[0].strip()
                )

                edad_hasta = int(
                    partes[1].strip()
                )

            else:

                edad_desde = int(
                    edad
                )

                edad_hasta = edad_desde

        except ValueError:

            print()
            print(
                "❌ Edad inválida."
            )

            print(
                "Ejemplo: 20-25"
            )

            return

    # ========================================================
    # MOSTRAR FILTROS
    # ========================================================

    print()
    print("Filtros solicitados:")

    if edad_desde is not None:

        print(
            f"  Edad: {edad_desde}-{edad_hasta}"
        )

    if provincia:

        print(
            f"  Provincia: {provincia}"
        )

    if localidad:

        print(
            f"  Localidad: {localidad}"
        )

    print(
        "  Tipo: Personas"
    )

    # ========================================================
    # NAVEGADOR HEADLESS
    # ========================================================

    with sync_playwright() as p:

        # IMPORTANTE:
        # Chromium sigue funcionando,
        # pero NO se muestra ninguna ventana.
        browser = p.chromium.launch(
            headless=True
        )

        context = browser.new_context(
            locale="es-AR",
            viewport={
                "width": 1366,
                "height": 900
            },
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/140.0.0.0 Safari/537.36"
            )
        )

        page = context.new_page()

        try:

            # =================================================
            # PRIMERA BÚSQUEDA
            # =================================================

            print()
            print(
                "Abriendo Nosis..."
            )

            page.goto(
                URL,
                wait_until="domcontentloaded",
                timeout=60000
            )

            time.sleep(3)

            consulta = (
                dni
                if dni
                else nombre
            )

            if not consulta:

                print()
                print(
                    "❌ Tenés que ingresar "
                    "un nombre o DNI/CUIT."
                )

                return

            print(
                f"Buscando: {consulta}"
            )

            # =================================================
            # CAMPO PRINCIPAL
            # =================================================

            inputs = page.locator(
                "input[type='text']"
            )

            campo = None

            for i in range(inputs.count()):

                elemento = inputs.nth(i)

                try:

                    if elemento.is_visible():

                        campo = elemento

                        break

                except Exception:

                    pass

            if campo is None:

                print(
                    "❌ No encontré el campo de búsqueda."
                )

                return

            campo.fill(
                consulta
            )

            # =================================================
            # BOTÓN BUSCAR INFORME
            # =================================================

            botones = page.locator(
                "button, input[type='submit']"
            )

            boton_buscar = None

            for i in range(botones.count()):

                boton = botones.nth(i)

                try:

                    if not boton.is_visible():
                        continue

                    tag = boton.evaluate(
                        "(el) => el.tagName"
                    )

                    if tag == "BUTTON":

                        texto = boton.inner_text()

                    else:

                        texto = (
                            boton.get_attribute(
                                "value"
                            ) or ""
                        )

                    texto = normalizar(
                        texto
                    )

                    if "buscar informe" in texto:

                        boton_buscar = boton

                        break

                except Exception:

                    pass

            if boton_buscar is None:

                print(
                    "❌ No encontré Buscar Informe."
                )

                return

            print(
                "Ejecutando búsqueda inicial..."
            )

            boton_buscar.click()
            print()
            print("Leyendo resultado...")
            print()

            texto = page.locator("body").inner_text()

            print("=" * 60)
            print("TEXTO DEVUELTO POR NOSIS")
            print("=" * 60)
            print(texto[:5000])
            print("=" * 60)
            # Esperar respuesta de Nosis
            time.sleep(5)

            # =================================================
            # CAPTCHA
            # =================================================

            if comprobar_captcha(page):

                print()
                print(
                    "La búsqueda quedó detenida "
                    "porque Nosis solicita CAPTCHA."
                )

                return

            # =================================================
            # RESULTADO INICIAL
            # =================================================

            texto = page.locator(
                "body"
            ).inner_text()

            texto_normalizado = normalizar(
                texto
            )

            mas_de_10 = (
                "más de 10 resultados"
                in texto_normalizado
                or
                "mas de 10 resultados"
                in texto_normalizado
            )

            # =================================================
            # SI HAY MÁS DE 10
            # =================================================

            if mas_de_10:

                print()
                print(
                    "Nosis encontró más de 10 resultados."
                )

                hay_filtros = (
                    edad_desde is not None
                    or edad_hasta is not None
                    or provincia
                    or localidad
                )

                if hay_filtros:

                    print(
                        "Ahora voy a aplicar los filtros..."
                    )

                    ok = aplicar_filtros(
                        page,
                        edad_desde,
                        edad_hasta,
                        provincia,
                        localidad
                    )

                    if not ok:

                        print(
                            "\n❌ No pude aplicar "
                            "los filtros."
                        )

                        return

                    # Esperar resultados
                    time.sleep(5)

                    # -----------------------------------------
                    # CAPTCHA DESPUÉS DE FILTRAR
                    # -----------------------------------------

                    if comprobar_captcha(page):

                        print()
                        print(
                            "Nosis solicita CAPTCHA "
                            "después de aplicar filtros."
                        )

                        return

                    texto = page.locator(
                        "body"
                    ).inner_text()

                    texto_normalizado = normalizar(
                        texto
                    )

                    mas_de_10 = (
                        "más de 10 resultados"
                        in texto_normalizado
                        or
                        "mas de 10 resultados"
                        in texto_normalizado
                    )

                    resultados = extraer_resultados(
                        texto
                    )

                    mostrar_resultados(
                        resultados,
                        mas_de_10
                    )

                else:

                    print()
                    print(
                        "⚠️ Hay más de 10 resultados."
                    )

                    print(
                        "Agregá edad, provincia o localidad "
                        "para hacer la búsqueda más precisa."
                    )

            # =================================================
            # MENOS DE 10
            # =================================================

            else:

                resultados = extraer_resultados(
                    texto
                )

                mostrar_resultados(
                    resultados,
                    False
                )

        except Exception as e:

            print()
            print("=" * 60)
            print("ERROR")
            print("=" * 60)

            print()
            print(
                type(e).__name__
            )

            print(
                e
            )

        finally:

            context.close()
            browser.close()


# ============================================================
# EJECUTAR
# ============================================================

if __name__ == "__main__":
    main()
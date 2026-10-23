
from datetime import datetime
from pathlib import Path

from chatgen import (
    Generator,
    Dialog,
    Participant,
    Message,
    Text,
    Platform,
    DeviceView,
    Theme,
    MessageStatus,
)

# Participantes
yo = Participant(
    id="yo",
    name="Joaquin",
    is_self=True,
)

ana = Participant(
    id="ana",
    name="Ana",
    subtitle="en línea",
)

lucas = Participant(
    id="lucas",
    name="Lucas",
)

# Conversacion de prueba
dialogo = Dialog(
    participants=[yo, ana, lucas],
    messages=[
        Message(
            ana,
            datetime(2026, 10, 21, 22, 10),
            Text("Hola chicos, ¿están?"),
        ),
        Message(
            yo,
            datetime(2026, 10, 21, 22, 11),
            Text("Sí jajaja, ¿qué pasó?"),
            status=MessageStatus.READ,
        ),
        Message(
            lucas,
            datetime(2026, 10, 21, 22, 12),
            Text("Mañana jugamos Minecraft?"),
        ),
        Message(
            ana,
            datetime(2026, 10, 21, 22, 13),
            Text("Dale, de una 😂"),
        ),
        Message(
            yo,
            datetime(2026, 10, 21, 22, 14),
            Text("A las 10 estoy conectado."),
            status=MessageStatus.READ,
        ),
    ],
)

generador = Generator()

# Generar HTML independiente
html = generador.generate(
    dialogo,
    platform=Platform.WHATSAPP,
    view=DeviceView.ANDROID,
    theme=Theme.LIGHT,
    is_group=True,
    wallpaper="doodle",
)

Path("chat.html").write_text(html, encoding="utf-8")
print("Creado: chat.html")

# Generar captura PNG
generador.generate_png(
    dialogo,
    platform=Platform.WHATSAPP,
    view=DeviceView.ANDROID,
    theme=Theme.LIGHT,
    is_group=True,
    wallpaper="doodle",
    path="chat.png",
    scale=2,
)
print("Creado: chat.png")

# Generar video con los mensajes apareciendo
generador.generate_video(
    dialogo,
    platform=Platform.WHATSAPP,
    view=DeviceView.ANDROID,
    theme=Theme.LIGHT,
    is_group=True,
    wallpaper="doodle",
    path="chat.mp4",
    fps=25,
    animate_delay=1000,
)
print("Creado: chat.mp4")

import html
import base64
import json
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from chatgen import Dialog, DeviceView, Generator, Image, Message, MessageStatus, Participant, Platform, Sticker, Text, Theme
import chatgen
from chatgen.assets import placeholder_avatar
from chatgen.devices import get_device
from chatgen.screenshot import html_to_png
from chatgen.video import html_to_video
from markupsafe import Markup


def emoji_key(value):
    return "-".join(f"{ord(character):x}" for character in value)


def render_whatsapp_emojis(sequences):
    cache_dir = Path(__file__).parent / ".cache" / "whatsapp-emojis"
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths = {sequence: cache_dir / f"{emoji_key(sequence)}.png" for sequence in sequences}
    missing = [(sequence, path) for sequence, path in paths.items() if not path.is_file()]
    if missing:
        font_path = Path(__file__).with_name("WhatsAppEmoji.ttf")
        font_data = base64.b64encode(font_path.read_bytes()).decode("ascii")
        spans = "".join(
            f'<span id="emoji-{index}">{html.escape(sequence)}</span>'
            for index, (sequence, _) in enumerate(missing)
        )
        page_html = (
            '<!doctype html><html><head><meta charset="utf-8"><style>'
            f'@font-face{{font-family:WhatsAppEmoji;src:url(data:font/ttf;base64,{font_data}) format("truetype")}}'
            'html,body{margin:0;background:transparent}body{display:flex;flex-wrap:wrap;align-items:center}'
            'span{font-family:WhatsAppEmoji,"Segoe UI Emoji";font-size:100px;line-height:1.15;display:inline-block;padding:4px}'
            '</style></head><body>' + spans + '</body></html>'
        )
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1200, "height": 500})
                page.set_content(page_html, wait_until="load")
                page.evaluate("() => document.fonts.ready")
                for index, (_, path) in enumerate(missing):
                    page.locator(f"#emoji-{index}").screenshot(path=str(path), omit_background=True)
            finally:
                browser.close()
    return {
        sequence: f"data:image/png;base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
        for sequence, path in paths.items()
        if path.is_file()
    }


def text_with_whatsapp_emojis(value, emoji_assets):
    text = str(value or "")
    parts = []
    cursor = 0
    for mention in re.finditer("\uE000(.*?)\uE001", text):
        parts.append(html.escape(text[cursor:mention.start()], quote=False))
        parts.append(f'<span class="screenw-mention">@{html.escape(mention.group(1), quote=False)}</span>')
        cursor = mention.end()
    parts.append(html.escape(text[cursor:], quote=False))
    escaped = "".join(parts)
    for sequence in sorted(emoji_assets, key=len, reverse=True):
        image = f'<img class="screenw-emoji" alt="{html.escape(sequence, quote=True)}" src="{emoji_assets[sequence]}">'
        escaped = escaped.replace(html.escape(sequence, quote=False), image)
    # WhatsApp stores formatting markers in the message text. Convert them to
    # HTML only after escaping the original text and replacing emoji assets.
    formatting = re.compile(r'(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[\s\S]+?```|`[^`\n]+`)')
    tags = {'*': ('strong', 1), '_': ('em', 1), '~': ('del', 1), '`': ('code', 1), '```': ('code', 3)}

    def format_match(match):
        token = match.group(0)
        marker = '```' if token.startswith('```') else token[0]
        tag, marker_length = tags[marker]
        content = token[marker_length:-marker_length]
        return f'<{tag}>{content}</{tag}>'

    escaped = formatting.sub(format_match, escaped)
    return Markup(escaped)


def reply_body(reply, emoji_assets):
    text = str(reply.get("text") or "Mensaje")
    if reply.get("kind") != "image":
        return text_with_whatsapp_emojis(text, emoji_assets)

    icon = '<svg class="screenw-quote-image-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><circle cx="7" cy="8" r="1.5"/><path d="m4 15 4-4 2.5 2 2-2 3.5 4"/></svg>'
    label = html.escape(text, quote=False)
    thumbnail = ''
    if reply.get("image"):
        src = html.escape(str(reply["image"]), quote=True)
        thumbnail = f'<img class="screenw-quote-thumb" src="{src}" alt="Miniatura de la imagen citada">'
    return Markup(f'<span class="screenw-quote-layout"><span class="screenw-quote-kind">{icon}<span>{label}</span></span>{thumbnail}</span>')


def main():
    # Node writes UTF-8 bytes to the child process pipe; decode JSON's bytes as UTF-8
    # instead of using Windows' active console code page for sys.stdin.
    payload = json.loads(sys.stdin.buffer.read())
    zone = timezone(timedelta(hours=-3))
    emoji_assets = render_whatsapp_emojis(payload.get("emoji_sequences", []))
    participants = []
    by_id = {}
    for item in payload.get("participants", []):
        participant = Participant(
            id=item["id"],
            name=item.get("name") or "Usuario",
            avatar=payload.get("avatars", {}).get(item["id"]),
            is_self=bool(item.get("is_self")),
        )
        participants.append(participant)
        by_id[participant.id] = participant

    if not any(participant.is_self for participant in participants):
        self_participant = Participant(id="bot", name="T\u00fa", is_self=True)
        participants.append(self_participant)

    rendered_messages = []
    for item in payload.get("messages", []):
        sender_id = item["sender"]
        sender = by_id.get(sender_id)
        if sender is None:
            sender = Participant(id=sender_id, name=item.get("name") or "Usuario")
            participants.append(sender)
            by_id[sender_id] = sender
        timestamp = datetime.fromtimestamp(int(item["timestamp"]), tz=zone)
        reply_to = None
        if item.get("reply"):
            reply_sender = Participant(
                id=f"quoted:{sender_id}",
                name=item["reply"].get("name") or "Usuario",
            )
            reply_to = Message(
                sender=reply_sender,
                timestamp=timestamp,
                content=Text(reply_body(item["reply"], emoji_assets)),
            )
        rendered_messages.append(Message(
            sender=sender,
            timestamp=timestamp,
            content=(Image(src=item["image"], caption=text_with_whatsapp_emojis(item.get("text"), emoji_assets) if item.get("text") else None)
                     if item.get("image") else Sticker(src=item["sticker"]) if item.get("sticker")
                     else Text(text_with_whatsapp_emojis(item.get("text"), emoji_assets))),
            status=MessageStatus.READ if item.get("is_self") else MessageStatus.SENT,
            reply_to=reply_to,
        ))

    dialog = Dialog(
        participants=participants,
        messages=rendered_messages,
        meta={"group_name": payload.get("title") or "Grupo"},
    )
    generated_at = datetime.fromisoformat(payload["generated_at"].replace("Z", "+00:00")).astimezone(zone)
    theme = Theme.DARK if payload.get("theme") == "dark" else Theme.LIGHT
    mode = payload.get("mode")
    animate_start = 300
    animate_delay = 450
    generator = Generator()
    html_document = generator.generate(
        dialog,
        platform=Platform.WHATSAPP,
        view=DeviceView.ANDROID,
        theme=theme,
        is_group=True,
        wallpaper="doodle",
        clock=f"{generated_at.hour}:{generated_at.minute:02d}",
        battery=100,
        show_frame=False,
        animate=mode == "video",
        animate_start=animate_start,
        animate_delay=animate_delay,
    )

    group_avatar = payload.get("group_avatar") or placeholder_avatar(payload.get("title") or "Grupo")
    header_avatar = re.compile(r'(<img class="wa-avatar" src=")[^"]*(" alt="">)')
    html_document = header_avatar.sub(
        lambda match: match.group(1) + html.escape(group_avatar, quote=True) + match.group(2),
        html_document,
        count=1,
    )
    wallpaper_path = Path(__file__).resolve().parents[2] / "img" / ("imgdark.jpg" if theme == Theme.DARK else "imgnodark.jpg")
    wallpaper_bytes = wallpaper_path.read_bytes()
    wallpaper_image = f"url(data:image/jpeg;base64,{base64.b64encode(wallpaper_bytes).decode('ascii')})"
    wallpaper_color = "#0b141a" if theme == Theme.DARK else "#fff8fb"
    wallpaper_size = "cover"
    wallpaper = f"{wallpaper_image} center center/{wallpaper_size} no-repeat,{wallpaper_color}"
    html_document = re.sub(r'(<div class="wa cg-screen-inner[^>]*style=")[^"]*(")', lambda match: match.group(1) + html.escape(wallpaper, quote=True) + match.group(2), html_document, count=1)
    # chatgen's theme stylesheet declares its own wallpaper texture. Keep the
    # custom light/dark artwork visible even when that rule or the inline
    # background shorthand wins in the generated document.
    wallpaper_overrides = (
        ".wa.cg-screen-inner.wa-wallpaper{"
        f"background-image:{wallpaper_image}!important;"
        f"background-color:{wallpaper_color}!important;"
        f"background-size:{wallpaper_size}!important;"
        "background-position:center center!important;background-repeat:no-repeat!important}"
        ".wa-bubble .cg-reply{display:block;width:100%;box-sizing:border-box;min-height:48px}"
        ".screenw-quote-layout{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;width:100%}"
        ".screenw-quote-kind{display:inline-flex;align-items:center;gap:6px;min-width:0;color:#667781}"
        ".screenw-quote-kind span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
        ".screenw-quote-image-icon{width:18px;height:18px;flex:0 0 18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}"
        ".screenw-quote-thumb{width:54px;height:54px;object-fit:cover;border-radius:4px;flex:0 0 54px}"
        "[data-theme=dark] .screenw-quote-kind{color:#8696a0}"
        ".wa-mediabubble img.wa-img:not([src^='data:image/webp']){max-width:100%;height:auto;object-fit:cover}"
    )
    html_document = html_document.replace("</head>", f"<style>{wallpaper_overrides}</style></head>", 1)
    html_document = html_document.replace(
        "</head>",
        '<style>html,body,.wa,.wa *{font-family:"Segoe UI",Roboto,Arial,sans-serif}.wa-text strong{font-weight:700}.wa-text em{font-style:italic}.wa-text del{text-decoration:line-through}.wa-text code{font-family:Consolas,"Courier New",monospace;background:rgba(127,127,127,.16);padding:0 3px;border-radius:3px}.screenw-emoji{display:inline-block;width:1.18em;height:1.18em;vertical-align:-.21em;object-fit:contain;margin:0 .025em}.screenw-mention{color:#008f72;font-weight:500}.wa-mediabubble:has(img.wa-img[src^="data:image/webp"]){width:max-content!important;max-width:42%;padding:3px!important;background:transparent!important;box-shadow:none!important}.wa-mediabubble img.wa-img[src^="data:image/webp"]{width:112px!important;height:112px;max-width:112px!important;object-fit:contain;border-radius:0}.wa-stickerbubble{display:flex;flex-direction:column;align-items:flex-start!important}.screenw-sticker-time{position:static;align-self:stretch;box-sizing:border-box;display:flex;justify-content:flex-end;align-items:center;gap:2px;margin:2px 3px 0 0;padding:2px 0;border-radius:6px;font-size:10px;line-height:1.2;white-space:nowrap}.wa-stickerbubble.wa-other .screenw-sticker-time{background:#fff;color:#667781}.wa-stickerbubble.wa-self .screenw-sticker-time{background:#d9fdd3;color:#667781}[data-theme="dark"] .wa-stickerbubble.wa-other .screenw-sticker-time{background:#202c33;color:#8696a0}[data-theme="dark"] .wa-stickerbubble.wa-self .screenw-sticker-time{background:#005c4b;color:#8696a0}[data-theme="dark"] .screenw-mention{color:#00a884}[data-theme="dark"] .wa-input{background:#0b141a}[data-theme="dark"] .wa-input .wa-send{background:#202c33;color:#8696a0}[data-theme="dark"] .wa-input .wa-send .cg-ic{color:#8696a0}.screenw-sticker-time .wa-read{color:#53bdeb}</style></head>',
        1,
    )
    html_document = html_document.replace(
        "</head>",
        '<style>.wa-mediabubble.wa-stickerbubble:has(img.wa-img[src^="data:image/webp"]){width:112px!important;max-width:42%;padding:0!important;box-sizing:content-box}.wa-stickerbubble{display:grid!important;grid-template-columns:112px;grid-template-rows:112px auto;align-items:initial!important;justify-items:start;width:112px!important;max-width:42%;box-sizing:content-box;padding:0!important}.wa-stickerbubble>img.wa-img[src^="data:image/webp"]{grid-column:1;grid-row:1;justify-self:start;align-self:start}.wa-stickerbubble>.screenw-sticker-time{grid-column:1;grid-row:2;justify-self:end;align-self:start;position:static;width:max-content;box-sizing:border-box;display:inline-flex;align-items:center;margin:2px 0 0;padding:2px 5px}</style></head>',
        1,
    )

    device = get_device(DeviceView.ANDROID)
    if mode == "video":
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "screenw.mp4"
            html_to_video(
                html_document,
                width=device.width,
                height=device.height,
                path=str(output),
                fmt="mp4",
                scale=2,
                fps=18,
                animate_start=animate_start,
                animate_delay=animate_delay,
                hold_ms=800,
            )
            sys.stdout.buffer.write(output.read_bytes())
        return

    png = html_to_png(
        html_document,
        width=device.width,
        height=device.height,
        scale=2,
    )
    sys.stdout.buffer.write(png)


if __name__ == "__main__":
    main()

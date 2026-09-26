#!/usr/bin/env python3
"""Regenerate every logo and app icon from the master SVGs in docs/brand.

The masters were exported from `Axiom Design.af` (Affinity, text as curves).
Re-export them there, drop them into docs/brand, then run:

    python3 scripts/brand-assets.py

Needs Pillow and Google Chrome (used headless to rasterise the SVGs).
"""
import json
import pathlib
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAND = ROOT / 'docs/brand'
WEB = ROOT / 'apps/web'
MOBILE = ROOT / 'apps/mobile'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

WHITE = (255, 255, 255, 255)


def render(svg: pathlib.Path, width: int) -> Image.Image:
    """Rasterise an SVG at `width` px with a transparent background."""
    view = [float(v) for v in svg.read_text().split('viewBox="')[1].split('"')[0].split()]
    height = round(width * view[3] / view[2])
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        shutil.copy(svg, tmp / 'in.svg')
        (tmp / 'r.html').write_text(
            f'<html><body style="margin:0;background:transparent">'
            f'<img src="in.svg" style="display:block;width:{width}px;height:{height}px"></body></html>')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--allow-file-access-from-files', '--force-device-scale-factor=1',
                        '--default-background-color=00000000', f'--window-size={width},{height}',
                        f'--screenshot={tmp / "out.png"}', (tmp / 'r.html').as_uri()],
                       check=True, capture_output=True)
        return Image.open(tmp / 'out.png').convert('RGBA').copy()


MARK = render(BRAND / 'axiom-mark.svg', 2048)


def icon(size: int, *, scale: float, background=WHITE, alpha=True) -> Image.Image:
    """The A mark centred on a square; `scale` is the mark's width as a share of the side."""
    canvas = Image.new('RGBA', (size, size), background)
    width = round(size * scale)
    mark = MARK.resize((width, round(width * MARK.height / MARK.width)), Image.LANCZOS)
    # Optical centre: the mark is bottom-heavy, so nudge it up slightly.
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2 - round(size * 0.01)))
    return canvas if alpha else canvas.convert('RGB')


def save(img: Image.Image, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print('wrote', path.relative_to(ROOT))


def logo_png(name: str, width: int, path: pathlib.Path) -> None:
    save(render(BRAND / name, width), path)


# ---------------------------------------------------------------- web ----
public = WEB / 'public/brand'
public.mkdir(parents=True, exist_ok=True)
for svg in BRAND.glob('*.svg'):
    shutil.copy(svg, public / svg.name)
    print('wrote', (public / svg.name).relative_to(ROOT))

# Next.js app-router file conventions pick these up automatically.
shutil.copy(BRAND / 'axiom-mark.svg', WEB / 'app/icon.svg')
save(icon(180, scale=0.72, alpha=False), WEB / 'app/apple-icon.png')
icon(48, scale=0.9, background=(0, 0, 0, 0)).save(WEB / 'app/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('wrote apps/web/app/favicon.ico')
save(icon(192, scale=0.72), public / 'icon-192.png')
save(icon(512, scale=0.72), public / 'icon-512.png')
save(icon(512, scale=0.56), public / 'icon-maskable-512.png')

# ------------------------------------------------------------- mobile ----
# In-app images (Flutter resolution-aware variants).
for ratio, folder in ((1, ''), (2, '2.0x/'), (3, '3.0x/')):
    logo_png('axiom-logo-stacked.svg', 220 * ratio, MOBILE / f'assets/brand/{folder}axiom_logo_stacked.png')
    save(MARK.resize((32 * ratio, round(32 * ratio * MARK.height / MARK.width)), Image.LANCZOS),
         MOBILE / f'assets/brand/{folder}axiom_mark.png')
save(icon(1024, scale=0.72), MOBILE / 'assets/icons/app_icon.png')

# iOS: opaque, full-bleed (the OS applies the rounded mask).
ios = MOBILE / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
for entry in json.loads((ios / 'Contents.json').read_text())['images']:
    px = round(float(entry['size'].split('x')[0]) * float(entry['scale'].rstrip('x')))
    save(icon(px, scale=0.72, alpha=False), ios / entry['filename'])

# iOS launch screen: the mark on white (storyboard centres it at 1x size).
launch = MOBILE / 'ios/Runner/Assets.xcassets/LaunchImage.imageset'
for ratio, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
    save(MARK.resize((120 * ratio, round(120 * ratio * MARK.height / MARK.width)), Image.LANCZOS),
         launch / f'LaunchImage{suffix}.png')

# Android legacy launcher icons.
res = MOBILE / 'android/app/src/main/res'
densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, d in densities.items():
    square = icon(round(48 * d), scale=0.72)
    save(square, res / f'mipmap-{name}/ic_launcher.png')
    # The circle crops the corners, so the mark sits smaller here.
    disc = icon(round(48 * d), scale=0.6)
    mask = Image.new('L', disc.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, disc.width - 1, disc.height - 1), fill=255)
    round_icon = Image.new('RGBA', disc.size, (0, 0, 0, 0))
    round_icon.paste(disc, mask=mask)
    save(round_icon, res / f'mipmap-{name}/ic_launcher_round.png')
    # Adaptive-icon foreground: 108dp canvas, keep the mark inside the 66dp safe zone.
    save(icon(round(108 * d), scale=0.5, background=(0, 0, 0, 0)), res / f'mipmap-{name}/ic_launcher_foreground.png')
    # Splash bitmap.
    save(MARK.resize((round(120 * d), round(120 * d * MARK.height / MARK.width)), Image.LANCZOS),
         res / f'mipmap-{name}/launch_image.png')

# Web build of the Flutter app.
save(icon(192, scale=0.72), MOBILE / 'web/icons/Icon-192.png')
save(icon(512, scale=0.72), MOBILE / 'web/icons/Icon-512.png')
save(icon(192, scale=0.56), MOBILE / 'web/icons/Icon-maskable-192.png')
save(icon(512, scale=0.56), MOBILE / 'web/icons/Icon-maskable-512.png')
save(icon(32, scale=0.9, background=(0, 0, 0, 0)), MOBILE / 'web/favicon.png')

# Desktop targets.
mac = MOBILE / 'macos/Runner/Assets.xcassets/AppIcon.appiconset'
for px in (16, 32, 64, 128, 256, 512, 1024):
    # macOS icons are not masked by the OS: draw the rounded tile ourselves.
    tile = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    inset, radius = round(px * 0.1), round(px * 0.18)
    body = icon(px - 2 * inset, scale=0.72)
    m = Image.new('L', body.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, body.width - 1, body.height - 1), radius, fill=255)
    tile.paste(body, (inset, inset), m)
    save(tile, mac / f'app_icon_{px}.png')
icon(256, scale=0.72).save(MOBILE / 'windows/runner/resources/app_icon.ico',
                           sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('wrote apps/mobile/windows/runner/resources/app_icon.ico')

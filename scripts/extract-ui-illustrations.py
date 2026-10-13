#!/usr/bin/env python3
"""Cuts the UI illustrations out of the generated atlas (assets/ui/source/ui-assets-atlas.png).

Reads assets/ui/source/assets-manifest.json: each asset's cellRect in the 4x4 atlas. For every cell it
- clears near-transparent alpha noise (below the manifest's visibleContentAlphaThreshold), so gutters stay empty,
- finds the visible content and checks it doesn't touch the cell edge (that would mean a cut or a neighbour's art),
- copies it, unscaled, centred on a common transparent square canvas (same size for every asset, multiple of 4).
Writes assets/ui/illustrations/<filename> and a contact sheet to check by eye.

Usage: python3 scripts/extract-ui-illustrations.py [contact-sheet.png]
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "ui" / "source"
OUT = ROOT / "assets" / "ui" / "illustrations"
PADDING = 8


def main() -> None:
    manifest = json.loads((SOURCE / "assets-manifest.json").read_text())
    atlas = Image.open(SOURCE / manifest["atlas"]).convert("RGBA")
    expected = tuple(manifest["validation"]["size"])
    if atlas.size != expected:
        sys.exit(f"El atlas mide {atlas.size}, el manifest dice {expected}")
    threshold = manifest["validation"]["visibleContentAlphaThreshold"]

    cuts = []
    for asset in manifest["assets"]:
        r = asset["cellRect"]
        cell = atlas.crop((r["x"], r["y"], r["x"] + r["width"], r["y"] + r["height"]))
        alpha = cell.getchannel("A").point(lambda a: 0 if a < threshold else a)
        cell.putalpha(alpha)
        box = alpha.getbbox()
        if box is None:
            sys.exit(f"{asset['id']}: la celda está vacía")
        x0, y0, x1, y1 = box
        if x0 == 0 or y0 == 0 or x1 == r["width"] or y1 == r["height"]:
            sys.exit(f"{asset['id']}: el contenido toca el borde de la celda {box}; revisar el recorte")
        cuts.append((asset, cell.crop(box)))

    side = max(max(c.width, c.height) for _, c in cuts) + 2 * PADDING
    side += (-side) % 4
    OUT.mkdir(parents=True, exist_ok=True)
    for asset, art in cuts:
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
        canvas.save(OUT / asset["filename"], optimize=True)
        print(f"{asset['filename']}: contenido {art.width}x{art.height} en {side}x{side}")

    if len(sys.argv) > 1:
        sheet = Image.new("RGBA", (side * 4, side * 4), (16, 16, 20, 255))
        for i, (asset, _) in enumerate(cuts):
            img = Image.open(OUT / asset["filename"])
            sheet.alpha_composite(img, ((i % 4) * side, (i // 4) * side))
        sheet.save(sys.argv[1])


if __name__ == "__main__":
    main()

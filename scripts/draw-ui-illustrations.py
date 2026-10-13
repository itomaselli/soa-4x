#!/usr/bin/env python3
"""Draws the UI illustrations the atlas doesn't have: "Robar motos" (task) and the sale node.

Hand-made with code for this project, in the atlas's style: thick dark outline, 3-4 tone shading, warm light from
the upper left, a soft ground shadow. Drawn on an 84x84 grid and scaled x3 (nearest neighbour) to the same
252x252 transparent canvas as the other illustrations, so the grain matches (about 3 px).

Writes assets/ui/illustrations/task_steal_bikes.png and sale_money.png.
Usage: python3 scripts/draw-ui-illustrations.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ui" / "illustrations"
BASE = 84
SCALE = 3

OUTLINE = (24, 18, 14, 255)
SHADOW = (0, 0, 0, 90)

STEEL = [(58, 62, 70, 255), (104, 110, 120, 255), (160, 166, 176, 255), (214, 220, 228, 255)]
RUBBER = [(22, 22, 26, 255), (40, 40, 46, 255), (62, 62, 70, 255)]
RED = [(110, 20, 18, 255), (170, 38, 30, 255), (222, 72, 52, 255)]
BRASS = [(122, 86, 24, 255), (190, 142, 42, 255), (236, 196, 88, 255), (255, 232, 150, 255)]
GREEN = [(32, 66, 34, 255), (58, 108, 52, 255), (92, 150, 76, 255), (146, 194, 120, 255)]
PAPER = [(196, 182, 136, 255), (232, 220, 176, 255)]
BURLAP = [(92, 62, 34, 255), (142, 102, 58, 255), (186, 144, 92, 255), (220, 184, 130, 255)]


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def shadow(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    d.ellipse(box, fill=SHADOW)


def thick_line(d: ImageDraw.ImageDraw, a: tuple[float, float], b: tuple[float, float], width: int, tones: list, outline=OUTLINE) -> None:
    """A bar with outline, base colour and a highlight along its upper edge."""
    d.line([a, b], fill=outline, width=width + 2)
    d.line([a, b], fill=tones[1], width=width)
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length, dx / length
    if ny > 0:
        nx, ny = -nx, -ny
    off = (width - 1) / 2
    d.line([(a[0] + nx * off, a[1] + ny * off), (b[0] + nx * off, b[1] + ny * off)], fill=tones[2], width=1)


def save(img: Image.Image, name: str) -> None:
    big = img.resize((BASE * SCALE, BASE * SCALE), Image.NEAREST)
    OUT.mkdir(parents=True, exist_ok=True)
    big.save(OUT / name, optimize=True)
    print(f"{name}: {big.size[0]}x{big.size[1]}")


def link(d: ImageDraw.ImageDraw, x: int, y: int, horizontal: bool) -> None:
    """One chain link: outlined steel ring with a highlight."""
    w, h = (4, 3) if horizontal else (3, 4)
    d.ellipse((x - w - 1, y - h - 1, x + w + 1, y + h + 1), fill=OUTLINE)
    d.ellipse((x - w, y - h, x + w, y + h), fill=STEEL[2])
    d.ellipse((x - w + 2, y - h + 2, x + w - 2, y + h - 2), fill=OUTLINE)
    d.point((x - w + 1, y - h + 1), fill=STEEL[3])


def steal_bikes() -> None:
    """A motorcycle wheel locked with a chain; the chain is cut, the padlock hangs open and the bolt cutters lie in front."""
    img, d = canvas()
    shadow(d, (6, 66, 80, 79))

    # Wheel with fender and a bit of the swingarm, seen from the side.
    cx, cy, r = 50, 36, 23
    d.ellipse((cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1), fill=OUTLINE)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=RUBBER[1])
    d.arc((cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1), 195, 285, fill=RUBBER[2], width=2)
    rr = r - 6
    d.ellipse((cx - rr - 1, cy - rr - 1, cx + rr + 1, cy + rr + 1), fill=OUTLINE)
    d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=STEEL[1])
    d.ellipse((cx - rr + 2, cy - rr + 2, cx + rr - 2, cy + rr - 2), fill=RUBBER[0])
    for i in range(10):
        ang = i * math.pi / 5 + 0.2
        d.line([(cx, cy), (cx + math.cos(ang) * (rr - 2), cy + math.sin(ang) * (rr - 2))], fill=STEEL[1], width=1)
    d.arc((cx - rr, cy - rr, cx + rr, cy + rr), 200, 280, fill=STEEL[3], width=1)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=OUTLINE)
    d.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=STEEL[1])
    d.ellipse((cx - 3, cy - 3, cx + 1, cy + 1), fill=STEEL[2])
    d.arc((cx - r - 4, cy - r - 4, cx + r + 4, cy + r + 4), 195, 330, fill=OUTLINE, width=6)
    d.arc((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), 197, 328, fill=RED[1], width=4)
    d.arc((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), 210, 280, fill=RED[2], width=1)
    d.polygon([(cx + 2, cy - 3), (82, cy - 12), (82, cy - 4), (cx + 3, cy + 3)], fill=OUTLINE)
    d.polygon([(cx + 4, cy - 2), (82, cy - 11), (82, cy - 6), (cx + 4, cy + 1)], fill=STEEL[1])
    d.line([(cx + 4, cy - 2), (82, cy - 11)], fill=STEEL[2])

    # Chain: through the spokes, down the front of the tyre, cut halfway; the loose end lies on the ground.
    for x, y, hz in [(cx - 6, cy + 6, False), (cx - 10, cy + 13, True), (cx - 14, cy + 19, False), (cx - 17, cy + 26, True)]:
        link(d, x, y, hz)
    for x, y, hz in [(30, 69, True), (38, 71, True), (46, 70, True), (53, 68, False)]:
        link(d, x, y, hz)
    # The cut: two half links with bright fresh steel.
    d.arc((26, 63, 34, 69), 200, 340, fill=OUTLINE, width=3)
    d.arc((27, 64, 33, 68), 210, 330, fill=STEEL[3], width=1)

    # Padlock hanging open from the last link, brass with a sprung shackle.
    px, py = 64, 62
    d.arc((px - 6, py - 14, px + 6, py - 2), 180, 360, fill=OUTLINE, width=4)
    d.arc((px - 5, py - 13, px + 5, py - 3), 185, 340, fill=STEEL[2], width=2)
    d.rectangle((px - 9, py - 4, px + 9, py + 10), fill=OUTLINE)
    d.rectangle((px - 8, py - 3, px + 8, py + 9), fill=BRASS[1])
    d.rectangle((px - 8, py - 3, px + 8, py - 2), fill=BRASS[3])
    d.rectangle((px - 8, py - 1, px - 6, py + 9), fill=BRASS[2])
    d.rectangle((px + 6, py, px + 8, py + 9), fill=BRASS[0])
    d.ellipse((px - 2, py + 1, px + 2, py + 4), fill=OUTLINE)
    d.rectangle((px - 1, py + 3, px + 1, py + 6), fill=OUTLINE)

    # Bolt cutters across the front: long red handles with black grips, heavy steel jaws.
    thick_line(d, (4, 72), (27, 52), 5, RED)
    thick_line(d, (14, 80), (31, 57), 5, RED)
    for a, b in [((4, 72), (11, 66)), ((14, 80), (19, 73))]:
        thick_line(d, a, b, 5, RUBBER)
    d.ellipse((24, 48, 36, 60), fill=OUTLINE)
    d.ellipse((25, 49, 35, 59), fill=STEEL[1])
    d.ellipse((27, 51, 31, 55), fill=STEEL[2])
    d.polygon([(30, 47), (41, 38), (45, 41), (35, 52)], fill=OUTLINE)
    d.polygon([(31, 47), (41, 39), (43, 41), (34, 50)], fill=STEEL[2])
    d.line([(31, 47), (41, 39)], fill=STEEL[3])
    d.polygon([(35, 55), (46, 47), (48, 51), (38, 58)], fill=OUTLINE)
    d.polygon([(36, 55), (46, 48), (47, 50), (38, 56)], fill=STEEL[1])

    save(img, "task_steal_bikes.png")


def bill_stack(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, layers: int) -> None:
    """A banded stack of green bills seen slightly from above."""
    d.rectangle((x - 1, y - 1, x + w + 1, y + h + layers + 1), fill=OUTLINE)
    for i in range(layers):
        d.rectangle((x, y + h + i, x + w, y + h + i), fill=GREEN[1] if i % 2 else GREEN[0])
    d.rectangle((x, y, x + w, y + h), fill=GREEN[2])
    d.rectangle((x, y, x + w, y), fill=GREEN[3])
    d.rectangle((x + 2, y + 2, x + w - 2, y + h - 2), outline=GREEN[1])
    band = x + w // 2 - 3
    d.rectangle((band, y, band + 6, y + h + layers), fill=PAPER[1])
    d.rectangle((band + 5, y, band + 6, y + h + layers), fill=PAPER[0])
    d.ellipse((x + 3, y + h // 2 - 2, x + 7, y + h // 2 + 2), fill=GREEN[1])


def coin(d: ImageDraw.ImageDraw, x: int, y: int) -> None:
    d.ellipse((x - 5, y - 3, x + 5, y + 4), fill=OUTLINE)
    d.ellipse((x - 4, y - 2, x + 4, y + 3), fill=BRASS[0])
    d.ellipse((x - 4, y - 3, x + 4, y + 2), fill=BRASS[1])
    d.ellipse((x - 2, y - 2, x + 2, y + 1), fill=BRASS[2])
    d.point((x - 2, y - 2), fill=BRASS[3])


def sale_money() -> None:
    """A money bag with a dollar sign, banded stacks of bills and a few coins."""
    img, d = canvas()
    shadow(d, (6, 64, 80, 78))

    # Bag behind: burlap sack tied at the neck.
    d.polygon([(30, 30), (54, 30), (64, 46), (64, 62), (58, 70), (26, 70), (20, 62), (20, 46)], fill=OUTLINE)
    d.polygon([(31, 32), (53, 32), (62, 47), (62, 61), (57, 68), (27, 68), (22, 61), (22, 47)], fill=BURLAP[1])
    d.polygon([(31, 32), (40, 32), (30, 48), (26, 64), (23, 60), (23, 47)], fill=BURLAP[2])
    d.line([(28, 40), (25, 56)], fill=BURLAP[3], width=1)
    d.polygon([(53, 32), (62, 47), (62, 61), (57, 68), (52, 68), (58, 58), (58, 46)], fill=BURLAP[0])
    # Neck and tie.
    d.polygon([(32, 20), (52, 20), (48, 30), (36, 30)], fill=OUTLINE)
    d.polygon([(34, 21), (50, 21), (47, 29), (37, 29)], fill=BURLAP[2])
    d.rectangle((33, 27, 51, 31), fill=OUTLINE)
    d.rectangle((34, 28, 50, 30), fill=RED[1])
    d.line([(34, 28), (50, 28)], fill=RED[2])
    d.line([(36, 18), (39, 21)], fill=OUTLINE, width=2)
    d.line([(48, 18), (45, 21)], fill=OUTLINE, width=2)
    # Dollar sign stamped on the bag.
    sx, sy = 42, 50
    d.line([(sx, sy - 10), (sx, sy + 10)], fill=OUTLINE, width=4)
    d.arc((sx - 7, sy - 8, sx + 7, sy + 1), 60, 290, fill=OUTLINE, width=4)
    d.arc((sx - 7, sy - 1, sx + 7, sy + 8), 240, 110, fill=OUTLINE, width=4)
    d.line([(sx, sy - 10), (sx, sy + 10)], fill=BRASS[2], width=2)
    d.arc((sx - 6, sy - 7, sx + 6, sy), 60, 290, fill=BRASS[2], width=2)
    d.arc((sx - 6, sy, sx + 6, sy + 7), 240, 110, fill=BRASS[2], width=2)

    # Bills in front: two stacks, one leaning on the other.
    bill_stack(d, 6, 58, 28, 10, 5)
    bill_stack(d, 46, 61, 28, 9, 4)
    bill_stack(d, 12, 52, 24, 8, 3)

    # Coins scattered in front.
    for x, y in [(38, 74), (46, 77), (33, 79), (70, 75)]:
        coin(d, x, y)

    save(img, "sale_money.png")


if __name__ == "__main__":
    steal_bikes()
    sale_money()

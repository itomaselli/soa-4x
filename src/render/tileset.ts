// Tileset sprites (data/tileset.json) as RGBA pixels. Each character of a sprite indexes the palette, "." is
// transparent and the palette's alpha is kept (the "z" shadow is translucent). Faction-mask pixels ("T") are left
// out of the sprite and go to a second, white texture that the renderer tints with the owner's color.
// Pure function, like patch.ts: tested in Node.

import { TILESET_EMPTY, TILESET_MASK, type TilesetData, type TilesetSprite } from "../data/schemas";

export interface SpritePixels {
  size: number;
  /** size × size × 4 bytes, row by row (RGBA). */
  rgba: Uint8ClampedArray;
  /** White where the sprite has mask pixels, transparent elsewhere; null if it has none. */
  mask: Uint8ClampedArray | null;
}

/** "#rrggbb" or "#rrggbbaa" → [r, g, b, a]. */
export function parseColor(hex: string): [number, number, number, number] {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), hex.length === 9 ? n(7) : 255];
}

export function spritePixels(sprite: Pick<TilesetSprite, "pixels">, palette: TilesetData["palette"]): SpritePixels {
  const size = sprite.pixels.length;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const mask = new Uint8ClampedArray(size * size * 4);
  let hasMask = false;
  const colors = new Map(Object.entries(palette).map(([key, hex]) => [key, parseColor(hex)]));
  sprite.pixels.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = (y * size + x) * 4;
      if (ch === TILESET_MASK) {
        mask.set([255, 255, 255, 255], i);
        hasMask = true;
      } else if (ch !== TILESET_EMPTY) {
        const color = colors.get(ch);
        if (color) rgba.set(color, i);
      }
    });
  });
  return { size, rgba, mask: hasMask ? mask : null };
}

/** Texture id of a sprite's faction mask. */
export const maskTextureId = (id: string) => `${id}#mask`;

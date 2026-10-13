// The project's own 1-bit tiles (data/tiles-extra.json) as pixel grids: "#" → white, "." → transparent.
// White so the renderer can tint them with sprite.tint, like the Kenney sheet. Pure function, like patch.ts.

import type { ExtraTile } from "../data/schemas";

export const EXTRA_TILE_INK = "#ffffff";

export function extraTilePixels(tile: Pick<ExtraTile, "pixels">): (string | null)[][] {
  return tile.pixels.map((row) => [...row].map((ch) => (ch === "#" ? EXTRA_TILE_INK : null)));
}

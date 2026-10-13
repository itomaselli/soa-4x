// Patch pixels (phase 11): shape + rim + centered 10×10 emblem, as a size×size grid of colors (null = transparent).
// Pure function, shared by the map (PixiJS texture) and the interface (canvas).

import type { GameData } from "../data/schemas";

type Shape = GameData["patches"]["shapes"][number];

function inside(shape: Shape, x: number, y: number, size: number): boolean {
  const c = (size - 1) / 2;
  const dx = Math.abs(x - c);
  const dy = Math.abs(y - c);
  const r = size / 2;
  switch (shape) {
    case "circle":
      return dx * dx + dy * dy <= r * r;
    case "diamond":
      return dx + dy <= r + 0.5;
    case "square":
      return dx <= r - 0.5 && dy <= r - 0.5;
    case "octagon":
      return dx <= r - 0.5 && dy <= r - 0.5 && dx + dy <= r * 1.35;
    case "shield":
      // Flat top, straight sides, pointed bottom.
      return dx <= r - 0.5 && (y <= c || dx <= (r - 0.5) * (1 - (y - c) / (r + 0.5)));
  }
}

export function patchPixels(data: GameData, patchId: string): (string | null)[][] | null {
  const def = data.patches.patches.find((p) => p.id === patchId);
  if (!def) return null;
  const { size, emblemSize } = data.patches;
  const palette = data.patches.palettes[def.palette];
  const emblem = data.patches.emblems[def.emblem];
  if (!palette || !emblem) return null;
  const offset = Math.floor((size - emblemSize) / 2);
  const grid: (string | null)[][] = [];
  for (let y = 0; y < size; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < size; x++) {
      if (!inside(def.shape, x, y, size)) {
        row.push(null);
        continue;
      }
      const edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([ox, oy]) => !inside(def.shape, x + ox!, y + oy!, size) || x + ox! < 0 || y + oy! < 0 || x + ox! >= size || y + oy! >= size);
      const ex = x - offset;
      const ey = y - offset;
      const inEmblem = ex >= 0 && ey >= 0 && ex < emblemSize && ey < emblemSize && emblem[ey]?.[ex] === "#";
      row.push(edge ? palette.rim : inEmblem ? palette.emblem : palette.background);
    }
    grid.push(row);
  }
  return grid;
}

/** "{emblem} {palette}" in Spanish, e.g. "Calavera de sangre". */
export function patchNameParts(data: GameData, patchId: string): { emblemKey: string; paletteKey: string } | null {
  const def = data.patches.patches.find((p) => p.id === patchId);
  return def ? { emblemKey: `patch_emblem.${def.emblem}`, paletteKey: `patch_palette.${def.palette}` } : null;
}

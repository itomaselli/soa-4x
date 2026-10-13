// Political map regions (phase 10): every map tile belongs to the nearest district center, like a
// Voronoi diagram on the tile grid. Tiles too far from any center are outside the county.
// Borders between two districts are "open" when the rules connect them (adjacent zones) and
// "closed" otherwise (they look like a river or ridge); the county's outline is an "edge".
// Pure functions: no PixiJS here, so this is tested in Node.

import type { GameData } from "../data/schemas";

export type BorderKind = "open" | "closed" | "edge";

export interface BorderSegment {
  /** Tile whose right or bottom side is the border. */
  x: number;
  y: number;
  side: "right" | "bottom";
  kind: BorderKind;
  /** Zones on each side (null = outside the county). */
  a: string | null;
  b: string | null;
}

export interface RegionMap {
  width: number;
  height: number;
  /** zone id per tile, row by row ([y][x]); null outside the county. */
  tiles: (string | null)[][];
  borders: BorderSegment[];
}

export function computeRegions(data: GameData): RegionMap {
  const { width, height } = data.ui.map;
  const maxDistance = data.ui.regions.maxDistance;
  const tiles: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      let best: string | null = null;
      let bestDistance = Infinity;
      for (const zone of data.zones) {
        const d = Math.hypot(zone.position.x - x, zone.position.y - y);
        if (d < bestDistance) {
          best = zone.id;
          bestDistance = d;
        }
      }
      row.push(bestDistance <= maxDistance ? best : null);
    }
    tiles.push(row);
  }

  const adjacent = new Set(data.zones.flatMap((z) => z.adjacent.map((a) => [z.id, a].sort().join("|"))));
  const kindOf = (a: string | null, b: string | null): BorderKind =>
    a === null || b === null ? "edge" : adjacent.has([a, b].sort().join("|")) ? "open" : "closed";
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? null : (tiles[y]?.[x] ?? null));

  const borders: BorderSegment[] = [];
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const here = at(x, y);
      const right = at(x + 1, y);
      const below = at(x, y + 1);
      if (y >= 0 && here !== right) borders.push({ x, y, side: "right", kind: kindOf(here, right), a: here, b: right });
      if (x >= 0 && here !== below) borders.push({ x, y, side: "bottom", kind: kindOf(here, below), a: here, b: below });
    }
  }
  return { width, height, tiles, borders };
}

export function zoneAtTile(map: RegionMap, x: number, y: number): string | null {
  return map.tiles[y]?.[x] ?? null;
}

/** Pairs of zones whose regions touch on the map. */
export function touchingPairs(map: RegionMap): Set<string> {
  return new Set(map.borders.filter((b) => b.a !== null && b.b !== null).map((b) => [b.a, b.b].sort().join("|")));
}

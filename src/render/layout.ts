// Pure map layout: which character goes on which tile. No PixiJS here, so it can be tested in Node.
// Each zone is a 3×3 box centered on its position, with its short name on the row below.
// Roads are straight tile lines between adjacent zones, drawn with -, |, / and \.

import type { GameData, ZoneDef } from "../data/schemas";

export interface Tile {
  x: number;
  y: number;
}

export interface RoadTile extends Tile {
  glyph: string;
}

export interface ZoneLayout {
  id: string;
  center: Tile;
  /** First tile of the label row (y = center.y + 2). */
  labelStart: Tile;
  label: string;
}

export interface MapLayout {
  width: number;
  height: number;
  zones: ZoneLayout[];
  roads: RoadTile[];
}

const key = (x: number, y: number) => `${x},${y}`;

export function zoneLayout(zone: ZoneDef): ZoneLayout {
  const { x, y } = zone.position;
  return {
    id: zone.id,
    center: { x, y },
    labelStart: { x: x - Math.floor(zone.shortName.length / 2), y: y + 2 },
    label: zone.shortName,
  };
}

/** Tiles covered by a zone: its 3×3 box plus its label. */
export function zoneTiles(z: ZoneLayout): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push({ x: z.center.x + dx, y: z.center.y + dy });
  for (let i = 0; i < z.label.length; i++) tiles.push({ x: z.labelStart.x + i, y: z.labelStart.y });
  return tiles;
}

/** Bresenham line between two tiles, endpoints included. */
export function lineTiles(a: Tile, b: Tile): Tile[] {
  const tiles: Tile[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    tiles.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return tiles;
}

/** Road character for a step between two consecutive tiles. */
function roadGlyph(from: Tile, to: Tile): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dy === 0) return "-";
  if (dx === 0) return "|";
  return dx * dy > 0 ? "\\" : "/";
}

export function buildMapLayout(data: GameData): MapLayout {
  const zones = data.zones.map(zoneLayout);
  const blocked = new Set(zones.flatMap((z) => zoneTiles(z).map((t) => key(t.x, t.y))));
  const byId = new Map(zones.map((z) => [z.id, z]));
  const roads = new Map<string, RoadTile>();

  for (const zone of data.zones) {
    for (const adjId of zone.adjacent) {
      if (adjId < zone.id) continue; // each edge once
      const a = byId.get(zone.id);
      const b = byId.get(adjId);
      if (!a || !b) continue;
      const line = lineTiles(a.center, b.center);
      for (let i = 1; i < line.length - 1; i++) {
        const tile = line[i]!;
        if (blocked.has(key(tile.x, tile.y))) continue;
        roads.set(key(tile.x, tile.y), { ...tile, glyph: roadGlyph(line[i - 1]!, line[i + 1]!) });
      }
    }
  }

  return { width: data.ui.map.width, height: data.ui.map.height, zones, roads: [...roads.values()] };
}

/** Zone id at a tile (its box or label), or null. Used for clicks. */
export function zoneAt(layout: MapLayout, tile: Tile): string | null {
  for (const z of layout.zones) {
    if (zoneTiles(z).some((t) => t.x === tile.x && t.y === tile.y)) return z.id;
  }
  return null;
}

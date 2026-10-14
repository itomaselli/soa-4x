// The political map drawn with the tileset (tile mode). Everything comes from data the game already has (each
// district's type, glyph, position and neighbours, and the regions of computeRegions), so random counties work too:
//   - Ground per cell from the type of the district that owns it: grass, dirt, pavement, marsh, crop fields in
//     patches; outside the county, sea next to ports and darkened ground elsewhere.
//   - An asphalt road between the centers of every pair of neighbours, shaped like an L (the one that stays inside
//     the two districts), autotiled like the district roads.
//   - Rails across industrial districts, and houses, factories, trees and rocks drawn with a deterministic hash of
//     district and cell; buildings thin out with the distance to the center.
//   - Nothing is drawn over centers (icon and markers) or name plates.
// Computed once per game. Pure: tested in Node.

import type { GameData, ZoneDef } from "../data/schemas";
import { localTextureId } from "../data/validate";
import { hashId } from "./hash";
import { zoneTiles, type MapLayout, type Tile } from "./layout";
import { autotile } from "./localMap";
import type { BorderSegment, RegionMap } from "./regions";

export interface CountyCell {
  /** District that owns the cell, or null outside the county. */
  zoneId: string | null;
  /** Ground texture id (always opaque). */
  ground: string;
  /** Outside the county, next to a port. */
  sea: boolean;
  /** Road or rail piece over the ground (texture id and quarter turns). */
  track: { sprite: string; rotation: number; kind: "road" | "rail" } | null;
  /** Tree, rock or building over the ground (texture id). */
  deco: string | null;
}

export interface CountyRoad {
  a: string;
  b: string;
  tiles: Tile[];
}

export interface CountyMap {
  width: number;
  height: number;
  cells: CountyCell[][];
  roads: CountyRoad[];
  /** Cells kept clear: each district's 3×3 center (icon and markers), its heat marker and its name plate. */
  reserved: Set<string>;
}

const key = (x: number, y: number) => `${x},${y}`;
const UINT32 = 2 ** 32;

/** Deterministic draw in [0, 1) for a district, a cell and a purpose. */
function roll(zone: Pick<ZoneDef, "id" | "localSeed"> | null, x: number, y: number, salt: string): number {
  return hashId(`${zone?.localSeed ?? ""}${zone?.id ?? "outside"}:${x},${y}:${salt}`) / UINT32;
}

function pick<T>(options: readonly T[], zone: Pick<ZoneDef, "id" | "localSeed"> | null, x: number, y: number, salt: string): T {
  return options[Math.floor(roll(zone, x, y, salt) * options.length)]!;
}

/** Cells nothing may cover: 3×3 centers, heat markers (center + (2, −1)) and the name rows. */
export function reservedCells(layout: MapLayout): Set<string> {
  const reserved = new Set<string>();
  for (const z of layout.zones) {
    for (const t of zoneTiles(z)) reserved.add(key(t.x, t.y));
    reserved.add(key(z.center.x + 2, z.center.y - 1));
  }
  return reserved;
}

/** A straight horizontal or vertical run of cells, both ends included. */
function straight(p: Tile, q: Tile): Tile[] {
  const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
  const sx = Math.sign(q.x - p.x);
  const sy = Math.sign(q.y - p.y);
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: p.x + sx * i, y: p.y + sy * i }));
}

/** The two L-shaped paths between two cells: horizontal first, then vertical first. Both include the ends. */
export function lPaths(a: Tile, b: Tile): [Tile[], Tile[]] {
  const cornerH = { x: b.x, y: a.y };
  const cornerV = { x: a.x, y: b.y };
  return [
    [...straight(a, cornerH), ...straight(cornerH, b).slice(1)],
    [...straight(a, cornerV), ...straight(cornerV, b).slice(1)],
  ];
}

/**
 * The road between two neighbouring districts: of the two L shapes, the one with more cells inside the two
 * districts, never through another district's center if the other one avoids it. Ties go to horizontal first.
 */
export function roadPath(regions: RegionMap, layout: MapLayout, aId: string, bId: string): Tile[] {
  const a = layout.zones.find((z) => z.id === aId)!.center;
  const b = layout.zones.find((z) => z.id === bId)!.center;
  const otherCenters = new Set(layout.zones.filter((z) => z.id !== aId && z.id !== bId).map((z) => key(z.center.x, z.center.y)));
  const score = (path: Tile[]) => {
    const inside = path.filter((t) => {
      const owner = regions.tiles[t.y]?.[t.x];
      return owner === aId || owner === bId;
    }).length;
    const crossesCenter = path.some((t) => otherCenters.has(key(t.x, t.y)));
    return inside - (crossesCenter ? path.length + 1 : 0);
  };
  const [h, v] = lPaths(a, b);
  return score(v) > score(h) ? v : h;
}

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const SIDES = [
  { bit: N, dx: 0, dy: -1 },
  { bit: E, dx: 1, dy: 0 },
  { bit: S, dx: 0, dy: 1 },
  { bit: W, dx: -1, dy: 0 },
] as const;

function trackMask(set: ReadonlySet<string>, x: number, y: number): number {
  return SIDES.reduce((mask, d) => (set.has(key(x + d.dx, y + d.dy)) ? mask | d.bit : mask), 0);
}

export function generateCountyMap(data: GameData, regions: RegionMap, layout: MapLayout): CountyMap {
  const cfg = data.ui.county;
  const { width, height } = regions;
  const zones = new Map(data.zones.map((z) => [z.id, z]));
  const centers = new Map(layout.zones.map((z) => [z.id, z.center]));
  const reserved = reservedCells(layout);

  // Sea: outside cells close to a port district.
  const portCells: Tile[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (zones.get(regions.tiles[y]![x] ?? "")?.type === "port") portCells.push({ x, y });
  const nearPort = (x: number, y: number) => portCells.some((p) => Math.hypot(p.x - x, p.y - y) <= cfg.sea.reach);

  // Ground.
  const cells: CountyCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: CountyCell[] = [];
    for (let x = 0; x < width; x++) {
      const zoneId = regions.tiles[y]![x] ?? null;
      const zone = zoneId ? zones.get(zoneId) : undefined;
      let ground: string;
      let sea = false;
      if (!zone) {
        sea = nearPort(x, y);
        ground = pick(sea ? cfg.sea.sprites : cfg.outside.ground, null, x, y, "ground");
      } else if (zone.type === "rural" && zone.glyph === cfg.marsh.glyph) {
        ground = cfg.marsh.sprite;
      } else {
        const size = cfg.crops.patchSize;
        const patch = { x: Math.floor(x / size), y: Math.floor(y / size) };
        const crops = cfg.crops.types.includes(zone.type) && roll(zone, patch.x, patch.y, "crops") < cfg.crops.chance;
        ground = pick(crops ? cfg.crops.sprites : cfg.ground[zone.type], zone, x, y, "ground");
      }
      row.push({ zoneId, ground, sea, track: null, deco: null });
    }
    cells.push(row);
  }

  // Roads between neighbours (each pair once).
  const roads: CountyRoad[] = [];
  const roadCells = new Set<string>();
  for (const zone of [...data.zones].sort((p, q) => p.id.localeCompare(q.id))) {
    for (const other of [...zone.adjacent].sort()) {
      if (other < zone.id || !centers.has(other)) continue;
      const tiles = roadPath(regions, layout, zone.id, other);
      roads.push({ a: zone.id, b: other, tiles });
      for (const t of tiles) roadCells.add(key(t.x, t.y));
    }
  }
  const pieces = data.ui.localMap.autotile[cfg.road].pieces;
  for (const k of roadCells) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (!cells[y]?.[x]) continue;
    const piece = autotile(pieces, trackMask(roadCells, x, y));
    cells[y]![x]!.track = { sprite: localTextureId(piece.sprite), rotation: piece.rotation, kind: "road" };
  }

  // Rails across industrial districts (roads win where they cross).
  const railCells = new Set<string>();
  for (const zone of data.zones.filter((z) => cfg.rails.types.includes(z.type))) {
    const c = centers.get(zone.id);
    if (!c) continue;
    const y = c.y + cfg.rails.row;
    for (let x = 0; x < width; x++) {
      if (regions.tiles[y]?.[x] === zone.id && !roadCells.has(key(x, y)) && !reserved.has(key(x, y))) railCells.add(key(x, y));
    }
  }
  const railPiece = [{ sprite: cfg.rails.sprite, connects: "NS" }];
  for (const k of railCells) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    // Rails only run sideways: a lone piece or an end still lies horizontal.
    const mask = trackMask(railCells, x, y) & (E | W) || E | W;
    const piece = autotile(railPiece, mask);
    cells[y]![x]!.track = { sprite: localTextureId(piece.sprite), rotation: piece.rotation, kind: "rail" };
  }

  // Buildings, rocks and trees.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      const zone = cell.zoneId ? zones.get(cell.zoneId) : undefined;
      const c = cell.zoneId ? centers.get(cell.zoneId) : undefined;
      if (!zone || !c || cell.track || reserved.has(key(x, y))) continue;
      const buildings = cfg.buildings[zone.type];
      if (buildings) {
        const chance = buildings.density - buildings.falloff * Math.hypot(x - c.x, y - c.y);
        if (roll(zone, x, y, "building") < chance) {
          cell.deco = pick(buildings.sprites, zone, x, y, "building-sprite");
          continue;
        }
      }
      if (zone.glyph === cfg.rocks.glyph && roll(zone, x, y, "rocks") < cfg.rocks.density) {
        cell.deco = cfg.rocks.sprite;
        continue;
      }
      const trees = zone.glyph === cfg.forest.denseGlyph ? cfg.forest.denseDensity : (cfg.forest.density[zone.type] ?? 0);
      if (roll(zone, x, y, "tree") < trees) cell.deco = pick(cfg.forest.sprites, zone, x, y, "tree-sprite");
    }
  }

  return { width, height, cells, roads, reserved };
}

/** Rivers run along the closed borders (no direct way between those districts), in a fixed order. */
export function riverSegments(regions: RegionMap): BorderSegment[] {
  return regions.borders.filter((b) => b.kind === "closed");
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * An inner band `band` pixels wide along the outline of a set of cells: the set minus its erosion. Each cell on
 * the edge gets a strip on every side that faces outside, plus a corner square where only the diagonal is outside.
 */
export function innerBand(width: number, height: number, inside: (x: number, y: number) => boolean, tile: number, band: number): Rect[] {
  const rects: Rect[] = [];
  const isIn = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && inside(x, y);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isIn(x, y)) continue;
      const px = x * tile;
      const py = y * tile;
      const n = isIn(x, y - 1);
      const s = isIn(x, y + 1);
      const w = isIn(x - 1, y);
      const e = isIn(x + 1, y);
      if (!n) rects.push({ x: px, y: py, w: tile, h: band });
      if (!s) rects.push({ x: px, y: py + tile - band, w: tile, h: band });
      if (!w) rects.push({ x: px, y: py, w: band, h: tile });
      if (!e) rects.push({ x: px + tile - band, y: py, w: band, h: tile });
      if (n && w && !isIn(x - 1, y - 1)) rects.push({ x: px, y: py, w: band, h: band });
      if (n && e && !isIn(x + 1, y - 1)) rects.push({ x: px + tile - band, y: py, w: band, h: band });
      if (s && w && !isIn(x - 1, y + 1)) rects.push({ x: px, y: py + tile - band, w: band, h: band });
      if (s && e && !isIn(x + 1, y + 1)) rects.push({ x: px + tile - band, y: py + tile - band, w: band, h: band });
    }
  }
  return rects;
}

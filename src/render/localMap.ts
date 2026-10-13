// Local map of a district (phase 10): what you see when you zoom into a zone on the political map.
// Generated deterministically from the zone id and its type, so it's always the same place.
// It holds the zone's building lots (one per business slot), exits towards neighbouring zones and
// spots where our members show up while working there. Pure: tested in Node.

import type { GameData, ZoneDef } from "../data/schemas";
import { createRng, type Rng } from "../sim/rng";
import { hashId } from "./hash";

/** What a tile shows: terrain kind (for color) and an optional sprite from the tileset. */
export type LocalTerrain = "ground" | "grass" | "road" | "building" | "tree" | "water" | "dock" | "crate" | "rail" | "boat";

export interface LocalTile {
  terrain: LocalTerrain;
  glyph: string;
  /** Key in ui.json localMap.sprites, e.g. "building", "tree". */
  sprite: string | null;
}

export interface Lot {
  index: number;
  /** Top-left tile of the 3×3 lot. */
  x: number;
  y: number;
}

export interface Exit {
  zoneId: string;
  x: number;
  y: number;
  /** Arrow pointing out of the map. */
  arrow: string;
}

export interface LocalMap {
  zoneId: string;
  width: number;
  height: number;
  tiles: LocalTile[][];
  lots: Lot[];
  exits: Exit[];
  /** Where working members are drawn, in order. */
  memberSpots: { x: number; y: number }[];
}

const LOT_SIZE = 3;

function blank(width: number, height: number, tile: LocalTile): LocalTile[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ...tile })));
}

const T = {
  ground: { terrain: "ground", glyph: ".", sprite: null } as LocalTile,
  grass: { terrain: "grass", glyph: '"', sprite: null } as LocalTile,
  roadH: { terrain: "road", glyph: "=", sprite: null } as LocalTile,
  roadV: { terrain: "road", glyph: "|", sprite: null } as LocalTile,
  dirt: { terrain: "road", glyph: ":", sprite: null } as LocalTile,
  building: { terrain: "building", glyph: "n", sprite: "building" } as LocalTile,
  factory: { terrain: "building", glyph: "M", sprite: "factory" } as LocalTile,
  tree: { terrain: "tree", glyph: "T", sprite: "tree" } as LocalTile,
  water: { terrain: "water", glyph: "~", sprite: null } as LocalTile,
  dock: { terrain: "dock", glyph: "#", sprite: null } as LocalTile,
  crate: { terrain: "crate", glyph: "x", sprite: "crate" } as LocalTile,
  rail: { terrain: "rail", glyph: "+", sprite: null } as LocalTile,
  boat: { terrain: "boat", glyph: "b", sprite: "boat" } as LocalTile,
};

/** Lot positions (top-left) per zone type: up to 3, placed next to the main street/road. */
function lotPositions(type: ZoneDef["type"], width: number, height: number): { x: number; y: number }[] {
  const mid = Math.floor(height / 2);
  switch (type) {
    case "port":
      return [7, 17, 26].map((x, i) => ({ x, y: i % 2 === 0 ? mid - 5 : mid + 3 }));
    default:
      return [Math.floor(width * 0.2), Math.floor(width * 0.45), Math.floor(width * 0.7)].map((x, i) => ({
        x,
        y: i % 2 === 0 ? mid - 5 : mid + 3,
      }));
  }
}

function paintTown(tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const mid = Math.floor(h / 2);
  for (let x = 0; x < w; x++) for (const y of [mid - 1, mid]) tiles[y]![x] = { ...T.roadH };
  for (const sx of [Math.floor(w * 0.12), Math.floor(w * 0.38), Math.floor(w * 0.63), Math.floor(w * 0.88)]) {
    for (let y = 0; y < h; y++) if (y !== mid - 1 && y !== mid) tiles[y]![sx] = { ...T.roadV };
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y]![x]!.terrain !== "ground") continue;
    const roll = rng.next();
    if (roll < 0.16) tiles[y]![x] = { ...T.building };
    else if (roll < 0.2) tiles[y]![x] = { ...T.tree };
  }
}

function paintRural(tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const mid = Math.floor(h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y]![x] = rng.chance(0.55) ? { ...T.grass } : { ...T.ground };
  for (let x = 0; x < w; x++) tiles[mid]![x] = { ...T.dirt };
  // A few groves.
  for (let g = 0; g < 7; g++) {
    const cx = rng.int(2, w - 3);
    const cy = rng.int(2, h - 3);
    for (let i = 0; i < 9; i++) {
      const x = cx + rng.int(-2, 2);
      const y = cy + rng.int(-2, 2);
      if (y !== mid && tiles[y]?.[x]) tiles[y]![x] = { ...T.tree };
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.int(1, w - 2);
    const y = rng.int(1, h - 2);
    if (y !== mid) tiles[y]![x] = { ...T.building };
  }
}

function paintRoad(tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const mid = Math.floor(h / 2);
  for (let x = 0; x < w; x++) {
    tiles[mid - 1]![x] = { ...T.roadH };
    tiles[mid]![x] = { terrain: "road", glyph: x % 4 < 2 ? "-" : " ", sprite: null };
    tiles[mid + 1]![x] = { ...T.roadH };
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y]![x]!.terrain === "ground" && rng.chance(0.06)) tiles[y]![x] = rng.chance(0.5) ? { ...T.tree } : { ...T.grass };
  }
}

function paintPort(tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const shore = Math.floor(w * 0.68);
  for (let y = 0; y < h; y++) for (let x = shore; x < w; x++) tiles[y]![x] = { ...T.water };
  for (const py of [Math.floor(h * 0.25), Math.floor(h * 0.5), Math.floor(h * 0.75)]) {
    for (let x = shore - 2; x < shore + 8; x++) tiles[py]![x] = { ...T.dock };
    if (tiles[py - 1]?.[shore + 9]) tiles[py - 1]![shore + 9] = { ...T.boat };
  }
  const mid = Math.floor(h / 2);
  for (let y = 0; y < h; y++) tiles[y]![shore - 3] = { ...T.roadV };
  for (let x = 0; x < shore - 3; x++) tiles[mid]![x] = { ...T.roadH };
  for (let y = 0; y < h; y++) for (let x = 0; x < shore - 3; x++) {
    if (tiles[y]![x]!.terrain !== "ground") continue;
    const roll = rng.next();
    if (roll < 0.12) tiles[y]![x] = { ...T.crate };
    else if (roll < 0.24) tiles[y]![x] = { ...T.building };
  }
}

function paintIndustrial(tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const mid = Math.floor(h / 2);
  for (let x = 0; x < w; x++) {
    tiles[mid]![x] = { ...T.roadH };
    tiles[h - 4]![x] = { ...T.rail };
  }
  for (let b = 0; b < 8; b++) {
    const bx = rng.int(1, w - 6);
    const by = rng.int(1, h - 8);
    for (let y = by; y < by + 3; y++) for (let x = bx; x < bx + 5; x++) if (y !== mid && tiles[y]?.[x]) tiles[y]![x] = { ...T.factory };
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y]![x]!.terrain === "ground" && rng.chance(0.07)) tiles[y]![x] = { ...T.crate };
  }
}

/** Arrow and border position towards a neighbour, from the direction between the two district centers. */
function exitTowards(from: ZoneDef, to: ZoneDef, w: number, h: number): Omit<Exit, "zoneId"> {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const clampY = (y: number) => Math.min(h - 1, Math.max(0, Math.round(y)));
  const clampX = (x: number) => Math.min(w - 1, Math.max(0, Math.round(x)));
  // Leave through the side the direction hits first (normalised by the map's proportions).
  if (Math.abs(dx) / w >= Math.abs(dy) / h) {
    return { x: dx > 0 ? w - 1 : 0, y: clampY(h / 2 + (dy * (w / 2)) / Math.abs(dx)), arrow: dx > 0 ? ">" : "<" };
  }
  return { x: clampX(w / 2 + (dx * (h / 2)) / Math.abs(dy)), y: dy > 0 ? h - 1 : 0, arrow: dy > 0 ? "v" : "^" };
}

export function generateLocalMap(data: GameData, zoneId: string): LocalMap {
  const zone = data.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);
  const { width, height } = data.ui.map;
  const rng = createRng(hashId(zoneId));
  const tiles = blank(width, height, T.ground);
  ({ town: paintTown, rural: paintRural, road: paintRoad, port: paintPort, industrial: paintIndustrial })[zone.type](tiles, rng, width, height);

  // Lots: cleared 3×3 areas (they're drawn on top by the renderer).
  const lots = lotPositions(zone.type, width, height)
    .slice(0, zone.businessSlots)
    .map((p, index) => ({ index, ...p }));
  for (const lot of lots) {
    for (let y = lot.y; y < lot.y + LOT_SIZE; y++) for (let x = lot.x; x < lot.x + LOT_SIZE; x++) tiles[y]![x] = { ...T.ground };
  }

  const exits = zone.adjacent
    .map((id) => data.zones.find((z) => z.id === id))
    .filter((z): z is ZoneDef => z !== undefined)
    .map((to) => ({ zoneId: to.id, ...exitTowards(zone, to, width, height) }));
  // Clear a little space around each exit so its arrow and name are readable.
  for (const exit of exits) {
    for (let y = exit.y - 1; y <= exit.y + 1; y++) {
      for (let x = exit.x - 5; x <= exit.x + 5; x++) {
        const cell = tiles[y]?.[x];
        if (cell && cell.terrain !== "water" && cell.terrain !== "road") tiles[y]![x] = { ...T.ground };
      }
    }
  }

  // Members stand along the main street, left to right.
  const mid = Math.floor(height / 2);
  const memberSpots = Array.from({ length: data.balance.club.memberCap }, (_, i) => ({ x: 3 + i * 3, y: zone.type === "port" ? mid + 1 : mid + (zone.type === "road" ? 2 : 1) }));
  for (const spot of memberSpots) if (tiles[spot.y]?.[spot.x]?.terrain !== "water") tiles[spot.y]![spot.x] = { ...T.ground };

  return { zoneId, width, height, tiles, lots, exits, memberSpots };
}

export const LOCAL_LOT_SIZE = LOT_SIZE;

// Local map of a district (phase 10): what you see when you zoom into a zone on the political map.
// Generated deterministically from the zone id and its type, so it's always the same place.
// Rural zones (and some towns) have a river running from the top edge to the bottom one; roads cross it on bridges.
// It holds the zone's building lots (one per business slot), exits towards neighbouring zones, spots where our
// members show up while working there and landmarks (club and sheriff headquarters, gas station, motel).
// Roads are one tile wide and drawn with a 4-neighbour mask (autotiling); trees, buildings and ground get a
// sprite variant per tile. Sprites and variants come from data/ui.json, buildings and glyphs from data/tileset.json.
// Sprites that don't cover their whole cell (trees, buildings, fences...) get a ground sprite below, picked with the
// same ground variants of the zone type. Pure: tested in Node.

import type { GameData, RoadKind, ZoneDef } from "../data/schemas";
import { createRng, type Rng } from "../sim/rng";
import { localTextureId } from "../data/validate";
import { hashId } from "./hash";

/** What a tile shows: terrain kind (for color) and an optional sprite from the tileset. */
export type LocalTerrain =
  | "ground"
  | "sidewalk"
  | "grass"
  | "road"
  | "building"
  | "tree"
  | "water"
  | "dock"
  | "crate"
  | "rail"
  | "boat"
  | "fence";

export interface LocalTile {
  terrain: LocalTerrain;
  glyph: string;
  /** Sprite key, e.g. "building", "asphalt_curve" (texture "local.<key>"; see localTextureId). */
  sprite: string | null;
  /** Ground sprite key drawn below a sprite that doesn't cover the cell (or below a cell without sprite). */
  under?: string;
  /** Quarter turns clockwise applied to the sprite (autotiled roads and rails). */
  rotation: number;
  /** Which kind of road, for autotiling. */
  road?: RoadKind;
  /** Part of a river (autotiled with the river pieces). */
  river?: boolean;
}

export interface Lot {
  index: number;
  /** Top-left tile of the 3×3 lot. */
  x: number;
  y: number;
  /** Free corner on the street side, where a bar hangs its sign. */
  signSpot: { x: number; y: number };
}

export interface Exit {
  zoneId: string;
  x: number;
  y: number;
  /** Arrow pointing out of the map. */
  arrow: string;
}

export type LandmarkKind = "club_hq" | "sheriff_hq" | "parked_bike" | "gas_station" | "motel";

/** Something drawn on top of the terrain with a tileset.json texture. */
export interface Landmark {
  kind: LandmarkKind;
  /** Texture id, e.g. "extra.club_hq". */
  sprite: string;
  glyph: string;
  x: number;
  y: number;
  /** Whose color it takes (headquarters and their bikes), or null. */
  factionId: string | null;
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
  landmarks: Landmark[];
}

const LOT_SIZE = 3;
/** Half-width and half-height of the space kept clear around an exit arrow and its name. */
const EXIT_CLEAR = { x: 5, y: 1 };
/** Tries before falling back to a scan when placing roadside landmarks. */
const ROADSIDE_TRIES = 40;
/** Columns kept between the gas station and the motel. */
const ROADSIDE_GAP = 4;

function blank(width: number, height: number, tile: LocalTile): LocalTile[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ...tile })));
}

const T = {
  ground: { terrain: "ground", glyph: ".", sprite: null, rotation: 0 } as LocalTile,
  grass: { terrain: "grass", glyph: '"', sprite: null, rotation: 0 } as LocalTile,
  asphalt: { terrain: "road", glyph: "=", sprite: null, rotation: 0, road: "asphalt" } as LocalTile,
  dirt: { terrain: "road", glyph: ":", sprite: null, rotation: 0, road: "dirt" } as LocalTile,
  building: { terrain: "building", glyph: "n", sprite: "building", rotation: 0 } as LocalTile,
  factory: { terrain: "building", glyph: "M", sprite: "factory", rotation: 0 } as LocalTile,
  tree: { terrain: "tree", glyph: "T", sprite: "tree", rotation: 0 } as LocalTile,
  water: { terrain: "water", glyph: "~", sprite: null, rotation: 0 } as LocalTile,
  dock: { terrain: "dock", glyph: "#", sprite: null, rotation: 0 } as LocalTile,
  crate: { terrain: "crate", glyph: "x", sprite: "crate", rotation: 0 } as LocalTile,
  rail: { terrain: "rail", glyph: "+", sprite: null, rotation: 0 } as LocalTile,
  boat: { terrain: "boat", glyph: "b", sprite: "boat", rotation: 0 } as LocalTile,
};

/** Terrain an element must never be placed on (GDD: landmarks don't cover roads or water). */
const BLOCKING: ReadonlySet<LocalTerrain> = new Set(["road", "water", "dock", "boat", "rail"]);
/** Terrain members can stand on as is; anything else is cleared under them. */
const WALKABLE: ReadonlySet<LocalTerrain> = new Set(["ground", "sidewalk", "grass", "road", "dock"]);

// ---------- Autotiling ----------

const DIRECTIONS = [
  { name: "N", bit: 1, dx: 0, dy: -1 },
  { name: "E", bit: 2, dx: 1, dy: 0 },
  { name: "S", bit: 4, dx: 0, dy: 1 },
  { name: "W", bit: 8, dx: -1, dy: 0 },
] as const;
const ALL = 15;
const VERTICAL = 1 | 4;
const HORIZONTAL = 2 | 8;

export function connectionMask(connects: string): number {
  return DIRECTIONS.filter((d) => connects.includes(d.name)).reduce((mask, d) => mask | d.bit, 0);
}

/** Turns a mask a quarter clockwise `turns` times (N→E→S→W→N). */
export function rotateMask(mask: number, turns: number): number {
  let m = mask;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & ALL;
  return m;
}

/**
 * Picks the piece and rotation that match a 4-neighbour mask. Masks no piece covers (a dead end without an
 * "end" piece, an isolated tile) fall back to the straight piece along the axis of the connection.
 */
export function autotile(pieces: readonly { sprite: string; connects: string }[], mask: number): { sprite: string; rotation: number } {
  for (const piece of pieces) {
    const base = connectionMask(piece.connects);
    for (let turns = 0; turns < 4; turns++) if (rotateMask(base, turns) === mask) return { sprite: piece.sprite, rotation: turns };
  }
  const straight = pieces.find((p) => connectionMask(p.connects) === VERTICAL || connectionMask(p.connects) === HORIZONTAL) ?? pieces[0]!;
  const base = connectionMask(straight.connects);
  const wanted = mask & VERTICAL && !(mask & HORIZONTAL) ? VERTICAL : HORIZONTAL;
  return { sprite: straight.sprite, rotation: rotateMask(base, 1) === wanted ? 1 : 0 };
}

function maskAt(tiles: LocalTile[][], x: number, y: number, connects: (t: LocalTile) => boolean): number {
  let mask = 0;
  for (const d of DIRECTIONS) {
    const n = tiles[y + d.dy]?.[x + d.dx];
    // Roads and rails run off the map: the edge counts as connected.
    if (n === undefined || connects(n)) mask |= d.bit;
  }
  return mask;
}

function applyAutotile(data: GameData, tiles: LocalTile[][]): void {
  const local = data.ui.localMap;
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y]!.length; x++) {
      const cell = tiles[y]![x]!;
      if (cell.terrain === "road" && cell.road) {
        const set = local.autotile[cell.road];
        const mask = maskAt(tiles, x, y, (t) => t.terrain === "road");
        const piece = autotile(set.pieces, mask);
        const glyph = (mask & ALL) === 0 || (mask & ~HORIZONTAL) === 0 ? set.glyphs.horizontal : (mask & ~VERTICAL) === 0 ? set.glyphs.vertical : set.glyphs.junction;
        tiles[y]![x] = { ...cell, sprite: piece.sprite, rotation: piece.rotation, glyph };
      } else if (cell.terrain === "rail") {
        const mask = maskAt(tiles, x, y, (t) => t.terrain === "rail");
        const piece = autotile([local.rails], mask);
        tiles[y]![x] = { ...cell, sprite: piece.sprite, rotation: piece.rotation, glyph: spriteGlyph(data, piece.sprite) ?? cell.glyph };
      }
    }
  }
}

// ---------- Painting per zone type ----------

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

function paintTown(data: GameData, tiles: LocalTile[][], rng: Rng, w: number, h: number): void {
  const cfg = data.ui.localMap.town;
  for (const fy of cfg.streetRows) for (let x = 0; x < w; x++) tiles[Math.floor(h * fy)]![x] = { ...T.asphalt };
  for (const fx of cfg.streetColumns) for (let y = 0; y < h; y++) tiles[y]![Math.floor(w * fx)] = { ...T.asphalt };
  // Sidewalks along every street.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y]![x]!.terrain !== "ground") continue;
    const nextToRoad = DIRECTIONS.some((d) => tiles[y + d.dy]?.[x + d.dx]?.terrain === "road");
    if (nextToRoad) tiles[y]![x] = { ...T.ground, terrain: "sidewalk", glyph: "," };
  }
  // Packed blocks: buildings up to the street, a few trees.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const terrain = tiles[y]![x]!.terrain;
    if (terrain !== "ground" && terrain !== "sidewalk") continue;
    const roll = rng.next();
    if (roll < cfg.building) tiles[y]![x] = { ...T.building };
    else if (roll < cfg.building + cfg.tree) tiles[y]![x] = { ...T.tree };
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
  for (let x = 0; x < w; x++) tiles[mid]![x] = { ...T.asphalt };
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
  for (let y = 0; y < h; y++) tiles[y]![shore - 3] = { ...T.asphalt };
  for (let x = 0; x < shore - 3; x++) tiles[mid]![x] = { ...T.asphalt };
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
    tiles[mid]![x] = { ...T.asphalt };
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

// ---------- River ----------

/**
 * A river from the top edge to the bottom one, drifting a column sideways now and then. It never touches lots,
 * exits, member spots or existing water, and only crosses roads straight across (a bridge). Several paths are
 * tried with the zone's own seed; if none fits, the zone has no river. Returns the river tiles, bridges included.
 */
function placeRiver(data: GameData, zone: ZoneDef, tiles: LocalTile[][], forbidden: ReadonlySet<string>): Set<string> {
  const cfg = data.ui.localMap.river;
  const width = tiles[0]!.length;
  const height = tiles.length;
  const rng = createRng(hashId(`${zone.localSeed ?? ""}${zone.id}:river`));
  if (!rng.chance(cfg.chance[zone.type] ?? 0)) return new Set();
  const isRoad = (x: number, y: number) => tiles[y]?.[x]?.terrain === "road";
  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    let x = rng.int(2, width - 3);
    const path: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      path.push({ x, y });
      if (y < height - 1 && rng.chance(cfg.meander)) {
        const nx = x + (rng.chance(0.5) ? 1 : -1);
        if (nx >= 1 && nx <= width - 2) {
          path.push({ x: nx, y });
          x = nx;
        }
      }
    }
    const keys = new Set(path.map((p) => `${p.x},${p.y}`));
    const fits = path.every((p) => {
      const cell = tiles[p.y]![p.x]!;
      if (forbidden.has(`${p.x},${p.y}`) || cell.terrain === "water" || cell.terrain === "dock" || cell.terrain === "rail") return false;
      if (!isRoad(p.x, p.y)) return true;
      // A bridge: the river goes straight under a road that runs across it.
      return keys.has(`${p.x},${p.y - 1}`) && keys.has(`${p.x},${p.y + 1}`) && !isRoad(p.x, p.y - 1) && !isRoad(p.x, p.y + 1) && !keys.has(`${p.x - 1},${p.y}`) && !keys.has(`${p.x + 1},${p.y}`);
    });
    if (!fits) continue;
    for (const p of path) if (!isRoad(p.x, p.y)) tiles[p.y]![p.x] = { terrain: "water", glyph: cfg.glyph, sprite: null, rotation: 0, river: true };
    return keys;
  }
  return new Set();
}

function applyRiverAutotile(data: GameData, zone: ZoneDef, tiles: LocalTile[][], river: ReadonlySet<string>): void {
  const { sets } = data.ui.localMap.river;
  for (const key of river) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const cell = tiles[y]![x]!;
    if (!cell.river) continue;
    let mask = 0;
    for (const d of DIRECTIONS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (tiles[ny]?.[nx] === undefined || river.has(`${nx},${ny}`)) mask |= d.bit;
    }
    const piece = autotile(sets[variantIndex(`${zone.localSeed ?? ""}${zone.id}`, x, y, sets.length)]!, mask);
    tiles[y]![x] = { ...cell, sprite: piece.sprite, rotation: piece.rotation };
  }
}

// ---------- Variants ----------

/** Same zone and tile, same variant; independent from the painting RNG so variants never move lots or exits. */
function variantIndex(zoneId: string, x: number, y: number, count: number): number {
  return hashId(`${zoneId}:${x},${y}`) % count;
}

/** ASCII glyph of a sprite key, from tileset.json. */
function spriteGlyph(data: GameData, key: string): string | undefined {
  return data.tileset.sprites[localTextureId(key)]?.glyph;
}

/** Variant options for a terrain kind in a zone type: buildings from tileset.json, the rest from ui.json. */
function variantOptions(data: GameData, terrain: LocalTerrain, type: ZoneDef["type"]): readonly string[] {
  if (terrain === "building") return data.tileset.buildingVariants[type];
  const byType = data.ui.localMap.variants[terrain];
  return byType?.[type] ?? byType?.["*"] ?? [];
}

/**
 * The ground sprite drawn below a cell of this terrain at (x, y): the zone type's ground variant (same pick as
 * ground cells), or the variant of the terrain set in ui.json underTerrain (water below a boat).
 */
export function groundUnder(data: GameData, zone: ZoneDef, terrain: LocalTerrain, x: number, y: number): string | undefined {
  const below = (data.ui.localMap.underTerrain[terrain] ?? "ground") as LocalTerrain;
  const options = variantOptions(data, below, zone.type);
  return options.length > 0 ? options[variantIndex(`${zone.localSeed ?? ""}${zone.id}`, x, y, options.length)] : undefined;
}

function applyVariants(data: GameData, zone: ZoneDef, tiles: LocalTile[][]): void {
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y]!.length; x++) {
      let cell = tiles[y]![x]!;
      // River tiles already have their autotiled piece.
      const options = cell.river ? [] : variantOptions(data, cell.terrain, zone.type);
      if (options.length > 0) {
        const sprite = options[variantIndex(`${zone.localSeed ?? ""}${zone.id}`, x, y, options.length)]!;
        cell = { ...cell, sprite, glyph: spriteGlyph(data, sprite) ?? cell.glyph };
      }
      const opaque = cell.sprite !== null && data.tileset.sprites[localTextureId(cell.sprite)]?.opaque === true;
      const under = opaque ? undefined : groundUnder(data, zone, cell.terrain, x, y);
      tiles[y]![x] = under === undefined ? cell : { ...cell, under };
    }
  }
}

// ---------- Landmarks ----------

function landmarkGlyph(data: GameData, textureId: string): string {
  return data.tileset.sprites[textureId]?.glyph ?? "?";
}

/** Tiles no landmark may cover: lots, the space around exits, member spots, roads and water. */
function forbiddenTiles(lots: Lot[], exits: Exit[], memberSpots: { x: number; y: number }[]): Set<string> {
  const forbidden = new Set<string>();
  for (const lot of lots) for (let y = lot.y; y < lot.y + LOT_SIZE; y++) for (let x = lot.x; x < lot.x + LOT_SIZE; x++) forbidden.add(`${x},${y}`);
  for (const exit of exits) {
    for (let y = exit.y - EXIT_CLEAR.y; y <= exit.y + EXIT_CLEAR.y; y++) for (let x = exit.x - EXIT_CLEAR.x; x <= exit.x + EXIT_CLEAR.x; x++) forbidden.add(`${x},${y}`);
  }
  for (const p of memberSpots) forbidden.add(`${p.x},${p.y}`);
  return forbidden;
}

function placeLandmarks(data: GameData, zone: ZoneDef, tiles: LocalTile[][], forbidden: Set<string>): Landmark[] {
  const lm = data.ui.localMap.landmarks;
  const width = tiles[0]!.length;
  const height = tiles.length;
  const mid = Math.floor(height / 2);
  const landmarks: Landmark[] = [];
  const free = (x: number, y: number) => {
    const cell = tiles[y]?.[x];
    return cell !== undefined && !BLOCKING.has(cell.terrain) && !forbidden.has(`${x},${y}`);
  };
  const add = (kind: LandmarkKind, sprite: string, x: number, y: number, factionId: string | null) => {
    landmarks.push({ kind, sprite, glyph: landmarkGlyph(data, sprite), x, y, factionId });
    forbidden.add(`${x},${y}`);
    tiles[y]![x] = { ...T.ground };
  };

  // Headquarters: a fixed spot (first fit, scanning rows near the main street first), with parked bikes beside clubs.
  const rows = [mid - 2, mid + 2, mid - 6, mid + 6, ...Array.from({ length: height }, (_, y) => y)];
  for (const faction of data.factions.filter((f) => f.hqZoneId === zone.id && (f.kind === "club" || f.kind === "sheriff"))) {
    const club = faction.kind === "club";
    const span = club ? 1 + lm.parkedBikes : 1;
    let spot: { x: number; y: number } | null = null;
    for (const y of rows) {
      for (let x = 1; x + span < width && !spot; x++) {
        if (Array.from({ length: span }, (_, i) => free(x + i, y)).every(Boolean)) spot = { x, y };
      }
      if (spot) break;
    }
    if (!spot) continue;
    add(club ? "club_hq" : "sheriff_hq", club ? lm.clubHq : lm.sheriffHq, spot.x, spot.y, faction.id);
    if (club) for (let i = 1; i <= lm.parkedBikes; i++) add("parked_bike", lm.parkedBike, spot.x + i, spot.y, faction.id);
  }

  // Highways: a gas station above the road and a motel below it, somewhere along the way.
  if (zone.type === "road") {
    const rng = createRng(hashId(`${zone.localSeed ?? ""}${zone.id}:roadside`));
    const pick = (y: number, avoidX: number | null): number | null => {
      const ok = (x: number) => free(x, y) && (avoidX === null || Math.abs(x - avoidX) >= ROADSIDE_GAP);
      for (let i = 0; i < ROADSIDE_TRIES; i++) {
        const x = rng.int(1, width - 2);
        if (ok(x)) return x;
      }
      for (let x = 1; x < width - 1; x++) if (ok(x)) return x;
      return null;
    };
    const gasX = pick(mid - 1, null);
    if (gasX !== null) add("gas_station", lm.gasStation, gasX, mid - 1, null);
    const motelX = pick(mid + 1, gasX);
    if (motelX !== null) add("motel", lm.motel, motelX, mid + 1, null);
  }
  return landmarks;
}

export function generateLocalMap(data: GameData, zoneId: string): LocalMap {
  const zone = data.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);
  const { width, height } = data.ui.map;
  const local = data.ui.localMap;
  const rng = createRng(zone.localSeed ?? hashId(zoneId));
  const tiles = blank(width, height, T.ground);
  if (zone.type === "town") paintTown(data, tiles, rng, width, height);
  else ({ rural: paintRural, road: paintRoad, port: paintPort, industrial: paintIndustrial })[zone.type](tiles, rng, width, height);
  const mid = Math.floor(height / 2);

  // Lots: cleared 3×3 areas (they're drawn on top by the renderer), fenced on the side away from the street.
  const fence = local.lotFence[zone.type];
  const lots: Lot[] = lotPositions(zone.type, width, height)
    .slice(0, zone.businessSlots)
    .map((p, index) => {
      const aboveStreet = p.y + 1 < mid;
      const streetRow = aboveStreet ? p.y + LOT_SIZE - 1 : p.y;
      return { index, ...p, signSpot: { x: p.x + LOT_SIZE - 1, y: streetRow } };
    });
  for (const lot of lots) {
    const backRow = lot.signSpot.y === lot.y ? lot.y + LOT_SIZE - 1 : lot.y;
    for (let y = lot.y; y < lot.y + LOT_SIZE; y++) {
      for (let x = lot.x; x < lot.x + LOT_SIZE; x++) {
        tiles[y]![x] = y === backRow ? { terrain: "fence", glyph: spriteGlyph(data, fence) ?? "-", sprite: fence, rotation: 0 } : { ...T.ground };
      }
    }
  }

  const exits = zone.adjacent
    .map((id) => data.zones.find((z) => z.id === id))
    .filter((z): z is ZoneDef => z !== undefined)
    .map((to) => ({ zoneId: to.id, ...exitTowards(zone, to, width, height) }));
  // Clear a little space around each exit so its arrow and name are readable.
  for (const exit of exits) {
    for (let y = exit.y - EXIT_CLEAR.y; y <= exit.y + EXIT_CLEAR.y; y++) {
      for (let x = exit.x - EXIT_CLEAR.x; x <= exit.x + EXIT_CLEAR.x; x++) {
        const cell = tiles[y]?.[x];
        if (cell && !BLOCKING.has(cell.terrain) && cell.terrain !== "fence") tiles[y]![x] = { ...T.ground };
      }
    }
  }

  // Members stand along the main street, left to right.
  // One row of spots along the street (as many as fit: big clubs rarely send everyone to one district).
  const memberSpots = Array.from({ length: Math.min(data.balance.club.memberCap, Math.floor((width - 3) / 3)) }, (_, i) => ({ x: 3 + i * 3, y: zone.type === "road" ? mid + 2 : mid + 1 }));
  for (const spot of memberSpots) {
    const cell = tiles[spot.y]?.[spot.x];
    if (cell && !WALKABLE.has(cell.terrain) && cell.terrain !== "water") tiles[spot.y]![spot.x] = { ...T.ground };
  }

  const forbidden = forbiddenTiles(lots, exits, memberSpots);
  const river = placeRiver(data, zone, tiles, forbidden);
  const landmarks = placeLandmarks(data, zone, tiles, forbidden);
  applyAutotile(data, tiles);
  applyRiverAutotile(data, zone, tiles, river);
  applyVariants(data, zone, tiles);
  return { zoneId, width, height, tiles, lots, exits, memberSpots, landmarks };
}

export const LOCAL_LOT_SIZE = LOT_SIZE;

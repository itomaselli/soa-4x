// Random counties (phase 12). From a seed and a size (data/mapgen.json) it builds a whole scenario:
//   1. district centers spread over the map (minimum distance, names that don't overlap),
//   2. connections where the regions of the political map touch, some turned into closed borders (river, ridge),
//      always keeping the county connected,
//   3. the cartel's port on the county's edge, club HQs as far apart as possible, the sheriff in the most
//      central town, then the rest of the types (roads at crossings, countryside at the edges),
//   4. names, values per type and starting influence around each HQ,
//   5. rival clubs with a name, color, patch and AI profile, and members with the same strength as the player's.
// Pure and deterministic: same seed and size, same county.

import type { FactionDef, GameData, MemberDef, ZoneDef } from "../data/schemas";
import { computeRegions, sharedBorderLengths } from "./regions";
import { createRng, type Rng } from "./rng";
import { TRAITS, type MapSize, type Rank, type Scenario, type ZoneType } from "./state";

export interface GenerateOptions {
  size: MapSize;
  seed: number;
  playerFactionId: string;
  /** The player's patch, so rivals don't wear the same one. */
  playerPatchId: string | null;
}

/** Mixed into the seed so the map has its own random sequence, apart from the game's. */
const MAP_SEED_SALT = 0x5bd1e995;
/** Local map seeds are positive 31-bit integers. */
const LOCAL_SEED_MAX = 0x7fffffff;

interface Point {
  x: number;
  y: number;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------- 1. District centers ----------

function placeCenters(content: GameData, size: MapSize, rng: Rng): Point[] | null {
  const cfg = content.mapgen;
  const { width, height } = content.ui.map;
  const sz = cfg.sizes[size];
  const { layout } = cfg;
  // The name is centered under the center: the longest one has to fit inside the map.
  const longest = Math.max(...Object.values(cfg.places).flatMap((list) => list.map((p) => p.short.length)));
  const half = Math.floor(longest / 2);
  const box = {
    x0: Math.max(half, Math.floor((width - sz.area.width) / 2) + layout.margin),
    y0: Math.floor((height - sz.area.height) / 2) + layout.margin,
    x1: Math.min(width - 1 - (longest - 1 - half), Math.floor((width - sz.area.width) / 2) + sz.area.width - 1 - layout.margin),
    // The name goes two rows below the center: keep it inside the map.
    y1: Math.min(height - 3, Math.floor((height - sz.area.height) / 2) + sz.area.height - 1 - layout.margin),
  };
  const fits = (p: Point, points: readonly Point[], distance: number) =>
    p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1 &&
    points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= distance && (Math.abs(p.y - q.y) > layout.sameRowRows || Math.abs(p.x - q.x) >= layout.sameRowGap));

  // First, scattered at random (looks the most natural).
  for (let distance = layout.minDistance; distance >= layout.minDistanceFloor; distance -= 0.5) {
    for (let tryLayout = 0; tryLayout < layout.layoutsPerDistance; tryLayout++) {
      const points: Point[] = [];
      let failed = false;
      while (points.length < sz.zones && !failed) {
        let placed = false;
        for (let attempt = 0; attempt < layout.attemptsPerZone && !placed; attempt++) {
          const p = { x: rng.int(box.x0, box.x1), y: rng.int(box.y0, box.y1) };
          if (fits(p, points, distance)) {
            points.push(p);
            placed = true;
          }
        }
        if (!placed) failed = true;
      }
      if (!failed) return points;
    }
  }
  return latticeCenters(box, sz.zones, layout, fits, rng);
}

/**
 * Dense counties: a staggered grid (rows sameRowRows+1 apart, columns sameRowGap apart, every other row shifted
 * half a column, each row nudged one tile at random), and a connected blob of it grown from a random cell.
 * Row nudges keep every spacing rule: same-row distances don't change and the next row stays sameRowRows+1 away.
 */
function latticeCenters(
  box: { x0: number; y0: number; x1: number; y1: number },
  count: number,
  layout: GameData["mapgen"]["layout"],
  fits: (p: Point, points: readonly Point[], distance: number) => boolean,
  rng: Rng,
): Point[] | null {
  const rowStep = layout.sameRowRows + 1;
  const colStep = layout.sameRowGap;
  const cells: Point[] = [];
  for (let row = 0, y = box.y0; y <= box.y1; row++, y += rowStep) {
    const shift = (row % 2 === 0 ? 0 : Math.floor(colStep / 2)) + rng.int(0, 1);
    for (let x = box.x0 + shift; x <= box.x1; x += colStep) cells.push({ x, y });
  }
  if (cells.length < count) return null;
  const near = (a: Point, b: Point) => Math.abs(a.y - b.y) <= rowStep && Math.abs(a.x - b.x) <= colStep;
  const chosen = [cells[rng.int(0, cells.length - 1)]!];
  while (chosen.length < count) {
    const frontier = cells.filter((c) => !chosen.includes(c) && chosen.some((p) => near(p, c)));
    if (frontier.length === 0) return null;
    chosen.push(frontier[rng.int(0, frontier.length - 1)]!);
  }
  const points: Point[] = [];
  for (const c of chosen) {
    if (!fits(c, points, layout.minDistanceFloor)) return null;
    points.push(c);
  }
  return points;
}

// ---------- 2. Connections ----------

type Graph = Map<number, Set<number>>;

function connected(graph: Graph, n: number): boolean {
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length > 0) {
    for (const next of graph.get(stack.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size === n;
}

function distancesFrom(graph: Graph, start: number): Map<number, number> {
  const dist = new Map([[start, 0]]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const node of frontier) {
      for (const n of graph.get(node) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, dist.get(node)! + 1);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

function buildGraph(content: GameData, points: Point[], rng: Rng): { graph: Graph; edgeZones: Set<number> } | null {
  const { layout } = content.mapgen;
  const ids = points.map((_, i) => `z${i}`);
  const regions = computeRegions({ ui: content.ui, zones: points.map((p, i) => ({ id: ids[i]!, position: p, adjacent: [] })) });
  const index = new Map(ids.map((id, i) => [id, i]));
  const graph: Graph = new Map(points.map((_, i) => [i, new Set<number>()]));
  for (const [key, length] of sharedBorderLengths(regions)) {
    if (length < layout.minSharedBorder) continue;
    const [a, b] = key.split("|").map((id) => index.get(id)!);
    graph.get(a!)!.add(b!);
    graph.get(b!)!.add(a!);
  }
  if (!connected(graph, points.length)) return null;

  // Closed borders: drop some connections, never isolating a district or splitting the county.
  const edges = shuffle(
    rng,
    [...graph.entries()].flatMap(([a, ns]) => [...ns].filter((b) => b > a).map((b) => [a, b] as const)),
  );
  const toClose = Math.round(edges.length * layout.closedBorderShare);
  let closed = 0;
  for (const [a, b] of edges) {
    if (closed >= toClose) break;
    if (graph.get(a)!.size <= layout.minDegree || graph.get(b)!.size <= layout.minDegree) continue;
    graph.get(a)!.delete(b);
    graph.get(b)!.delete(a);
    if (connected(graph, points.length)) closed++;
    else {
      graph.get(a)!.add(b);
      graph.get(b)!.add(a);
    }
  }

  const edgeZones = new Set<number>();
  for (const b of regions.borders) {
    if (b.kind !== "edge") continue;
    for (const id of [b.a, b.b]) if (id !== null) edgeZones.add(index.get(id)!);
  }
  return { graph, edgeZones };
}

// ---------- 3. Roles and types ----------

interface Roles {
  port: number;
  clubHqs: number[];
  sheriff: number;
  types: ZoneType[];
}

function assignRoles(content: GameData, size: MapSize, points: Point[], graph: Graph, edgeZones: Set<number>, rng: Rng): Roles | null {
  const sz = content.mapgen.sizes[size];
  const n = points.length;
  const dist = points.map((_, i) => distancesFrom(graph, i));
  const center = points.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n }), { x: 0, y: 0 });

  // Port: on the county's edge, the farthest from the middle (it looks out to sea).
  const edge = [...edgeZones];
  if (edge.length === 0) return null;
  const port = edge.sort((a, b) => Math.hypot(points[b]!.x - center.x, points[b]!.y - center.y) - Math.hypot(points[a]!.x - center.x, points[a]!.y - center.y) || a - b)[0]!;

  // Club HQs: spread out (farthest-point), never next to the port or to each other.
  const candidates = points.map((_, i) => i).filter((i) => i !== port && !graph.get(port)!.has(i));
  const clubHqs: number[] = [shuffle(rng, candidates)[0]!];
  while (clubHqs.length < sz.clubs) {
    const options = candidates.filter((i) => !clubHqs.includes(i) && clubHqs.every((h) => (dist[h]!.get(i) ?? 0) >= 2));
    if (options.length === 0) return null;
    const score = (i: number) => Math.min(...clubHqs.map((h) => dist[h]!.get(i) ?? 0));
    const best = Math.max(...options.map(score));
    const tied = options.filter((i) => score(i) === best);
    clubHqs.push(tied[rng.int(0, tied.length - 1)]!);
  }

  // Sheriff: the most central district left, preferring one not next to a club.
  const left = points.map((_, i) => i).filter((i) => i !== port && !clubHqs.includes(i));
  const eccentricity = (i: number) => Math.max(...dist[i]!.values());
  const nextToClub = (i: number) => clubHqs.some((h) => graph.get(h)!.has(i));
  const sheriff = [...left].sort((a, b) => Number(nextToClub(a)) - Number(nextToClub(b)) || eccentricity(a) - eccentricity(b) || a - b)[0];
  if (sheriff === undefined) return null;

  const types: ZoneType[] = new Array<ZoneType>(n).fill("industrial");
  types[port] = "port";
  for (const i of [...clubHqs, sheriff]) types[i] = "town";
  let rest = shuffle(
    rng,
    points.map((_, i) => i).filter((i) => i !== port && i !== sheriff && !clubHqs.includes(i)),
  );
  const take = (count: number, order: (a: number, b: number) => number): number[] => {
    const chosen = [...rest].sort(order).slice(0, Math.max(0, count));
    rest = rest.filter((i) => !chosen.includes(i));
    return chosen;
  };
  const degree = (i: number) => graph.get(i)!.size;
  for (const i of take(sz.types.town - clubHqs.length - 1, () => 0)) types[i] = "town";
  for (const i of take(sz.types.road, (a, b) => degree(b) - degree(a))) types[i] = "road";
  for (const i of take(sz.types.rural, (a, b) => Number(edgeZones.has(b)) - Number(edgeZones.has(a)) || degree(a) - degree(b))) types[i] = "rural";
  for (const i of rest) types[i] = "industrial";
  return { port, clubHqs, sheriff, types };
}

// ---------- 4–5. Zones, factions and members ----------

function makeRivals(content: GameData, opts: GenerateOptions, count: number, rng: Rng): FactionDef[] {
  const cfg = content.mapgen.rivals;
  const player = content.factions.find((f) => f.id === opts.playerFactionId)!;
  const names = shuffle(rng, cfg.names.filter((n) => n !== player.name));
  const colors = shuffle(rng, cfg.colors);
  const patches = shuffle(
    rng,
    content.patches.patches.map((p) => p.id).filter((id) => id !== opts.playerPatchId && id !== player.patchId),
  );
  return Array.from({ length: count }, (_, i) => {
    const name = names[i % names.length]!;
    return {
      id: `faction_rival_${i + 1}`,
      name,
      kind: "club",
      glyph: name.replace(/[^A-Z]/g, "").charAt(0) || "R",
      hqZoneId: null,
      startingMoney: { ...player.startingMoney },
      initialRelations: {},
      color: colors[i % colors.length]!,
      patchId: patches[i] ?? null,
      aiProfile: cfg.aiProfiles[rng.int(0, cfg.aiProfiles.length - 1)]!,
    };
  });
}

/**
 * Generated members for a club: for each rank, the stat line of the player's starting member of that rank (the
 * n-th one, cycling), reshuffled, with a new name, nickname and trait. Same ranks → same strength as the player.
 */
function makeRoster(content: GameData, opts: GenerateOptions, faction: FactionDef, ranks: readonly Rank[], firstIndex: number, usedNames: Set<string>, rng: Rng): MemberDef[] {
  const template = content.members.filter((m) => m.factionId === opts.playerFactionId);
  const byRank = (rank: string, nth: number) => {
    const same = template.filter((m) => m.rank === rank);
    return same.length > 0 ? same[nth % same.length]! : template[0]!;
  };
  const seenRank = new Map<string, number>();
  const pick = (pool: readonly string[]) => pool[rng.int(0, pool.length - 1)]!;
  return ranks.map((rank, k) => {
    const i = firstIndex + k;
    const nth = seenRank.get(rank) ?? 0;
    seenRank.set(rank, nth + 1);
    const base = byRank(rank, nth);
    const values = shuffle(rng, [base.stats.strength, base.stats.cunning, base.stats.hands, base.stats.charm]);
    let name = `${pick(content.names.first)} ${pick(content.names.last)}`;
    for (let tries = 0; usedNames.has(name) && tries < 20; tries++) name = `${pick(content.names.first)} ${pick(content.names.last)}`;
    usedNames.add(name);
    const freeNicks = content.names.nicknames.filter((nk) => !usedNames.has(`nick:${nk}`));
    const nickname = freeNicks.length > 0 ? pick(freeNicks) : pick(content.names.nicknames);
    usedNames.add(`nick:${nickname}`);
    return {
      id: `member_${faction.id.replace(/^faction_/, "")}_${i + 1}`,
      name,
      nickname,
      factionId: faction.id,
      rank,
      trait: TRAITS[rng.int(0, TRAITS.length - 1)]!,
      stats: { strength: values[0]!, cunning: values[1]!, hands: values[2]!, charm: values[3]! },
      loyalty: base.loyalty,
      glyph: base.glyph,
    };
  });
}

export function generateScenario(content: GameData, opts: GenerateOptions): { scenario: Scenario; members: MemberDef[] } {
  const cfg = content.mapgen;
  const sz = cfg.sizes[opts.size];
  const rng = createRng((opts.seed ^ MAP_SEED_SALT) >>> 0);

  let points: Point[] | null = null;
  let built: ReturnType<typeof buildGraph> = null;
  let roles: Roles | null = null;
  for (let attempt = 0; attempt < cfg.layout.layoutsPerDistance && !roles; attempt++) {
    points = placeCenters(content, opts.size, rng);
    built = points ? buildGraph(content, points, rng) : null;
    roles = points && built ? assignRoles(content, opts.size, points, built.graph, built.edgeZones, rng) : null;
  }
  if (!points || !built || !roles) throw new Error(`No se pudo generar un condado ${opts.size} con la semilla ${opts.seed}`);

  // Names per type, without repeats.
  const pools = Object.fromEntries(Object.entries(cfg.places).map(([type, list]) => [type, shuffle(rng, list)])) as Record<ZoneType, { name: string; short: string }[]>;
  const usedIds = new Set<string>();
  const zoneIds: string[] = [];
  const places = roles.types.map((type, i) => {
    const place = pools[type].shift() ?? { name: `${type} ${i + 1}`, short: `${type.slice(0, 6)} ${i + 1}` };
    let id = `zone_${slug(place.name)}`;
    for (let k = 2; usedIds.has(id); k++) id = `zone_${slug(place.name)}_${k}`;
    usedIds.add(id);
    zoneIds.push(id);
    return place;
  });

  // Factions: the player's club, generated rivals, the cartel in the port, the sheriff in the central town.
  const rivals = makeRivals(content, opts, sz.clubs - 1, rng);
  const clubIds = [opts.playerFactionId, ...rivals.map((r) => r.id)];
  const hqOf = new Map(clubIds.map((id, i) => [id, roles!.clubHqs[i]!]));
  const factions: FactionDef[] = [];
  for (const f of content.factions) {
    if (f.id === opts.playerFactionId) factions.push({ ...f, hqZoneId: zoneIds[hqOf.get(f.id)!]! });
    else if (f.kind === "cartel") factions.push({ ...f, hqZoneId: zoneIds[roles.port]! });
    else if (f.kind === "sheriff") factions.push({ ...f, hqZoneId: zoneIds[roles.sheriff]!, name: cfg.sheriffName.replace("{town}", places[roles.sheriff]!.name) });
    else if (f.kind !== "club") factions.push({ ...f });
  }
  factions.splice(1, 0, ...rivals.map((r) => ({ ...r, hqZoneId: zoneIds[hqOf.get(r.id)!]! })));

  // Starting influence: each club's HQ and the districts around it (shared ones are contested).
  const control: Record<string, number>[] = points.map(() => ({}));
  for (const [clubId, hq] of hqOf) control[hq]![clubId] = cfg.control.hq;
  for (let i = 0; i < points.length; i++) {
    if (i === roles.port || [...hqOf.values()].includes(i)) continue;
    const near = clubIds.filter((id) => built!.graph.get(hqOf.get(id)!)!.has(i));
    const amount = near.length === 1 ? cfg.control.neighbors[roles.types[i]!] : cfg.control.contested;
    for (const id of near) if (amount > 0) control[i]![id] = amount;
  }
  const cartel = content.factions.find((f) => f.kind === "cartel");
  if (cartel) control[roles.port]![cartel.id] = cfg.control.cartelPort;

  const zones: ZoneDef[] = points.map((p, i) => {
    const type = roles!.types[i]!;
    const t = cfg.zoneTypes[type];
    const degree = built!.graph.get(i)!.size;
    const crossroads = type === "road" && degree >= cfg.crossroads.minDegree;
    const sheriffTown = i === roles!.sheriff;
    const glyph = t.glyphs.length > 0 ? t.glyphs[rng.int(0, t.glyphs.length - 1)]! : places[i]!.name.charAt(0).toUpperCase();
    return {
      id: zoneIds[i]!,
      name: places[i]!.name,
      shortName: places[i]!.short,
      position: { x: p.x, y: p.y },
      type,
      glyph: crossroads ? cfg.crossroads.glyph : glyph,
      adjacent: [...built!.graph.get(i)!].sort((a, b) => a - b).map((j) => zoneIds[j]!),
      wealth: sheriffTown ? cfg.sheriffTown.wealth : crossroads ? cfg.crossroads.wealth : rng.int(t.wealth[0], t.wealth[1]),
      policePresence: sheriffTown ? cfg.sheriffTown.policePresence : t.policePresence,
      businessSlots: t.businessSlots,
      initialHeat: 0,
      initialControl: control[i]!,
      localSeed: rng.int(1, LOCAL_SEED_MAX),
    };
  });

  // Members: the player's starting club and the cartel from /data, rivals generated.
  const usedNames = new Set(content.members.flatMap((m) => [m.name, `nick:${m.nickname}`]));
  const playerStart = content.members.filter((m) => m.factionId === opts.playerFactionId);
  const player = factions.find((f) => f.id === opts.playerFactionId)!;
  const members: MemberDef[] = [
    ...content.members.filter((m) => m.factionId === opts.playerFactionId || factions.some((f) => f.id === m.factionId && f.kind !== "club")),
    // Bigger maps: every club starts with the same extra members.
    ...makeRoster(content, opts, player, sz.extraMembers, playerStart.length, usedNames, rng).map((m) => ({ ...m, id: `member_extra_${m.id.replace(/^member_/, "")}` })),
    ...rivals.flatMap((r) => makeRoster(content, opts, r, [...cfg.rivals.roster, ...sz.extraMembers], 0, usedNames, rng)),
  ];

  const { numerator, denominator } = content.balance.victory.territoryShare;
  return {
    scenario: {
      size: opts.size,
      zones,
      factions,
      portZoneId: zoneIds[roles.port]!,
      zonesToControl: Math.ceil((zones.length * numerator) / denominator),
      memberCap: sz.memberCap,
    },
    members,
  };
}

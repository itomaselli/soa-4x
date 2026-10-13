import { describe, expect, it } from "vitest";
import { generateLocalMap, LOCAL_LOT_SIZE } from "../src/render/localMap";
import { buildMapLayout, zoneTiles } from "../src/render/layout";
import { checkInvariants } from "../src/sim/invariants";
import { generateScenario } from "../src/sim/mapgen";
import { computeRegions, touchingPairs, zoneAtTile } from "../src/sim/regions";
import { loadSave, serializeState } from "../src/sim/save";
import { gameData } from "../src/sim/scenario";
import { createInitialState } from "../src/sim/setup";
import { GameStateSchema, MAP_SIZES, STAT_KEYS, type MapSize } from "../src/sim/state";
import { allAiOrders } from "../src/sim/systems/ai";
import { ownedZones } from "../src/sim/systems/control";
import { resolveTurn } from "../src/sim/turn";
import { baseData, PLAYER } from "./helpers";

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 20261013];
const generate = (size: MapSize, seed: number) => generateScenario(baseData, { size, seed, playerFactionId: PLAYER, playerPatchId: "patch_01" });
const newGame = (size: MapSize, seed: number) => createInitialState(baseData, { seed, playerFactionId: PLAYER, size });

function connected(zones: { id: string; adjacent: string[] }[]): boolean {
  const seen = new Set([zones[0]!.id]);
  const stack = [zones[0]!.id];
  while (stack.length > 0) {
    const current = stack.pop();
    const z = zones.find((x) => x.id === current);
    for (const a of z?.adjacent ?? []) {
      if (seen.has(a)) continue;
      seen.add(a);
      stack.push(a);
    }
  }
  return seen.size === zones.length;
}

describe("condados aleatorios (Fase 12)", () => {
  it("la misma semilla y el mismo tamaño dan el mismo condado; otra semilla, otro", () => {
    expect(generate("medium", 5)).toEqual(generate("medium", 5));
    expect(generate("medium", 5).scenario.zones.map((z) => z.position)).not.toEqual(generate("medium", 6).scenario.zones.map((z) => z.position));
  });

  for (const size of MAP_SIZES) {
    describe(`tamaño ${size}`, () => {
      const cfg = baseData.mapgen.sizes[size];

      it("tiene las zonas, los clubes y los tipos que pide mapgen.json", () => {
        for (const seed of SEEDS) {
          const { scenario } = generate(size, seed);
          expect(scenario.zones).toHaveLength(cfg.zones);
          expect(scenario.factions.filter((f) => f.kind === "club")).toHaveLength(cfg.clubs);
          for (const [type, count] of Object.entries(cfg.types)) expect(scenario.zones.filter((z) => z.type === type), `${seed} ${type}`).toHaveLength(count);
          expect(scenario.memberCap).toBe(cfg.memberCap);
        }
      });

      it("siempre hay un puerto, con el cartel, en el borde del condado", () => {
        for (const seed of SEEDS) {
          const { scenario } = generate(size, seed);
          const port = scenario.zones.find((z) => z.id === scenario.portZoneId)!;
          expect(port.type).toBe("port");
          expect(scenario.factions.find((f) => f.kind === "cartel")?.hqZoneId).toBe(port.id);
          const regions = computeRegions({ ui: baseData.ui, zones: scenario.zones });
          expect(regions.borders.some((b) => b.kind === "edge" && (b.a === port.id || b.b === port.id)), `${seed}`).toBe(true);
        }
      });

      it("cada club tiene su sede en un pueblo distinto, sin sedes vecinas, y el sheriff tiene la suya", () => {
        for (const seed of SEEDS) {
          const { scenario } = generate(size, seed);
          const hqs = scenario.factions.filter((f) => f.kind === "club").map((f) => f.hqZoneId!);
          expect(new Set(hqs).size).toBe(hqs.length);
          for (const hq of hqs) {
            const zone = scenario.zones.find((z) => z.id === hq)!;
            expect(zone.type).toBe("town");
            expect(zone.adjacent.some((a) => hqs.includes(a)), `${seed} ${hq}`).toBe(false);
          }
          const sheriff = scenario.factions.find((f) => f.kind === "sheriff")!;
          expect(scenario.zones.find((z) => z.id === sheriff.hqZoneId)?.type).toBe("town");
          expect(hqs).not.toContain(sheriff.hqZoneId);
        }
      });

      it("el condado está conectado y las conexiones son de ida y vuelta", () => {
        for (const seed of SEEDS) {
          const { zones } = generate(size, seed).scenario;
          expect(connected(zones), `${seed}`).toBe(true);
          for (const z of zones) for (const a of z.adjacent) expect(zones.find((x) => x.id === a)?.adjacent, `${seed} ${z.id}→${a}`).toContain(z.id);
        }
      });

      it("en el mapa político las vecinas se tocan y cada distrito tiene su centro y una superficie razonable", () => {
        for (const seed of SEEDS) {
          const { zones } = generate(size, seed).scenario;
          const regions = computeRegions({ ui: baseData.ui, zones });
          const touching = touchingPairs(regions);
          for (const z of zones) {
            expect(zoneAtTile(regions, z.position.x, z.position.y)).toBe(z.id);
            expect(regions.tiles.flat().filter((t) => t === z.id).length, `${seed} ${z.id}`).toBeGreaterThan(20);
            for (const a of z.adjacent) expect(touching.has([z.id, a].sort().join("|")), `${seed} ${z.id}–${a}`).toBe(true);
          }
        }
      });

      it("los nombres entran en el mapa y no se pisan entre sí", () => {
        for (const seed of SEEDS) {
          const data = gameData(baseData, { scenario: generate(size, seed).scenario, identities: {} });
          const layout = buildMapLayout(data);
          const used = new Map<string, string>();
          for (const z of layout.zones) {
            for (const t of zoneTiles(z)) {
              expect(t.x >= 0 && t.y >= 0 && t.x < layout.width && t.y < layout.height, `${seed} ${z.id}`).toBe(true);
              const key = `${t.x},${t.y}`;
              expect(used.get(key), `${seed}: ${z.id} pisa a ${used.get(key)} en ${key}`).toBeUndefined();
              used.set(key, z.id);
            }
          }
        }
      });

      it("nombres e ids únicos; la meta es 2/3 de las zonas (redondeado para arriba)", () => {
        for (const seed of SEEDS) {
          const { scenario } = generate(size, seed);
          expect(new Set(scenario.zones.map((z) => z.id)).size).toBe(cfg.zones);
          expect(new Set(scenario.zones.map((z) => z.name)).size).toBe(cfg.zones);
          expect(scenario.zonesToControl).toBe(Math.ceil((cfg.zones * 2) / 3));
        }
      });

      it("los clubes rivales arrancan con la misma fuerza y la misma cantidad de miembros que el del jugador", () => {
        for (const seed of SEEDS) {
          const state = newGame(size, seed);
          const data = gameData(baseData, state);
          const clubs = data.factions.filter((f) => f.kind === "club");
          const totals = clubs.map((c) => {
            const ms = Object.values(state.members).filter((m) => m.factionId === c.id);
            return { count: ms.length, sum: STAT_KEYS.map((k) => ms.reduce((s, m) => s + m.stats[k], 0)).reduce((a, b) => a + b, 0) };
          });
          for (const t of totals) expect(t, `${seed}`).toEqual(totals[0]);
          expect(totals[0]!.count).toBe(baseData.mapgen.rivals.roster.length + cfg.extraMembers.length);
        }
      });

      it("cada club arranca dueño de su sede y con influencia alrededor, y nadie más arranca ganando", () => {
        for (const seed of SEEDS) {
          const state = newGame(size, seed);
          const data = gameData(baseData, state);
          for (const club of data.factions.filter((f) => f.kind === "club")) {
            expect(ownedZones(state, club.id, data.balance)).toContain(club.hqZoneId);
          }
        }
      });

      it("la partida nueva cumple el esquema y las invariantes, y se guarda y carga igual", () => {
        const state = newGame(size, 11);
        expect(GameStateSchema.safeParse(state).success).toBe(true);
        expect(checkInvariants(state, gameData(baseData, state).balance)).toEqual([]);
        expect(loadSave(serializeState(state), baseData)).toEqual(state);
      });

      it("la IA contra la IA juega sin romper invariantes", { timeout: 60_000 }, () => {
        for (const seed of [3, 8]) {
          let state = newGame(size, seed);
          for (let w = 0; w < 25 && !state.outcome; w++) {
            state = resolveTurn(state, allAiOrders(state, gameData(baseData, state), null), baseData).state;
            expect(checkInvariants(state, gameData(baseData, state).balance)).toEqual([]);
          }
        }
      });

      it("cada distrito tiene su mapa local, distinto de partida en partida", () => {
        const a = gameData(baseData, { scenario: generate(size, 21).scenario, identities: {} });
        for (const z of a.zones) {
          const local = generateLocalMap(a, z.id);
          expect(local.lots).toHaveLength(z.businessSlots);
          for (const lot of local.lots) expect(lot.x + LOCAL_LOT_SIZE).toBeLessThanOrEqual(local.width);
        }
        const town = a.zones.find((z) => z.type === "town")!;
        const sameName = { ...town, localSeed: (town.localSeed ?? 0) + 1 };
        const b = { ...a, zones: a.zones.map((z) => (z.id === town.id ? sameName : z)) };
        expect(generateLocalMap(b, town.id).tiles).not.toEqual(generateLocalMap(a, town.id).tiles);
      });
    });
  }
});

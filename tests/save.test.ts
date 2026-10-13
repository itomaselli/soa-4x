import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/data/load";
import { checkInvariants } from "../src/sim/invariants";
import { loadSave, migrateSave, migrateV1toV2, serializeState, type RawSave, type SaveMigration } from "../src/sim/save";
import { classicScenario } from "../src/sim/scenario";
import { createInitialState } from "../src/sim/setup";
import { SAVE_SCHEMA_VERSION } from "../src/sim/state";
import { allAiOrders } from "../src/sim/systems/ai";
import { resolveTurn } from "../src/sim/turn";

const data = loadGameData();
const PLAYER = "faction_iron_saints";
const fixture = (name: string): RawSave => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as RawSave;

/** A v0.1.0 save with two businesses in the same zone and one elsewhere, as they were stored then (no lot). */
function v010WithBusinesses(): RawSave {
  const save = fixture("save-v0.1.0.json");
  const base = { ownerFactionId: PLAYER, raidWarned: false, builtWeek: 3, suspended: false, workCapacity: 0 };
  save.businesses = [
    { ...base, id: "business_1", typeId: "business_club_bar", zoneId: "zone_redwater" },
    { ...base, id: "business_2", typeId: "business_chop_shop", zoneId: "zone_redwater" },
    { ...base, id: "business_3", typeId: "business_club_bar", zoneId: "zone_millbrook" },
  ];
  save.businessSerial = 3;
  return save;
}

describe("migraciones de partidas guardadas", () => {
  it("las partidas nuevas se guardan con la versión actual del formato", () => {
    expect(createInitialState(data, { seed: 1, playerFactionId: PLAYER }).schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it("una partida de la v0.1.0 (formato 1) se convierte a la versión actual en lugar de rechazarse", () => {
    const state = loadSave(JSON.stringify(fixture("save-v0.1.0.json")), data);
    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(checkInvariants(state, data.balance)).toEqual([]);
  });

  it("una partida de la v0.2.0 (formato 1, con todos los campos) carga sin perder datos", () => {
    const raw = fixture("save-v0.2.0.json");
    const { scenario, ...state } = loadSave(JSON.stringify(raw), data);
    // Phase 13 fields start empty; everything else is exactly what was saved.
    const members = Object.fromEntries(Object.entries(state.members).map(([id, m]) => {
      const { xp, perks, scars, perkOptions, ...rest } = m;
      expect({ xp, perks, scars, perkOptions }).toEqual({ xp: 0, perks: [], scars: [], perkOptions: [] });
      return [id, rest];
    }));
    expect({ ...state, members, schemaVersion: 1 }).toEqual(raw);
    expect(scenario).toEqual(classicScenario(data));
  });

  it("los negocios viejos reciben el primer lote libre de su zona", () => {
    const state = loadSave(JSON.stringify(v010WithBusinesses()), data);
    expect(state.businesses.map((b) => [b.id, b.lot])).toEqual([
      ["business_1", 0],
      ["business_2", 1],
      ["business_3", 0],
    ]);
  });

  it("no pisa un lote que ya estaba ocupado", () => {
    const save = v010WithBusinesses();
    const businesses = save.businesses as Record<string, unknown>[];
    businesses[1] = { ...businesses[1], lot: 0 };
    const migrated = migrateV1toV2(save, data);
    expect((migrated.businesses as { lot: number }[]).map((b) => b.lot)).toEqual([1, 0, 0]);
  });

  it("cada club recibe su nombre y parche por defecto", () => {
    const state = loadSave(JSON.stringify(fixture("save-v0.1.0.json")), data);
    for (const f of data.factions) expect(state.identities[f.id]).toEqual({ name: f.name, patchId: f.patchId });
  });

  it("los enfriamientos de eventos pasan a ser por club (antes solo le pasaban al jugador)", () => {
    const old = fixture("save-v0.1.0.json").eventHistory as Record<string, number>;
    const state = loadSave(JSON.stringify(fixture("save-v0.1.0.json")), data);
    for (const [eventId, week] of Object.entries(old)) expect(state.eventHistory[`${eventId}__${PLAYER}`]).toBe(week);
    expect(Object.keys(state.eventHistory)).toHaveLength(Object.keys(old).length);
  });

  it("una partida migrada se puede seguir jugando", () => {
    let state = loadSave(JSON.stringify(v010WithBusinesses()), data);
    for (let i = 0; i < 5 && !state.outcome; i++) {
      state = resolveTurn(state, allAiOrders(state, data, state.playerFactionId), data).state;
      expect(checkInvariants(state, data.balance)).toEqual([]);
    }
    expect(loadSave(serializeState(state), data)).toEqual(state);
  });

  it("aplica las migraciones en orden, una versión por vez", () => {
    const calls: number[] = [];
    const step = (n: number): SaveMigration => (save) => {
      calls.push(n);
      return { ...save, trail: [...((save.trail as number[] | undefined) ?? []), n] };
    };
    const result = migrateSave({ schemaVersion: 1 }, data, { 1: step(1), 2: step(2), 3: step(3) }, 4);
    expect(calls).toEqual([1, 2, 3]);
    expect(result).toEqual({ schemaVersion: 4, trail: [1, 2, 3] });
  });

  it("una partida ya en la versión actual no pasa por ninguna migración", () => {
    const result = migrateSave({ schemaVersion: 3, x: 1 }, data, { 1: () => { throw new Error("no"); } }, 3);
    expect(result).toEqual({ schemaVersion: 3, x: 1 });
  });

  it("rechaza con un mensaje claro si falta un paso de migración", () => {
    expect(() => migrateSave({ schemaVersion: 1 }, data, { 2: (s) => s }, 3)).toThrow(/falta la migración del formato 1 al 2/);
  });

  it("rechaza partidas de una versión más nueva del juego", () => {
    const future = { ...createInitialState(data, { seed: 1, playerFactionId: PLAYER }), schemaVersion: SAVE_SCHEMA_VERSION + 1 };
    expect(() => loadSave(JSON.stringify(future), data)).toThrow(/versión más nueva/);
  });

  it("rechaza partidas sin versión", () => {
    const noVersion: RawSave = { ...createInitialState(data, { seed: 1, playerFactionId: PLAYER }) };
    delete noVersion.schemaVersion;
    expect(() => loadSave(JSON.stringify(noVersion), data)).toThrow(/schemaVersion/);
  });
});

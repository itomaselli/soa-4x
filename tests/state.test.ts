import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/data/load";
import { checkInvariants } from "../src/sim/invariants";
import { createRng } from "../src/sim/rng";
import { deserializeState, loadSave, saveDataProblems, serializeState } from "../src/sim/save";
import { createInitialState } from "../src/sim/setup";
import { GameStateSchema } from "../src/sim/state";

const data = loadGameData();
const PLAYER = "faction_iron_saints";
const newGame = (seed = 42) => createInitialState(data, { seed, playerFactionId: PLAYER });

describe("estado inicial de la partida", () => {
  it("empieza en la semana 1 con todas las zonas, facciones y miembros de /data", () => {
    const state = newGame();
    expect(state.week).toBe(1);
    expect(Object.keys(state.zones)).toHaveLength(data.zones.length);
    expect(Object.keys(state.factions)).toHaveLength(data.factions.length);
    expect(Object.keys(state.members)).toHaveLength(data.members.length);
    expect(state.playerFactionId).toBe(PLAYER);
  });

  it("todos los miembros empiezan activos", () => {
    for (const member of Object.values(newGame().members)) {
      expect(member.status).toBe("active");
      expect(member.statusWeeks).toBe(0);
    }
  });

  it("cumple el esquema de GameState y todas las invariantes", () => {
    const state = newGame();
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(checkInvariants(state, data.balance)).toEqual([]);
  });

  it("es determinista: misma semilla, mismo estado", () => {
    expect(newGame(7)).toEqual(newGame(7));
  });

  it("no comparte objetos con los datos cargados (modificar el estado no toca /data)", () => {
    const state = newGame();
    const member = Object.values(state.members)[0];
    if (!member) throw new Error("expected members");
    member.stats.strength = 99;
    expect(data.members[0]?.stats.strength).not.toBe(99);
  });

  it("rechaza una facción de jugador inexistente", () => {
    expect(() => createInitialState(data, { seed: 1, playerFactionId: "faction_nobody" })).toThrow();
  });
});

describe("invariantes", () => {
  it("detecta dinero NaN", () => {
    const state = newGame();
    const player = state.factions[PLAYER];
    if (!player) throw new Error("expected player faction");
    player.money.clean = Number.NaN;
    expect(checkInvariants(state, data.balance)).toContainEqual(expect.stringContaining("plata clean"));
  });

  it("detecta control de zona por encima de 100", () => {
    const state = newGame();
    const zone = state.zones["zone_redwater"];
    if (!zone) throw new Error("expected zone");
    zone.control[PLAYER] = 101;
    expect(checkInvariants(state, data.balance)).toContainEqual(expect.stringContaining("fuera de [0, 100]"));
  });
});

describe("guardar y cargar", () => {
  it("guardar y cargar devuelve exactamente el mismo estado", () => {
    const state = newGame();
    expect(deserializeState(serializeState(state))).toEqual(state);
  });

  it("después de cargar, el RNG sigue la misma secuencia que sin guardar", () => {
    const state = newGame(1234);
    const loaded = deserializeState(serializeState(state));
    const a = createRng(state.rngState);
    const b = createRng(loaded.rngState);
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(Array.from({ length: 20 }, () => a.next()));
  });

  it("rechaza un archivo que no es JSON", () => {
    expect(() => deserializeState("esto no es json")).toThrow(/ilegible/);
  });

  it("rechaza una partida con campos faltantes o inválidos", () => {
    const broken = JSON.parse(serializeState(newGame())) as Record<string, unknown>;
    delete broken.week;
    expect(() => deserializeState(JSON.stringify(broken))).toThrow(/week/);
  });

  it("rechaza partidas de otra versión del formato", () => {
    const other = { ...newGame(), schemaVersion: 999 };
    expect(() => deserializeState(JSON.stringify(other))).toThrow(/schemaVersion/);
  });
});

describe("guardar y cargar contra los datos del juego", () => {
  it("una partida guardada con los datos actuales se carga sin problemas", () => {
    expect(loadSave(serializeState(newGame()), data)).toEqual(newGame());
  });

  it("si cambiaron los datos (por ejemplo, se borró una zona), la carga lo explica en lugar de romperse después", () => {
    const state = newGame();
    const fewerZones = { ...data, zones: data.zones.filter((z) => z.id !== "zone_lone_pine") };
    expect(saveDataProblems(state, fewerZones)).toContainEqual("zona desconocida: zone_lone_pine");
    expect(() => loadSave(serializeState(state), fewerZones)).toThrow(/no coincide con los datos/);
  });

  it("detecta negocios de un tipo que ya no existe", () => {
    const state = newGame();
    state.businesses.push({ id: "biz_1", typeId: "business_casino", zoneId: "zone_redwater", ownerFactionId: PLAYER, lot: 0, raidWarned: false, builtWeek: 1, suspended: false, workCapacity: 0 });
    expect(saveDataProblems(state, data)).toContainEqual("biz_1: tipo de negocio desconocido business_casino");
  });
});

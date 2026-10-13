import { describe, expect, it } from "vitest";
import { validateAssignment } from "../src/sim/orders";
import { randomOrders } from "../src/sim/policies/random";
import { createRng } from "../src/sim/rng";
import type { GameState } from "../src/sim/state";
import { aiOrders, allAiOrders } from "../src/sim/systems/ai";
import { ownedZones, strongestRival } from "../src/sim/systems/control";
import { activeMembers } from "../src/sim/systems/members";
import { resolveTurn } from "../src/sim/turn";
import { baseData, money, newState, PLAYER, WOLVES, zone } from "./helpers";

/** States from a few weeks of AI-vs-random play, to test the AI in varied situations. */
function sampleStates(seeds: number, weeks: number): GameState[] {
  const states: GameState[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    let state = newState(seed);
    const policy = createRng(seed);
    for (let w = 0; w < weeks && !state.outcome; w++) {
      states.push(state);
      const orders = [...randomOrders(state, baseData, PLAYER, policy).assignments, ...aiOrders(state, baseData, WOLVES).assignments];
      state = resolveTurn(state, { assignments: orders }, baseData).state;
    }
  }
  return states;
}

const samples = sampleStates(6, 30);

describe("IA: juega con las mismas reglas que el jugador (GDD §12)", () => {
  it("todas sus órdenes pasan la misma validación que las del jugador", () => {
    for (const state of samples) {
      const assigned = new Set<string>();
      for (const a of aiOrders(state, baseData, WOLVES).assignments) {
        expect(validateAssignment(state, baseData, a, assigned), `semana ${state.week} ${JSON.stringify(a)}`).toBeNull();
        assigned.add(a.memberId);
      }
    }
  });

  it("le da una tarea a cada miembro activo", () => {
    for (const state of samples) {
      expect(aiOrders(state, baseData, WOLVES).assignments).toHaveLength(activeMembers(state, WOLVES).length);
    }
  });

  it("solo da órdenes a sus propios miembros", () => {
    for (const a of aiOrders(newState(), baseData, WOLVES).assignments) {
      expect(a.memberId.startsWith("member_wolves_")).toBe(true);
    }
  });

  it("es determinista y no modifica el estado", () => {
    const state = samples[10]!;
    const copy = structuredClone(state);
    expect(aiOrders(state, baseData, WOLVES)).toEqual(aiOrders(state, baseData, WOLVES));
    expect(state).toEqual(copy);
  });

  it("una facción sin perfil de IA (el cartel, por ahora) no da órdenes", () => {
    expect(aiOrders(newState(), baseData, "faction_cartel_valdes").assignments).toEqual([]);
  });

  it("allAiOrders deja afuera al jugador humano", () => {
    const orders = allAiOrders(newState(), baseData, PLAYER).assignments;
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((a) => a.memberId.startsWith("member_wolves_"))).toBe(true);
  });
});

describe("IA: decisiones razonables", () => {
  it("no manda a cobrar dos veces a la misma zona", () => {
    for (const state of samples) {
      const zones = aiOrders(state, baseData, WOLVES).assignments.filter((a) => a.taskId === "task_collect_protection").map((a) => a.zoneId);
      expect(new Set(zones).size).toBe(zones.length);
    }
  });

  it("en la primera semana cobra protección en su sede", () => {
    const orders = aiOrders(newState(), baseData, WOLVES).assignments;
    expect(orders).toContainEqual(expect.objectContaining({ taskId: "task_collect_protection", zoneId: "zone_millbrook" }));
  });

  it("sin plata sucia no soborna", () => {
    for (const base of samples.slice(0, 40)) {
      const state = structuredClone(base);
      money(state, WOLVES).dirty = 0;
      for (const z of Object.values(state.zones)) z.heat = 90;
      expect(aiOrders(state, baseData, WOLVES).assignments.some((a) => a.taskId === "task_bribe")).toBe(false);
    }
  });

  it("con poca plata no recluta", () => {
    const state = newState();
    money(state, WOLVES).dirty = 0;
    money(state, WOLVES).clean = 0;
    expect(aiOrders(state, baseData, WOLVES).assignments.some((a) => a.taskId === "task_recruit")).toBe(false);
  });

  it("defiende su sede si un rival se mete", () => {
    const state = newState();
    zone(state, "zone_millbrook").control = { [WOLVES]: 60, [PLAYER]: 40 };
    const orders = aiOrders(state, baseData, WOLVES).assignments;
    expect(orders).toContainEqual(expect.objectContaining({ taskId: "task_intimidate", zoneId: "zone_millbrook" }));
  });

  it("responde a las agresiones: con relación hostil, intimida más donde está el agresor", () => {
    const hitsOnPlayer = (hostile: boolean) => {
      let hits = 0;
      for (let seed = 1; seed <= 15; seed++) {
        const state = newState(seed);
        if (hostile) state.factions[WOLVES]!.relations[PLAYER] = -50;
        for (const a of aiOrders(state, baseData, WOLVES).assignments) {
          if (a.taskId === "task_intimidate" && strongestRival(zone(state, a.zoneId), WOLVES) === PLAYER) hits++;
        }
      }
      return hits;
    };
    expect(hitsOnPlayer(true)).toBeGreaterThan(hitsOnPlayer(false));
  });

  it("contra un jugador que no hace nada, los Grim Wolves se expanden", () => {
    let state = newState(3);
    for (let w = 0; w < 30 && !state.outcome; w++) {
      state = resolveTurn(state, allAiOrders(state, baseData, PLAYER), baseData).state;
    }
    expect(ownedZones(state, WOLVES, baseData.balance).length).toBeGreaterThan(1);
  });
});

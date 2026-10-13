import { describe, expect, it } from "vitest";
import { checkInvariants } from "../src/sim/invariants";
import { randomOrders } from "../src/sim/policies/random";
import type { ReportEntry } from "../src/sim/report";
import { createRng } from "../src/sim/rng";
import { deserializeState, serializeState } from "../src/sim/save";
import { allAiOrders } from "../src/sim/systems/ai";
import { resolveTurn } from "../src/sim/turn";
import { baseData, newState, PLAYER } from "./helpers";

const SEEDS = 12;
const WEEKS = 80;

function playRandom(seed: number, weeks: number) {
  let state = newState(seed);
  const policy = createRng(seed + 1000);
  const reports: ReportEntry[] = [];
  const violations: string[] = [];
  for (let i = 0; i < weeks && !state.outcome; i++) {
    const orders = [...randomOrders(state, baseData, PLAYER, policy).assignments, ...allAiOrders(state, baseData, PLAYER).assignments];
    const result = resolveTurn(state, { assignments: orders }, baseData);
    state = result.state;
    reports.push(...result.report);
    violations.push(...checkInvariants(state, baseData.balance).map((v) => `semilla ${seed}, semana ${state.week}: ${v}`));
  }
  return { state, reports, violations };
}

describe("propiedades: partidas al azar contra la IA", () => {
  it(`en ${SEEDS} partidas de ${WEEKS} semanas con órdenes al azar nunca se rompen las invariantes (plata no NaN, control ≤ 100, etc.)`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      expect(playRandom(seed, WEEKS).violations).toEqual([]);
    }
  });

  it("la plata nunca queda negativa", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state } = playRandom(seed, WEEKS);
      for (const f of Object.values(state.factions)) {
        expect(f.money.clean).toBeGreaterThanOrEqual(0);
        expect(f.money.dirty).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("la suma de control de una zona nunca supera 100", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playRandom(seed, WEEKS);
      for (const z of Object.values(state.zones)) {
        expect(Object.values(z.control).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(baseData.balance.ranges.control.max);
      }
    }
  });

  it("todas las entradas del informe tienen su texto en español", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const e of playRandom(seed, WEEKS).reports) {
        seen.add(e.key);
        for (const [name, value] of Object.entries(e.params)) {
          if (name.endsWith("Key") && typeof value === "string") seen.add(value);
        }
      }
    }
    const missing = [...seen].filter((k) => !(k in baseData.strings));
    expect(missing).toEqual([]);
  });

  it("toda la partida es reproducible: misma semilla, mismo final", () => {
    expect(playRandom(7, 50).state).toEqual(playRandom(7, 50).state);
  });

  it("IA contra IA: nunca se rompen las invariantes", () => {
    for (let seed = 1; seed <= 8; seed++) {
      let state = newState(seed);
      for (let w = 0; w < 60 && !state.outcome; w++) {
        state = resolveTurn(state, allAiOrders(state, baseData, null), baseData).state;
        expect(checkInvariants(state, baseData.balance)).toEqual([]);
      }
    }
  });

  it("guardar y cargar a mitad de partida no cambia el final", () => {
    const policyA = createRng(77);
    const policyB = createRng(77);
    let a = newState(3);
    let b = newState(3);
    for (let i = 0; i < 40; i++) {
      a = resolveTurn(a, randomOrders(a, baseData, PLAYER, policyA), baseData).state;
      b = deserializeState(serializeState(b));
      b = resolveTurn(b, randomOrders(b, baseData, PLAYER, policyB), baseData).state;
    }
    expect(b).toEqual(a);
  });
});

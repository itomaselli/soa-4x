import { describe, expect, it } from "vitest";
import { arrestChance } from "../src/sim/systems/law";
import { baseData, dataWith } from "./helpers";

const balance = baseData.balance;
const a = balance.arrest;

describe("chance de arresto (GDD §7, §10)", () => {
  it("sube con el calor, con la policía y baja con la Astucia", () => {
    const base = arrestChance(10, 2, 5, balance);
    expect(arrestChance(20, 2, 5, balance)).toBeGreaterThan(base);
    expect(arrestChance(10, 3, 5, balance)).toBeGreaterThan(base);
    expect(arrestChance(10, 2, 8, balance)).toBeLessThan(base);
  });

  it("sigue la fórmula base + calor·k + policía·k − astucia·k", () => {
    const expected = a.base + 20 * a.perHeat + 3 * a.perPolicePresence - 2 * a.perCunning;
    expect(arrestChance(20, 3, 2, balance)).toBeCloseTo(expected);
  });

  it("con patrullas (calor ≥ 30) suma un extra", () => {
    const below = arrestChance(balance.heat.patrolThreshold - 1, 2, 2, balance);
    const at = arrestChance(balance.heat.patrolThreshold, 2, 2, balance);
    expect(at - below).toBeCloseTo(a.perHeat + a.patrolBonus);
  });

  it("nunca baja del mínimo ni pasa del máximo", () => {
    expect(arrestChance(0, 0, 10, balance)).toBe(a.minChance);
    const harsh = dataWith((d) => {
      d.balance.arrest.perHeat = 1;
    }).balance;
    expect(arrestChance(100, 5, 1, harsh)).toBe(harsh.arrest.maxChance);
  });
});

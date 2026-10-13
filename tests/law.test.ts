import type { GameData } from "../src/data/schemas";
import type { Assignment } from "../src/sim/orders";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, newState, PLAYER, SERGEANT, SHERIFF, WOLVES, zone } from "./helpers";
import { describe, expect, it } from "vitest";
import { arrestChance } from "../src/sim/systems/law";

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

// ---------- Fase 4: operativos, allanamientos, policía, sheriff y federales ----------


const quiet = dataWith((d) => {
  d.balance.arrest.minChance = 0;
  d.balance.arrest.maxChance = 0;
});
const run = (state: GameState, assignments: Assignment[] = [], data: GameData = quiet) => resolveTurn(state, { assignments }, data);
const keysOf = (r: { key: string }[]) => r.map((e) => e.key);

describe("operativos (calor ≥ 85)", () => {
  const sure = dataWith((d) => {
    d.balance.arrest.minChance = 0;
    d.balance.arrest.maxChance = 0;
    d.balance.law.crackdownArrestChance = 1;
  });

  it("los miembros que actuaron en la zona caen presos y el calor baja", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 90;
    const { state: next, report } = run(state, [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_redwater" }], sure);
    expect(member(next, SERGEANT).status).toBe("jailed");
    expect(keysOf(report)).toContain("report.law.crackdown");
    expect(zone(next, "zone_redwater").heat).toBe(90 - balance.law.crackdownHeatDrop - balance.heat.weeklyDecay);
  });

  it("los que actuaron en otra zona no se ven afectados", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 90;
    const next = run(state, [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_dry_creek" }], sure).state;
    expect(member(next, SERGEANT).status).toBe("active");
  });
});

describe("allanamientos (calor ≥ 60)", () => {
  const sureRaid = dataWith((d) => {
    d.balance.law.raidChance = 1;
  });
  function withBusiness(typeId: string): GameState {
    const state = newState();
    zone(state, "zone_redwater").heat = 70;
    state.businesses.push({ id: "biz_1", typeId, zoneId: "zone_redwater", ownerFactionId: PLAYER, raidWarned: false });
    return state;
  }

  it("un negocio ilegal en una zona caliente puede ser clausurado", () => {
    const { state, report } = run(withBusiness("business_chop_shop"), [], sureRaid);
    expect(state.businesses).toHaveLength(0);
    expect(keysOf(report)).toContain("report.law.raid");
  });

  it("los negocios legales no se allanan", () => {
    expect(run(withBusiness("business_garage"), [], sureRaid).state.businesses).toHaveLength(1);
  });

  it("si el sheriff nos quiere, avisa una semana antes", () => {
    const state = withBusiness("business_chop_shop");
    state.factions[SHERIFF]!.relations[PLAYER] = 80;
    const first = run(state, [], sureRaid);
    expect(first.state.businesses).toHaveLength(1);
    expect(keysOf(first.report)).toContain("report.law.raid_warning");
    zone(first.state, "zone_redwater").heat = 70;
    expect(run(first.state, [], sureRaid).state.businesses).toHaveLength(0);
  });
});

describe("policía y sheriff", () => {
  it("con calor alto sostenido llega más policía; cuando se enfría, vuelve a la normalidad", () => {
    const state = newState();
    const base = zone(state, "zone_redwater").policePresence;
    zone(state, "zone_redwater").heat = 70;
    const hot = run(state).state;
    expect(zone(hot, "zone_redwater").policePresence).toBe(base + 1);
    zone(hot, "zone_redwater").heat = 0;
    expect(zone(run(hot).state, "zone_redwater").policePresence).toBe(base);
  });

  it("con el sheriff de nuestro lado, las tareas generan menos calor", () => {
    const state = newState();
    state.factions[SHERIFF]!.relations[PLAYER] = 100;
    const noDecay = dataWith((d) => {
      d.balance.arrest.minChance = 0;
      d.balance.arrest.maxChance = 0;
      d.balance.heat.weeklyDecay = 0;
    });
    const next = run(state, [{ memberId: SERGEANT, taskId: "task_steal_bikes", zoneId: "zone_redwater" }], noDecay).state;
    expect(zone(next, "zone_redwater").heat).toBe(6 * (1 - balance.law.sheriffHeatReductionMax));
  });

  it("la buena voluntad del sheriff se desgasta con las semanas", () => {
    const state = newState();
    state.factions[SHERIFF]!.relations[PLAYER] = 10;
    expect(run(state).state.factions[SHERIFF]?.relations[PLAYER]).toBe(10 - balance.law.sheriffRelationDecay);
  });
});

describe("investigación federal (GDD §10)", () => {
  it("una semana sin tareas ilegales la baja", () => {
    const state = newState();
    state.factions[PLAYER]!.federal = 30;
    expect(run(state).state.factions[PLAYER]?.federal).toBe(30 - balance.federal.lowProfileDrop);
  });

  it("las zonas calientes donde tenemos control la suben", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 70;
    zone(state, "zone_dry_creek").heat = 70;
    const next = run(state, [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]).state;
    expect(next.factions[PLAYER]?.federal).toBe(2 * balance.federal.perHotZone);
  });

  it("es invisible para el jugador hasta llegar a 50", () => {
    const state = newState();
    member(state, "member_dale_brody").informant = true;
    state.factions[PLAYER]!.federal = 20;
    const { report } = run(state, [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]);
    expect(keysOf(report)).not.toContain("report.law.federal");
  });

  it("si un club de la IA llega a 100, la redada deja presos a sus miembros", () => {
    const state = newState();
    state.factions[WOLVES]!.federal = 100;
    member(state, "member_wolves_rex_hollis").informant = true;
    const { state: next, report } = run(state);
    expect(keysOf(report)).toContain("report.law.federal_raid_ai");
    expect(member(next, "member_wolves_rex_hollis").status).toBe("jailed");
    expect(next.factions[WOLVES]?.federal).toBe(balance.federal.raidResetTo);
  });
});

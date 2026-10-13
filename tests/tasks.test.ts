import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import type { Assignment } from "../src/sim/orders";
import type { GameState } from "../src/sim/state";
import { IMPLEMENTED_TASKS } from "../src/sim/systems/tasks";
import { effectiveStat } from "../src/sim/systems/members";
import { resolveTurn } from "../src/sim/turn";
import {
  alwaysArrestData,
  baseData,
  benchAllExcept,
  dataWith,
  member,
  money,
  newState,
  noArrestData,
  PLAYER,
  PRESIDENT,
  PROSPECT,
  SERGEANT,
  SHERIFF,
  VP,
  WOLVES,
  zone,
} from "./helpers";

/** Runs one week where only the given assignments act. Heat decay is turned off to observe task heat directly. */
function runTasks(state: GameState, assignments: Assignment[], data: GameData = noArrestData) {
  benchAllExcept(state, assignments.map((a) => a.memberId));
  const noDecay = structuredClone(data);
  noDecay.balance.heat.weeklyDecay = 0;
  return resolveTurn(state, { assignments }, noDecay);
}

const keys = (report: { key: string }[]) => report.map((e) => e.key);

describe("tareas: todas las habilitadas tienen implementación", () => {
  it("cada tarea con enabled=true en tasks.json hace algo", () => {
    for (const task of baseData.tasks.filter((t) => t.enabled)) {
      expect(IMPLEMENTED_TASKS, task.id).toContain(task.id);
    }
  });
});

describe("custodiar zona (GDD §7)", () => {
  it("suma 1 + Fuerza/3 de control en el espacio libre", () => {
    const state = newState();
    const { state: next } = runTasks(state, [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_dry_creek" }]);
    // Sergeant has strength 8 → 1 + floor(8/3) = 3
    expect(zone(next, "zone_dry_creek").control[PLAYER]).toBe(30 + 3);
  });

  it("no genera calor", () => {
    const { state: next } = runTasks(newState(), [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_redwater" }]);
    expect(zone(next, "zone_redwater").heat).toBe(0);
  });

  it("si no queda control libre, no gana nada y lo explica", () => {
    const state = newState();
    zone(state, "zone_redwater").control = { [PLAYER]: 70, [WOLVES]: 30 };
    const { state: next, report } = runTasks(state, [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_redwater" }]);
    expect(zone(next, "zone_redwater").control[PLAYER]).toBe(70);
    expect(keys(report)).toContain("report.task.guard_no_space");
  });
});

describe("cobrar protección (GDD §7)", () => {
  it("cobrar protección rinde riqueza × control × (0,5 + Labia × 0,1) en plata sucia", () => {
    const state = newState();
    const before = money(state).dirty;
    const { state: next } = runTasks(state, [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }]);
    // Redwater: wealth 3, control 70; president charm 7 → 3 × 70 × 1.2 = 252. Wages are paid afterwards.
    const wages = baseData.balance.wages;
    const paidWages = Object.values(next.members).filter((m) => m.factionId === PLAYER).reduce((s, m) => s + wages[m.rank], 0);
    expect(money(next).dirty).toBe(before + 252 - Math.min(before + 252, paidWages));
  });

  it("suma 3 de calor en la zona", () => {
    const { state: next } = runTasks(newState(), [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }]);
    expect(zone(next, "zone_redwater").heat).toBe(3);
  });

  it("solo se cobra una vez por zona y por semana", () => {
    const { report } = runTasks(newState(), [
      { memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" },
      { memberId: VP, taskId: "task_collect_protection", zoneId: "zone_redwater" },
    ]);
    expect(keys(report).filter((k) => k === "report.task.protection")).toHaveLength(1);
    expect(keys(report)).toContain("report.task.protection_already_collected");
  });

  it("donde no tenemos control no se cobra nada", () => {
    const { report } = runTasks(newState(), [
      { memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_gravel_pit" },
    ]);
    expect(keys(report)).toContain("report.task.protection_nothing");
  });
});

describe("intimidar (GDD §7)", () => {
  it("le saca control al rival más fuerte y lo suma al propio", () => {
    const state = newState();
    const { state: next, report } = runTasks(state, [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]);
    // Sergeant strength 8 → 2 + floor(8/2) = 6. El Cruce starts 10/10.
    expect(zone(next, "zone_crossing").control[WOLVES]).toBe(4);
    expect(zone(next, "zone_crossing").control[PLAYER]).toBe(16);
    expect(keys(report)).toContain("report.task.intimidate");
  });

  it("suma 5 de calor", () => {
    const { state: next } = runTasks(newState(), [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]);
    expect(zone(next, "zone_crossing").heat).toBe(5);
  });

  it("la facción intimidada empeora su relación con el agresor y se entera en el informe", () => {
    const { state: next, report } = runTasks(newState(), [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]);
    expect(next.factions[WOLVES]?.relations[PLAYER]).toBe(-baseData.balance.relations.intimidatedPenalty);
    const notice = report.find((e) => e.key === "report.task.intimidated_by");
    expect(notice?.factionId).toBe(WOLVES);
  });

  it("intimidar donde no hay rival no cambia ninguna relación", () => {
    const { state: next } = runTasks(newState(), [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_gravel_pit" }]);
    expect(next.factions[WOLVES]?.relations[PLAYER]).toBeUndefined();
  });
});

describe("robar motos (GDD §7)", () => {
  it("suma entre 1 y 3 motos robadas al stock", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state: next } = runTasks(newState(seed), [{ memberId: PRESIDENT, taskId: "task_steal_bikes", zoneId: "zone_redwater" }]);
      const bikes = next.factions[PLAYER]?.stock["good_stolen_bike"] ?? 0;
      expect(bikes).toBeGreaterThanOrEqual(1);
      expect(bikes).toBeLessThanOrEqual(3);
    }
  });
});

describe("sobornar (GDD §7)", () => {
  it("cuesta plata sucia, baja el calor de la zona y mejora la relación con el sheriff", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 40;
    const { state: next, report } = runTasks(state, [{ memberId: PRESIDENT, taskId: "task_bribe", zoneId: "zone_redwater" }]);
    const rule = baseData.balance.tasks.bribe;
    expect(zone(next, "zone_redwater").heat).toBe(40 - rule.heatReduction);
    // Stored on the sheriff (how he treats us); it fades a little at the end of the week.
    expect(next.factions[SHERIFF]?.relations[PLAYER]).toBe(rule.sheriffRelationGain - baseData.balance.law.sheriffRelationDecay);
    expect(keys(report)).toContain("report.task.bribe");
  });

  it("sin plata sucia suficiente no hace nada", () => {
    const state = newState();
    money(state).dirty = 0;
    zone(state, "zone_redwater").heat = 40;
    const { state: next, report } = runTasks(state, [{ memberId: PRESIDENT, taskId: "task_bribe", zoneId: "zone_redwater" }]);
    expect(zone(next, "zone_redwater").heat).toBe(40);
    expect(keys(report)).toContain("report.task.bribe_no_money");
  });
});

describe("reclutar (GDD §7)", () => {
  const sureRecruit = dataWith((d) => {
    d.balance.tasks.recruit.baseChance = 1;
  });

  it("si sale bien, suma un prospecto activo con stats dentro del rango", () => {
    const state = newState();
    const before = Object.keys(state.members).length;
    const { state: next } = runTasks(state, [{ memberId: PRESIDENT, taskId: "task_recruit", zoneId: "zone_redwater" }], sureRecruit);
    const recruits = Object.values(next.members).filter((m) => m.id.startsWith("member_recruit_"));
    expect(Object.keys(next.members)).toHaveLength(before + 1);
    expect(recruits).toHaveLength(1);
    const r = recruits[0]!;
    expect(r.rank).toBe("prospect");
    expect(r.status).toBe("active");
    for (const v of Object.values(r.stats)) {
      expect(v).toBeGreaterThanOrEqual(baseData.balance.tasks.recruit.statMin);
      expect(v).toBeLessThanOrEqual(baseData.balance.tasks.recruit.statMax);
    }
  });

  it("no recluta si el club llegó al tope de miembros", () => {
    const capped = dataWith((d) => {
      d.balance.tasks.recruit.baseChance = 1;
      d.balance.club.memberCap = 8;
    });
    const { report } = runTasks(newState(), [{ memberId: PRESIDENT, taskId: "task_recruit", zoneId: "zone_redwater" }], capped);
    expect(keys(report)).toContain("report.task.recruit_full");
  });
});

describe("bajo perfil (GDD §7)", () => {
  it("baja 5 el calor de la zona", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 20;
    const { state: next } = runTasks(state, [{ memberId: PRESIDENT, taskId: "task_lie_low", zoneId: "zone_redwater" }]);
    expect(zone(next, "zone_redwater").heat).toBe(15);
  });
});

describe("arrestos (GDD §7)", () => {
  it("si arrestan al miembro, queda preso, la tarea no rinde pero el calor se suma igual", () => {
    const state = newState();
    const before = money(state).dirty;
    const { state: next, report } = runTasks(
      state,
      [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }],
      alwaysArrestData,
    );
    const president = member(next, PRESIDENT);
    expect(president.status).toBe("jailed");
    expect(president.statusWeeks).toBeGreaterThanOrEqual(baseData.balance.arrest.jailWeeksMin - 1);
    expect(keys(report)).toContain("report.task.arrested");
    expect(keys(report)).not.toContain("report.task.protection");
    expect(zone(next, "zone_redwater").heat).toBe(3);
    expect(money(next).dirty).toBeLessThanOrEqual(before);
  });

  it("las tareas legales nunca terminan en arresto", () => {
    const { state: next } = runTasks(
      newState(),
      [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_redwater" }],
      alwaysArrestData,
    );
    expect(member(next, SERGEANT).status).toBe("active");
  });
});

describe("prospectos (GDD §6)", () => {
  it("tienen −2 en todos los stats, sin bajar del mínimo", () => {
    const state = newState();
    const prospect = member(state, PROSPECT);
    expect(effectiveStat(prospect, "strength", baseData.balance)).toBe(prospect.stats.strength - 2);
    expect(effectiveStat(prospect, "charm", baseData.balance)).toBe(baseData.balance.ranges.stat.min);
  });
});

describe("iniciativa", () => {
  it("el orden en que se cargan las órdenes no cambia el resultado", () => {
    const orders: Assignment[] = [
      { memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" },
      { memberId: VP, taskId: "task_collect_protection", zoneId: "zone_redwater" },
      { memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" },
    ];
    const a = runTasks(newState(5), orders, baseData);
    const b = runTasks(newState(5), [...orders].reverse(), baseData);
    expect(a.state).toEqual(b.state);
    expect(a.report).toEqual(b.report);
  });
});

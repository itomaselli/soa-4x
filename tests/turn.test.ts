import { describe, expect, it } from "vitest";
import type { Assignment } from "../src/sim/orders";
import { reachableZones } from "../src/sim/orders";
import { TURN_STAGES } from "../src/sim/report";
import { ownedZones } from "../src/sim/systems/control";
import { resolveTurn } from "../src/sim/turn";
import { baseData, benchAllExcept, dataWith, member, money, newState, PLAYER, PRESIDENT, VP, WOLVES, zone } from "./helpers";

const keys = (report: { key: string }[]) => report.map((e) => e.key);
const empty = { assignments: [] };

describe("resolución del turno", () => {
  it("avanza una semana", () => {
    expect(resolveTurn(newState(), empty, baseData).state.week).toBe(2);
  });

  it("no modifica el estado que recibe", () => {
    const state = newState();
    const copy = structuredClone(state);
    resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }] }, baseData);
    expect(state).toEqual(copy);
  });

  it("es determinista: mismo estado y mismas órdenes, mismo resultado", () => {
    const orders = { assignments: [{ memberId: PRESIDENT, taskId: "task_steal_bikes", zoneId: "zone_redwater" }] };
    expect(resolveTurn(newState(9), orders, baseData)).toEqual(resolveTurn(newState(9), orders, baseData));
  });

  it("el informe respeta el orden fijo de etapas del GDD §4", () => {
    const state = newState();
    money(state).clean = 0;
    money(state).dirty = 0;
    zone(state, "zone_redwater").heat = 50;
    const { report } = resolveTurn(state, { assignments: [{ memberId: VP, taskId: "task_guard_zone", zoneId: "zone_redwater" }] }, baseData);
    const stageIndexes = report.map((e) => TURN_STAGES.indexOf(e.stage));
    expect(stageIndexes).toEqual([...stageIndexes].sort((a, b) => a - b));
    expect(new Set(report.map((e) => e.stage)).size).toBeGreaterThanOrEqual(4);
  });

  it("guarda el estado del RNG para que la semana siguiente siga la secuencia", () => {
    const state = newState();
    const next = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_steal_bikes", zoneId: "zone_redwater" }] }, baseData).state;
    expect(next.rngState).not.toBe(state.rngState);
  });
});

describe("órdenes inválidas se descartan y se explican", () => {
  const cases: Array<[string, Assignment, string]> = [
    ["miembro inexistente", { memberId: "member_nobody", taskId: "task_guard_zone", zoneId: "zone_redwater" }, "order_error.unknown_member"],
    ["tarea no disponible todavía", { memberId: PRESIDENT, taskId: "task_gun_run", zoneId: "zone_redwater" }, "order_error.task_not_available"],
    ["zona fuera de alcance", { memberId: PRESIDENT, taskId: "task_guard_zone", zoneId: "zone_lone_pine" }, "order_error.zone_not_reachable"],
  ];
  for (const [name, assignment, reason] of cases) {
    it(name, () => {
      const { report } = resolveTurn(newState(), { assignments: [assignment] }, baseData);
      const rejected = report.find((e) => e.key === "report.order_rejected");
      expect(rejected?.params.reasonKey).toBe(reason);
    });
  }

  it("un miembro preso no puede recibir tarea", () => {
    const state = newState();
    member(state, PRESIDENT).status = "jailed";
    member(state, PRESIDENT).statusWeeks = 2;
    const { report } = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_guard_zone", zoneId: "zone_redwater" }] }, baseData);
    expect(report.find((e) => e.key === "report.order_rejected")?.params.reasonKey).toBe("order_error.member_not_active");
  });

  it("un miembro recibe una sola tarea por semana", () => {
    const { report } = resolveTurn(
      newState(),
      {
        assignments: [
          { memberId: PRESIDENT, taskId: "task_guard_zone", zoneId: "zone_redwater" },
          { memberId: PRESIDENT, taskId: "task_lie_low", zoneId: "zone_redwater" },
        ],
      },
      baseData,
    );
    expect(report.find((e) => e.key === "report.order_rejected")?.params.reasonKey).toBe("order_error.member_already_assigned");
  });
});

describe("alcance de las zonas", () => {
  it("se puede actuar donde hay control propio o en zonas vecinas", () => {
    const zones = reachableZones(newState(), baseData, PLAYER);
    expect(zones).toContain("zone_redwater");
    expect(zones).toContain("zone_crossing"); // control 10
    expect(zones).toContain("zone_route9_north"); // neighbour of El Cruce
    expect(zones).not.toContain("zone_lone_pine");
  });
});

describe("gastos: sueldos (GDD §8)", () => {
  it("los sueldos se pagan primero con plata sucia y después con limpia", () => {
    const state = newState();
    money(state).dirty = 100;
    money(state).clean = 1000;
    const totalWages = Object.values(state.members).reduce((s, m) => s + baseData.balance.wages[m.rank], 0);
    const next = resolveTurn(state, empty, baseData).state;
    expect(money(next).dirty).toBe(0);
    expect(money(next).clean).toBe(1000 - (totalWages - 100));
  });

  it("si no alcanza la plata, el miembro no cobra y pierde lealtad", () => {
    const state = newState();
    money(state).dirty = 0;
    money(state).clean = 0;
    const vpLoyalty = member(state, VP).loyalty;
    const { state: next, report } = resolveTurn(state, empty, baseData);
    expect(member(next, VP).loyalty).toBe(vpLoyalty - baseData.balance.loyalty.unpaidPenalty);
    expect(keys(report)).toContain("report.expenses.unpaid");
    expect(keys(report)).toContain("report.loyalty.unpaid");
  });

  it("el presidente no cobra sueldo y no pierde lealtad por eso", () => {
    const state = newState();
    money(state).dirty = 0;
    money(state).clean = 0;
    const next = resolveTurn(state, empty, baseData).state;
    expect(member(next, PRESIDENT).loyalty).toBe(member(state, PRESIDENT).loyalty);
  });

  it("la plata nunca queda negativa", () => {
    const state = newState();
    money(state).dirty = 15;
    money(state).clean = 20;
    const next = resolveTurn(state, empty, baseData).state;
    expect(money(next).dirty).toBeGreaterThanOrEqual(0);
    expect(money(next).clean).toBeGreaterThanOrEqual(0);
  });
});

describe("calor (GDD §10)", () => {
  it("baja 5 por semana de forma natural, sin pasar de 0", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 12;
    zone(state, "zone_millbrook").heat = 3;
    const next = resolveTurn(state, empty, baseData).state;
    expect(zone(next, "zone_redwater").heat).toBe(7);
    expect(zone(next, "zone_millbrook").heat).toBe(0);
  });

  it("con calor 30 o más hay patrullas y el informe lo avisa", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 40;
    const { report } = resolveTurn(state, empty, baseData);
    expect(keys(report)).toContain("report.heat.patrols");
  });
});

describe("estado de los miembros", () => {
  it("un preso por 3 semanas en la semana 1 vuelve a estar activo en la semana 4", () => {
    let state = newState();
    member(state, VP).status = "jailed";
    member(state, VP).statusWeeks = 3;
    for (let week = 1; week <= 3; week++) {
      expect(member(state, VP).status, `semana ${week}`).toBe("jailed");
      state = resolveTurn(state, empty, baseData).state;
    }
    expect(state.week).toBe(4);
    expect(member(state, VP).status).toBe("active");
  });
});

describe("victoria y derrota (GDD §14)", () => {
  /** Gives the player ownership of the first n zones. */
  function ownZones(state: ReturnType<typeof newState>, n: number) {
    for (const z of Object.values(state.zones).slice(0, n)) z.control = { [PLAYER]: 80 };
  }

  it("controlar 12 zonas durante 4 semanas seguidas da la victoria", () => {
    let state = newState();
    ownZones(state, 12);
    expect(ownedZones(state, PLAYER, baseData.balance)).toHaveLength(12);
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, empty, baseData).state;
      expect(state.outcome).toBeNull();
    }
    state = resolveTurn(state, empty, baseData).state;
    expect(state.outcome).toMatchObject({ result: "victory", reasonKey: "outcome.victory.territory" });
  });

  it("si se pierde una zona, la racha vuelve a cero", () => {
    let state = newState();
    ownZones(state, 12);
    state = resolveTurn(state, empty, baseData).state;
    state = resolveTurn(state, empty, baseData).state;
    expect(state.controlStreaks[PLAYER]).toBe(2);
    const first = Object.values(state.zones)[0]!;
    first.control = { [PLAYER]: 40 };
    state = resolveTurn(state, empty, baseData).state;
    expect(state.controlStreaks[PLAYER]).toBe(0);
  });

  it("expulsar a los Grim Wolves de todas las zonas da la victoria", () => {
    const state = newState();
    for (const z of Object.values(state.zones)) delete z.control[WOLVES];
    const next = resolveTurn(state, empty, baseData).state;
    expect(next.outcome).toMatchObject({ result: "victory", reasonKey: "outcome.victory.rival_expelled" });
  });

  it("quedarse con menos de 3 miembros activos es derrota", () => {
    const state = newState();
    benchAllExcept(state, [PRESIDENT, VP]);
    const next = resolveTurn(state, empty, baseData).state;
    expect(next.outcome).toMatchObject({ result: "defeat", reasonKey: "outcome.defeat.too_few_members" });
  });

  it("la investigación federal al 100% es derrota", () => {
    const state = newState();
    state.federalInvestigation = 100;
    const next = resolveTurn(state, empty, baseData).state;
    expect(next.outcome).toMatchObject({ result: "defeat", reasonKey: "outcome.defeat.federal_raid" });
  });

  it("con la partida terminada, el turno no avanza", () => {
    const state = newState();
    state.outcome = { result: "defeat", reasonKey: "outcome.defeat.federal_raid", week: 1 };
    const { state: next, report } = resolveTurn(state, empty, baseData);
    expect(next).toBe(state);
    expect(keys(report)).toEqual(["report.game_over"]);
  });

  it("la condición de expulsión usa la facción configurada en balance.json", () => {
    const data = dataWith((d) => {
      d.balance.victory.rivalToExpel = "faction_cartel_valdes";
    });
    const state = newState(42, data);
    zone(state, "zone_port_calloway").control = {};
    const next = resolveTurn(state, empty, data).state;
    expect(next.outcome?.reasonKey).toBe("outcome.victory.rival_expelled");
  });
});

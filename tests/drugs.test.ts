import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import type { ManagementOrder } from "../src/sim/management";
import type { Assignment } from "../src/sim/orders";
import { aiOrders } from "../src/sim/systems/ai";
import { addBusiness, buildProblem } from "../src/sim/systems/businesses";
import { stanceKey } from "../src/sim/systems/diplomacy";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, money, newState, PLAYER, PRESIDENT, WOLVES, zone } from "./helpers";

const CARTEL = "faction_cartel_valdes";
const LLAVE = "member_luis_ortega"; // hands 8
const calm = dataWith((d) => {
  d.balance.arrest.minChance = 0;
  d.balance.arrest.maxChance = 0;
  d.balance.events.weeklyChance = 0;
  d.balance.heat.weeklyDecay = 0;
  d.balance.control.erosionPerWeek = 0;
});
const run = (state: GameState, opts: { assignments?: Assignment[]; management?: ManagementOrder[] } = {}, data: GameData = calm) =>
  resolveTurn(state, { assignments: opts.assignments ?? [], management: opts.management ?? [] }, data);
const stock = (s: GameState, good: string, f = PLAYER) => s.factions[f]?.stock[good] ?? 0;
const keys = (r: { key: string }[]) => r.map((e) => e.key);

/** A business that already works (built in an earlier week), free of charge. */
function owned(state: GameState, typeId: string, zoneId: string): GameState {
  const week = state.week;
  state.week = 0;
  const cost = baseData.businesses.find((b) => b.id === typeId)!.buildCost;
  money(state).clean += cost;
  addBusiness(state, baseData, PLAYER, typeId, zoneId);
  state.week = week;
  return state;
}

describe("cadena C: marihuana (Fase 9)", () => {
  it("la plantación solo se puede poner en zonas rurales", () => {
    const state = newState();
    zone(state, "zone_dry_creek").control = { [PLAYER]: 80 };
    expect(buildProblem(state, baseData, PLAYER, "business_plantation", "zone_redwater")).toBe("build_error.wrong_zone_type");
    expect(buildProblem(state, baseData, PLAYER, "business_plantation", "zone_dry_creek")).toBeNull();
  });

  it("produce 2 de marihuana por semana y suma calor en su zona", () => {
    const state = owned(newState(), "business_plantation", "zone_dry_creek");
    zone(state, "zone_dry_creek").control = { [PLAYER]: 80 };
    const next = run(state).state;
    expect(stock(next, "good_weed")).toBe(2);
    expect(zone(next, "zone_dry_creek").heat).toBe(1);
  });

  it("cultivar suma Manos/3 de cosecha para la semana siguiente", () => {
    const state = owned(newState(), "business_plantation", "zone_dry_creek");
    const first = run(state, { assignments: [{ memberId: LLAVE, taskId: "task_cultivate", zoneId: "zone_dry_creek" }] });
    expect(keys(first.report)).toContain("report.task.work");
    const second = run(first.state);
    expect(stock(second.state, "good_weed")).toBe(2 + 2 + Math.floor(8 / 3));
  });

  it("las drogas no se venden desde la gestión: se venden en la calle", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_weed"] = 5;
    const { report } = run(state, { management: [{ kind: "sell", factionId: PLAYER, goodId: "good_weed", quantity: 5 }] });
    expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.street_only");
  });
});

describe("cadena D: cocaína del cartel (Fase 9)", () => {
  function dealing(): GameState {
    const state = owned(newState(), "business_cut_house", "zone_redwater");
    state.stances[stanceKey(PLAYER, CARTEL)] = { type: "deal", sinceWeek: 1, lastPurchaseWeek: 1 };
    money(state).dirty = 5000;
    return state;
  }

  it("con trato y cocina de corte se compran kilos, que llegan por el puerto", () => {
    const next = run(dealing(), { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_coke_brick", quantity: 2 }] }).state;
    // Delivered in the transport stage and cut in next week's production.
    expect(stock(next, "good_coke_brick")).toBe(2);
  });

  it("no se compran más kilos de los que entran en las cocinas", () => {
    const { report } = run(dealing(), { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_coke_brick", quantity: 5 }] });
    expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.no_storage");
  });

  it("la cocina corta hasta 2 kilos por semana en 8 dosis cada uno y calienta su zona", () => {
    const state = dealing();
    state.factions[PLAYER]!.stock["good_coke_brick"] = 3;
    const next = run(state).state;
    expect(stock(next, "good_coke_brick")).toBe(1);
    expect(stock(next, "good_coke_bag")).toBe(16);
    expect(zone(next, "zone_redwater").heat).toBe(3);
  });
});

describe("menudeo (Fase 9)", () => {
  it("vende primero lo más caro, hasta 3 + Labia/2 unidades, y la cocaína llama a los federales", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_coke_bag"] = 4;
    state.factions[PLAYER]!.stock["good_weed"] = 10;
    state.factions[PLAYER]!.federal = 20;
    const { state: next, report } = run(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_retail", zoneId: "zone_redwater" }] });
    // President charm 7 → 3 + 3 = 6 units; Redwater wealth 3 → cap 9.
    expect(stock(next, "good_coke_bag")).toBe(0);
    expect(stock(next, "good_weed")).toBe(10 - 2);
    expect(report.filter((e) => e.key === "report.task.retail")).toHaveLength(2);
    expect(next.factions[PLAYER]?.federal).toBe(20 + 4 * 0.25);
  });

  it("en zonas pobres se vende menos", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_weed"] = 20;
    const next = run(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_retail", zoneId: "zone_dry_creek" }] }).state;
    expect(stock(next, "good_weed")).toBe(20 - 3); // wealth 1 × 3
  });

  it("sin drogas en stock no hay nada que vender", () => {
    const { report } = run(newState(), { assignments: [{ memberId: PRESIDENT, taskId: "task_retail", zoneId: "zone_redwater" }] });
    expect(keys(report)).toContain("report.task.retail_empty");
  });

  it("a los Tradicionalistas no les gusta vender drogas", () => {
    expect(baseData.traits.tasks.traditionalist.dislikes).toContain("task_retail");
  });
});

describe("la IA usa las cadenas nuevas (Fase 9)", () => {
  it("con plantación propia, manda a cultivar; con drogas en stock, sale a vender", () => {
    const state = newState();
    zone(state, "zone_copper_ridge").control = { [WOLVES]: 80 };
    state.week = 0;
    addBusiness(state, baseData, WOLVES, "business_plantation", "zone_copper_ridge");
    state.week = 2;
    state.factions[WOLVES]!.stock["good_weed"] = 12;
    // The Wolves have little Hands; give them one green thumb (Hands 10 → +3 per week).
    member(state, "member_wolves_vern_kidd").stats.hands = 10;
    const orders = aiOrders(state, baseData, WOLVES).assignments;
    expect(orders).toContainEqual(expect.objectContaining({ memberId: "member_wolves_vern_kidd", taskId: "task_cultivate", zoneId: "zone_copper_ridge" }));
    expect(orders.map((a) => a.taskId)).toContain("task_retail");
  });
});

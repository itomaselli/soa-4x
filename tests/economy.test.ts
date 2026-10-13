import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import type { ManagementOrder } from "../src/sim/management";
import type { Assignment } from "../src/sim/orders";
import { addBusiness } from "../src/sim/systems/businesses";
import { stanceKey } from "../src/sim/systems/diplomacy";
import { marketPrice } from "../src/sim/systems/economy";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, money, newState, PLAYER, PRESIDENT, SERGEANT, zone } from "./helpers";

const CARTEL = "faction_cartel_valdes";
const LLAVE = "member_luis_ortega"; // hands 8
const LEDGER = "member_walt_mercer"; // cunning 7

/** No arrests, no events: isolates the economy. */
const calm = dataWith((d) => {
  d.balance.arrest.minChance = 0;
  d.balance.arrest.maxChance = 0;
  d.balance.events.weeklyChance = 0;
});
const run = (state: GameState, opts: { assignments?: Assignment[]; management?: ManagementOrder[] } = {}, data: GameData = calm) =>
  resolveTurn(state, { assignments: opts.assignments ?? [], management: opts.management ?? [] }, data);
const keys = (r: { key: string }[]) => r.map((e) => e.key);
const stock = (s: GameState, good: string) => s.factions[PLAYER]?.stock[good] ?? 0;
const def = (id: string) => baseData.businesses.find((b) => b.id === id)!;

/** A business built in an earlier week, so it already works. */
function withBusiness(state: GameState, typeId: string, zoneId = "zone_redwater"): GameState {
  const week = state.week;
  state.week = 0;
  addBusiness(state, baseData, PLAYER, typeId, zoneId);
  state.week = week;
  money(state).clean += def(typeId).buildCost;
  return state;
}

describe("negocios (GDD §8)", () => {
  it("construir un negocio legal en una zona propia cuesta plata limpia y funciona desde la semana siguiente", () => {
    const state = newState();
    const { state: next, report } = run(state, { management: [{ kind: "build", factionId: PLAYER, typeId: "business_club_bar", zoneId: "zone_redwater" }] });
    expect(next.businesses).toHaveLength(1);
    expect(keys(report)).toContain("report.management.built");
    expect(keys(report)).not.toContain("report.production.bar");
    expect(keys(run(next).report)).toContain("report.production.bar");
  });

  const rejections: Array<[string, (s: GameState) => void, ManagementOrder, string]> = [
    ["en una zona que no es nuestra", () => {}, { kind: "build", factionId: PLAYER, typeId: "business_garage", zoneId: "zone_dry_creek" }, "build_error.not_owner"],
    ["sin plata limpia", (s) => (money(s).clean = 100), { kind: "build", factionId: PLAYER, typeId: "business_garage", zoneId: "zone_redwater" }, "build_error.no_money"],
    ["un negocio ilegal sin pasar por la mesa", () => {}, { kind: "build", factionId: PLAYER, typeId: "business_chop_shop", zoneId: "zone_redwater" }, "management_error.illegal_needs_council"],
  ];
  for (const [name, setup, order, reason] of rejections) {
    it(`no se puede construir ${name}`, () => {
      const state = newState();
      setup(state);
      const { report } = run(state, { management: [order] });
      expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe(reason);
    });
  }

  it("no se puede construir si la zona no tiene lugares libres", () => {
    const state = newState();
    for (let i = 0; i < 3; i++) withBusiness(state, "business_club_bar");
    const { report } = run(state, { management: [{ kind: "build", factionId: PLAYER, typeId: "business_garage", zoneId: "zone_redwater" }] });
    expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("build_error.no_slot");
  });

  it("un negocio ilegal se abre con el voto de la mesa", () => {
    const sure = dataWith((d) => {
      d.balance.council.vote.minChance = 1;
      d.balance.events.weeklyChance = 0;
    });
    const { state } = resolveTurn(
      newState(),
      { assignments: [], proposals: [{ factionId: PLAYER, type: "open_illegal_business", businessTypeId: "business_chop_shop", zoneId: "zone_redwater" }] },
      sure,
    );
    expect(state.businesses.map((b) => b.typeId)).toEqual(["business_chop_shop"]);
  });

  it("si no se puede pagar el mantenimiento, el negocio queda parado y no produce", () => {
    const state = withBusiness(newState(), "business_club_bar");
    money(state).clean = 0;
    money(state).dirty = 0;
    const first = run(state);
    expect(first.state.businesses[0]?.suspended).toBe(true);
    expect(keys(run(first.state).report)).not.toContain("report.production.bar");
  });
});

describe("producción (GDD §9)", () => {
  it("el desarmadero convierte hasta 3 motos robadas por semana en 3 piezas cada una", () => {
    const state = withBusiness(newState(), "business_chop_shop");
    state.factions[PLAYER]!.stock["good_stolen_bike"] = 5;
    const next = run(state).state;
    expect(stock(next, "good_stolen_bike")).toBe(2);
    expect(stock(next, "good_parts")).toBe(9);
  });

  it("el taller arma una moto custom por semana con 2 piezas, y más si alguien trabajó ahí", () => {
    const state = withBusiness(newState(), "business_garage");
    state.factions[PLAYER]!.stock["good_parts"] = 10;
    const first = run(state, { assignments: [{ memberId: LLAVE, taskId: "task_work_garage", zoneId: "zone_redwater" }] });
    expect(stock(first.state, "good_custom_bike")).toBe(1);
    // Llave (Hands 8) adds 8/4 = 2 units for next week.
    const second = run(first.state);
    expect(stock(second.state, "good_custom_bike")).toBe(1 + 3);
    expect(stock(second.state, "good_parts")).toBe(10 - 2 * 4);
  });

  it("el bar deja plata limpia según la riqueza de la zona y sube la lealtad del club", () => {
    const state = withBusiness(newState(), "business_club_bar");
    const { report } = run(state);
    expect(report.find((e) => e.key === "report.production.bar")?.params.income).toBe(25 * 3);
    expect(keys(report)).toContain("report.loyalty.bar");
  });
});

describe("mercado (GDD §9)", () => {
  it("sin ventas recientes el precio está 20% arriba; con mucha oferta, 20% abajo", () => {
    const state = newState();
    expect(marketPrice(state, baseData, "good_parts")).toBe(72);
    state.market["good_parts"] = { supply: 100 };
    expect(marketPrice(state, baseData, "good_parts")).toBe(48);
  });

  it("vender baja el stock, suma la plata en la moneda que corresponde y satura el mercado", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_custom_bike"] = 2;
    const clean = money(state).clean;
    const next = run(state, { management: [{ kind: "sell", factionId: PLAYER, goodId: "good_custom_bike", quantity: 2 }] }).state;
    expect(stock(next, "good_custom_bike")).toBe(0);
    expect(money(next).clean).toBeGreaterThan(clean);
    expect(next.market["good_custom_bike"]?.supply).toBeGreaterThan(0);
  });

  it("la oferta reciente se olvida con las semanas y el precio se recupera", () => {
    const state = newState();
    state.market["good_parts"] = { supply: 12 };
    const later = run(run(state).state).state;
    expect(marketPrice(later, baseData, "good_parts")).toBeGreaterThan(marketPrice(state, baseData, "good_parts")!);
  });

  it("las motos robadas no se venden directo: van al desarmadero", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_stolen_bike"] = 3;
    const { report } = run(state, { management: [{ kind: "sell", factionId: PLAYER, goodId: "good_stolen_bike", quantity: 1 }] });
    expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.not_sellable");
  });
});

describe("lavado (GDD §8)", () => {
  it("convierte plata sucia en limpia hasta la capacidad de los negocios legales", () => {
    const state = withBusiness(newState(), "business_club_bar"); // capacity 300
    money(state).dirty = 1000;
    const next = run(state, { management: [{ kind: "launder", factionId: PLAYER, amount: 200 }] }).state;
    expect(next.factions[PLAYER]?.federal).toBe(0);
    expect(money(next).clean).toBeGreaterThan(money(state).clean);
  });

  it("lavar por encima del 70% de la capacidad suma investigación federal", () => {
    const state = withBusiness(newState(), "business_club_bar");
    money(state).dirty = 1000;
    const { state: next, report } = run(state, {
      management: [{ kind: "launder", factionId: PLAYER, amount: 300 }],
      assignments: [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }],
    });
    expect(keys(report)).toContain("report.laundering.too_much");
    expect(next.factions[PLAYER]?.federal).toBeGreaterThan(0);
  });

  it("sin negocios legales no se puede lavar", () => {
    const { report } = run(newState(), { management: [{ kind: "launder", factionId: PLAYER, amount: 100 }] });
    expect(report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.no_laundering");
  });
});

describe("cartel y armas (GDD §9 cadena B, §12)", () => {
  function dealing(): GameState {
    const state = withBusiness(newState(), "business_warehouse");
    state.stances[stanceKey(PLAYER, CARTEL)] = { type: "deal", sinceWeek: 1, lastPurchaseWeek: 1 };
    return state;
  }

  it("un trato con el cartel se cierra con el voto de la mesa", () => {
    const sure = dataWith((d) => {
      d.balance.council.vote.minChance = 1;
      d.balance.events.weeklyChance = 0;
    });
    const { state } = resolveTurn(newState(), { assignments: [], proposals: [{ factionId: PLAYER, type: "cartel_deal", targetFactionId: CARTEL }] }, sure);
    expect(state.stances[stanceKey(PLAYER, CARTEL)]?.type).toBe("deal");
  });

  it("con trato y depósito, las armas compradas llegan esa misma semana por el puerto", () => {
    const state = dealing();
    const dirty = money(state).dirty;
    const next = run(state, { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_gun_crate", quantity: 2 }] }).state;
    expect(stock(next, "good_gun_crate")).toBe(2);
    expect(money(next).dirty).toBeLessThanOrEqual(dirty - 2 * baseData.balance.cartel.catalog.good_gun_crate!);
  });

  it("sin trato, o sin lugar en el depósito, no se pueden comprar armas", () => {
    expect(run(newState(), { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_gun_crate", quantity: 1 }] }).report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.no_deal");
    const full = dealing();
    full.factions[PLAYER]!.stock["good_gun_crate"] = 10;
    expect(run(full, { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_gun_crate", quantity: 1 }] }).report.find((e) => e.key === "report.management.rejected")?.params.reasonKey).toBe("management_error.no_storage");
  });

  it("con el puerto muy caliente, la policía puede incautar el cargamento", () => {
    const state = dealing();
    zone(state, "zone_port_calloway").heat = 100;
    const seize = dataWith((d) => {
      d.balance.cartel.interceptPerHeat = 1;
      d.balance.events.weeklyChance = 0;
    });
    const { state: next, report } = run(state, { management: [{ kind: "buy", factionId: PLAYER, goodId: "good_gun_crate", quantity: 2 }] }, seize);
    expect(keys(report)).toContain("report.transport.seized");
    expect(stock(next, "good_gun_crate")).toBe(0);
  });

  it("si pasan 2 semanas sin comprar, el cartel rompe el trato y castiga", () => {
    // Bought in week 1; weeks 2 and 3 go by without buying → broken at the end of week 3.
    let state = dealing();
    state = run(state).state;
    expect(state.stances[stanceKey(PLAYER, CARTEL)]?.type).toBe("deal");
    state = run(state).state;
    expect(state.stances[stanceKey(PLAYER, CARTEL)]?.type).toBe("deal");
    const { state: next, report } = run(state);
    expect(keys(report)).toContain("report.cartel.breach");
    expect(next.stances[stanceKey(PLAYER, CARTEL)]).toBeUndefined();
    expect(Object.values(next.members).some((m) => m.factionId === PLAYER && m.status === "wounded")).toBe(true);
    expect(next.factions[CARTEL]?.relations[PLAYER]).toBeLessThan(0);
  });

  it("la corrida de armas vende 2 + Astucia/3 cajas por plata sucia y llama a los federales", () => {
    const state = newState();
    state.factions[PLAYER]!.stock["good_gun_crate"] = 10;
    const { state: next, report } = run(state, { assignments: [{ memberId: LEDGER, taskId: "task_gun_run", zoneId: "zone_redwater" }] });
    expect(stock(next, "good_gun_crate")).toBe(10 - (2 + Math.floor(7 / 3)));
    expect(keys(report)).toContain("report.task.gun_run");
    expect(next.factions[PLAYER]?.federal).toBe(baseData.balance.federal.perGunRun);
  });

  it("sin armas en stock, la corrida no hace nada", () => {
    const { report } = run(newState(), { assignments: [{ memberId: LEDGER, taskId: "task_gun_run", zoneId: "zone_redwater" }] });
    expect(keys(report)).toContain("report.task.gun_run_empty");
  });

  it("el presidente puede trabajar en el taller aunque no sea su rasgo", () => {
    const state = withBusiness(newState(), "business_garage");
    const { report } = run(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_work_garage", zoneId: "zone_redwater" }] });
    expect(keys(report)).toContain("report.task.work");
    expect(member(state, PRESIDENT).status).toBe("active");
  });
});

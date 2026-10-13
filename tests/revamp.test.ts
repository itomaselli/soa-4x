import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../assets/ui/source/assets-manifest.json";
import { addBusiness } from "../src/sim/systems/businesses";
import { stanceKey } from "../src/sim/systems/diplomacy";
import type { GameState } from "../src/sim/state";
import { CHAIN_IDS, CHAINS, chainView, taskBlocker, type ChainId } from "../src/ui/productionChains";
import { weekReview } from "../src/ui/review";
import { afterResolution, canResolve, createUiState, enterDistrict, leaveDistrict, navigate, resetForGame, VIEWS, type UiState } from "../src/ui/uiState";
import { hqSheet, launderingPanel, topBarModel, votePreview } from "../src/ui/viewModel";
import { baseData, newState, PLAYER, WOLVES } from "./helpers";

const CARTEL = "faction_cartel_valdes";
const view = (state: GameState, chain: ChainId, draft = {}, management = []) => chainView(state, baseData, PLAYER, chain, { draft, management });
const node = (state: GameState, chain: ChainId, key: string, draft = {}) => view(state, chain, draft).nodes.find((n) => n.key === key)!;

function withDeal(state: GameState): GameState {
  state.stances[stanceKey(PLAYER, CARTEL)] = { type: "deal", sinceWeek: state.week };
  return state;
}

/** A zone we own, so we can build there. */
function ownZone(state: GameState, zoneId: string): void {
  state.zones[zoneId]!.control = { [PLAYER]: 90 };
}

describe("estado de la interfaz: navegar no pierde nada", () => {
  const filled = (): UiState => {
    const ui = createUiState({ selectedZoneId: "zone_redwater", renderMode: "tiles", newGameForm: null });
    return {
      ...ui,
      draft: { m1: { taskId: "task_guard_zone", zoneId: "zone_redwater" } },
      proposals: [{ factionId: PLAYER, type: "truce" as const, targetFactionId: WOLVES }],
      management: [{ kind: "launder" as const, factionId: PLAYER, amount: 100 }],
      eventChoices: { e1: "pay" },
      selectedLot: 1,
      localZoneId: "zone_redwater",
    };
  };

  it("cambiar de sección conserva tareas, propuestas, gestión, decisiones y el distrito abierto", () => {
    let ui = filled();
    for (const v of [...VIEWS, ...VIEWS]) ui = navigate(ui, v);
    const before = filled();
    expect(ui.draft).toEqual(before.draft);
    expect(ui.proposals).toEqual(before.proposals);
    expect(ui.management).toEqual(before.management);
    expect(ui.eventChoices).toEqual(before.eventChoices);
    expect(ui.localZoneId).toBe("zone_redwater");
    expect(ui.selectedLot).toBe(1);
  });

  it("entrar y salir de un distrito no toca los borradores", () => {
    const ui = leaveDistrict(enterDistrict(filled(), "zone_cedar_flats"));
    expect(ui.draft).toEqual(filled().draft);
    expect(ui.management).toEqual(filled().management);
    expect(ui.selectedZoneId).toBe("zone_cedar_flats");
    expect(ui.localZoneId).toBeNull();
  });

  it("al resolver se gastan las órdenes de la semana y se arrastran las tareas válidas", () => {
    const carried = { m1: { taskId: "task_guard_zone", zoneId: "zone_redwater" } };
    const ui = afterResolution({ ...filled(), showReview: true, resolving: true }, [], carried);
    expect(ui.draft).toEqual(carried);
    expect(ui.proposals).toEqual([]);
    expect(ui.management).toEqual([]);
    expect(ui.eventChoices).toEqual({});
    expect(ui.showReview).toBe(false);
    expect(ui.view).toBe("report");
  });

  it("solo se resuelve desde la revisión abierta, una vez, y nunca con la partida terminada", () => {
    const ui = filled();
    expect(canResolve(ui, false)).toBe(false);
    expect(canResolve({ ...ui, showReview: true }, false)).toBe(true);
    expect(canResolve({ ...ui, showReview: true, resolving: true }, false)).toBe(false);
    expect(canResolve({ ...ui, showReview: true }, true)).toBe(false);
  });

  it("una partida nueva o cargada empieza sin borradores", () => {
    const ui = resetForGame(filled(), "zone_millbrook");
    expect(ui.draft).toEqual({});
    expect(ui.proposals).toEqual([]);
    expect(ui.localZoneId).toBeNull();
    expect(ui.selectedZoneId).toBe("zone_millbrook");
  });
});

describe("cadenas de producción", () => {
  it("cada cadena usa ids reales del contenido, y cada negocio procesa el bien anterior y produce el siguiente", () => {
    const ids = new Set([...baseData.tasks.map((t) => t.id), ...baseData.goods.map((g) => g.id), ...baseData.businesses.map((b) => b.id)]);
    for (const id of CHAIN_IDS) {
      const steps = CHAINS[id].steps;
      steps.forEach((step, i) => {
        if (step.kind === "task" || step.kind === "good" || step.kind === "business") expect(ids.has(step.id), `${id}: ${step.id}`).toBe(true);
        if (step.kind !== "business") return;
        const def = baseData.businesses.find((b) => b.id === step.id)!;
        const prev = steps[i - 1];
        const next = steps[i + 1];
        const rule = def.processor ?? def.workshop;
        if (rule) {
          if (rule.inputGoodId && prev?.kind === "good") expect(rule.inputGoodId, step.id).toBe(prev.id);
          if (next?.kind === "good") expect(rule.outputGoodId, step.id).toBe(next.id);
        }
        if (def.storage && prev?.kind === "good") expect(def.storage.goodId).toBe(prev.id);
      });
    }
  });

  it("siguen el orden del manifest de ilustraciones", () => {
    for (const id of CHAIN_IDS) {
      const ours = CHAINS[id].steps.flatMap((s) => (s.kind === "cartel" ? ["cartel_supplier"] : s.kind === "sale" ? [] : [s.id]));
      expect(ours, id).toEqual(manifest.chains[id]);
    }
  });

  it("el stock es el global del club y no se repite por negocio", () => {
    const state = newState();
    ownZone(state, "zone_redwater");
    state.factions[PLAYER]!.stock.good_parts = 7;
    addBusiness(state, baseData, PLAYER, "business_garage", "zone_redwater", 0);
    addBusiness(state, baseData, PLAYER, "business_garage", "zone_redwater", 1);
    const parts = node(state, "motorcycles", "good:good_parts");
    expect(parts.good?.stock).toBe(7);
    const garage = node(state, "motorcycles", "business:business_garage");
    expect(garage.business?.owned).toHaveLength(2);
    expect(garage).not.toHaveProperty("good");
  });

  it("las motos tienen la salida alternativa de vender piezas (sucio) y la moto custom se vende limpia", () => {
    const v = view(newState(), "motorcycles");
    expect(v.edges).toContainEqual({ from: "good:good_parts", to: "sale:good_parts", kind: "branch" });
    expect(v.nodes.find((n) => n.key === "sale:good_parts")?.sale).toMatchObject({ how: "management", currencyKey: "currency.dirty" });
    expect(v.nodes.find((n) => n.key === "sale:good_custom_bike")?.sale).toMatchObject({ how: "management", currencyKey: "currency.clean" });
    expect(v.nodes.some((n) => n.key === "sale:good_stolen_bike")).toBe(false);
  });

  it("sin el negocio, el nodo queda bloqueado con una acción: construir (legal) o proponer a la mesa (ilegal)", () => {
    const state = newState();
    expect(node(state, "motorcycles", "business:business_garage").blocked?.key).toBe("chain.block.no_business_legal");
    expect(node(state, "motorcycles", "business:business_chop_shop").blocked?.key).toBe("chain.block.no_business_illegal");
  });

  it("un negocio parado por mantenimiento se marca como bloqueado", () => {
    const state = newState();
    ownZone(state, "zone_redwater");
    addBusiness(state, baseData, PLAYER, "business_cut_house", "zone_redwater").suspended = true;
    expect(node(state, "cocaine", "business:business_cut_house").blocked?.key).toBe("chain.block.suspended");
  });

  it("la marihuana pide zona rural y la cocina de corte transforma kilos en dosis", () => {
    const state = newState();
    const plantation = node(state, "marijuana", "business:business_plantation");
    expect(plantation.business?.allowedZoneTypes).toEqual(["rural"]);
    const cut = node(state, "cocaine", "business:business_cut_house");
    expect(cut.business?.rules.map((r) => r.key)).toContain("chain.rule.processor");
    expect(cut.business?.rules.find((r) => r.key === "chain.rule.processor")?.params).toMatchObject({ inputKey: "good.good_coke_brick", outputKey: "good.good_coke_bag" });
  });

  it("drogas y armas se venden solo por tarea (menudeo, corrida), nunca desde la tabla de stock", () => {
    const state = newState();
    expect(node(state, "marijuana", "sale:good_weed").sale).toMatchObject({ how: "task", taskId: "task_retail" });
    expect(node(state, "cocaine", "sale:good_coke_bag").sale).toMatchObject({ how: "task", taskId: "task_retail" });
    expect(node(state, "weapons", "sale:good_gun_crate").sale).toMatchObject({ how: "task", taskId: "task_gun_run" });
  });

  it("el cartel sin trato bloquea la compra; con trato, la falta de depósito o de plata sucia también", () => {
    const state = newState();
    expect(node(state, "weapons", "cartel").blocked?.key).toBe("chain.block.no_deal");
    withDeal(state);
    expect(node(state, "weapons", "cartel").blocked?.key).toBe("chain.block.no_storage");
    ownZone(state, "zone_redwater");
    addBusiness(state, baseData, PLAYER, "business_warehouse", "zone_redwater");
    state.factions[PLAYER]!.money.dirty = 0;
    expect(node(state, "weapons", "cartel").blocked?.key).toBe("chain.block.no_money");
    state.factions[PLAYER]!.money.dirty = 10_000;
    const cartel = node(state, "weapons", "cartel");
    expect(cartel.blocked).toBeNull();
    expect(cartel.cartel).toMatchObject({ dealing: true, price: baseData.balance.cartel.catalog.good_gun_crate, space: 10 });
  });

  it("muestra lo que viene en camino y lo encolado aparte del stock actual", () => {
    const state = withDeal(newState());
    state.shipments.push({ factionId: PLAYER, goodId: "good_coke_brick", quantity: 2 });
    const v = chainView(state, baseData, PLAYER, "cocaine", { draft: {}, management: [{ kind: "buy", factionId: PLAYER, goodId: "good_coke_brick", quantity: 1 }] });
    expect(v.nodes.find((n) => n.key === "good:good_coke_brick")?.good).toMatchObject({ stock: 0, inTransit: 2, queuedBuy: 1 });
  });

  it("las tareas muestran a los miembros asignados en el borrador", () => {
    const state = newState();
    const member = Object.values(state.members).find((m) => m.factionId === PLAYER && m.status === "active")!;
    const t = node(state, "weapons", "task:task_gun_run", { [member.id]: { taskId: "task_gun_run", zoneId: "zone_redwater" } });
    expect(t.task?.assigned).toEqual([{ memberId: member.id, zoneId: "zone_redwater" }]);
  });

  it("menudeo sin stock de calle y cultivar sin plantación avisan que no rendirían", () => {
    const state = newState();
    expect(taskBlocker(state, baseData, PLAYER, "task_retail")?.key).toBe("chain.block.no_stock");
    expect(taskBlocker(state, baseData, PLAYER, "task_cultivate")?.key).toBe("chain.block.no_work_business");
    state.factions[PLAYER]!.stock.good_weed = 3;
    expect(taskBlocker(state, baseData, PLAYER, "task_retail")).toBeNull();
    expect(taskBlocker(state, baseData, PLAYER, "task_guard_zone")).toBeNull();
  });
});

describe("revisión de la semana", () => {
  const queued = (over = {}) => ({ draft: {}, management: [], proposals: [], eventChoices: {}, ...over });

  it("los miembros sin tarea son aviso, no error: descansar vale", () => {
    const r = weekReview(newState(), baseData, PLAYER, queued());
    expect(r.errors).toBe(0);
    expect(r.idle.length).toBeGreaterThan(0);
    expect(r.warnings).toBeGreaterThanOrEqual(r.idle.length);
  });

  it("usa los mismos validadores que la simulación para tareas, gestión y propuestas", () => {
    const state = newState();
    const member = Object.values(state.members).find((m) => m.factionId === PLAYER)!;
    const r = weekReview(state, baseData, PLAYER, queued({
      draft: { [member.id]: { taskId: "task_guard_zone", zoneId: null } },
      management: [{ kind: "sell", factionId: PLAYER, goodId: "good_weed", quantity: 1 }],
      proposals: [{ factionId: PLAYER, type: "truce", targetFactionId: WOLVES }],
    }));
    expect(r.assignments[0]?.problem).toBe("ui.error.pick_zone");
    expect(r.management[0]?.problem).toBe("management_error.street_only");
    expect(r.proposals[0]?.problem).toBe("proposal_error.not_at_war");
    expect(r.errors).toBe(3);
  });

  it("suma lo encolado por moneda y avisa si supera la plata, sin contar dos veces", () => {
    const state = withDeal(newState());
    ownZone(state, "zone_redwater");
    addBusiness(state, baseData, PLAYER, "business_warehouse", "zone_redwater");
    state.factions[PLAYER]!.money = { clean: 1000, dirty: 300 };
    const build = { kind: "build" as const, factionId: PLAYER, typeId: "business_club_bar", zoneId: "zone_redwater" };
    const buy = { kind: "buy" as const, factionId: PLAYER, goodId: "good_gun_crate", quantity: 1 };
    const r = weekReview(state, baseData, PLAYER, queued({ management: [build, buy, buy] }));
    expect(r.committed).toEqual({ clean: 1000, dirty: 2 * baseData.balance.cartel.catalog.good_gun_crate! });
    expect(r.overCommitted).toEqual({ clean: false, dirty: true });
  });

  it("una propuesta de negocio ilegal muestra su costo solo si se aprueba", () => {
    const state = newState();
    ownZone(state, "zone_redwater");
    const r = weekReview(state, baseData, PLAYER, queued({ proposals: [{ factionId: PLAYER, type: "open_illegal_business", businessTypeId: "business_chop_shop", zoneId: "zone_redwater" }] }));
    expect(r.proposals[0]?.costIfApproved).toBe(baseData.businesses.find((b) => b.id === "business_chop_shop")!.buildCost);
    expect(r.committed).toEqual({ clean: 0, dirty: 0 });
  });

  it("las decisiones de eventos sin elegir usan la opción por defecto", () => {
    const state = newState();
    const event = baseData.events[0]!;
    state.pendingEvents.push({ instanceId: "x@1", eventId: event.id, factionId: PLAYER, subjectMemberId: null, week: 1 });
    const r = weekReview(state, baseData, PLAYER, queued());
    expect(r.events).toEqual([{ instanceId: "x@1", eventId: event.id, optionId: event.defaultOption, isDefault: true }]);
  });

  it("no cambia el estado de la partida", () => {
    const state = newState();
    const before = structuredClone(state);
    weekReview(state, baseData, PLAYER, queued({ management: [{ kind: "launder", factionId: PLAYER, amount: 50 }] }));
    expect(state).toEqual(before);
  });
});

describe("sede, lavado, cabecera y mesa", () => {
  it("la sede usa el nombre, parche y distrito sede reales, sin inventar costos ni bonos", () => {
    const state = newState();
    state.identities[PLAYER] = { name: "Los Cuervos", patchId: "patch_07" };
    const data = { ...baseData, factions: baseData.factions.map((f) => (f.id === PLAYER ? { ...f, name: "Los Cuervos", patchId: "patch_07" } : f)) };
    const hq = hqSheet(state, data, PLAYER)!;
    expect(hq).toMatchObject({ factionName: "Los Cuervos", patchId: "patch_07", zoneId: baseData.factions.find((f) => f.id === PLAYER)!.hqZoneId });
    expect(Object.keys(hq).sort()).toEqual(["businesses", "color", "factionName", "memberCap", "members", "ourControl", "owner", "patchId", "zoneId", "zoneName", "zoneTypeKey"]);
    expect(baseData.businesses.some((b) => b.id.includes("hq"))).toBe(false);
  });

  it("el lavado suma solo negocios legales funcionando y toma el umbral de balance.json", () => {
    const state = newState();
    ownZone(state, "zone_redwater");
    const garage = addBusiness(state, baseData, PLAYER, "business_garage", "zone_redwater");
    garage.builtWeek = state.week - 1;
    const bar = addBusiness(state, baseData, PLAYER, "business_club_bar", "zone_redwater");
    bar.builtWeek = state.week - 1;
    bar.suspended = true;
    addBusiness(state, baseData, PLAYER, "business_chop_shop", "zone_redwater");
    const l = launderingPanel(state, baseData, PLAYER, [{ kind: "launder", amount: 120 }]);
    expect(l.capacity).toBe(400);
    expect(l.safePercent).toBe(Math.round(baseData.balance.laundering.federalAttentionCapacityRatio * 100));
    expect(l.sources.map((s) => s.capacity)).toEqual([400, 0]);
    expect(l.queued).toBe(120);
  });

  it("sin negocios legales la capacidad de lavado es cero", () => {
    expect(launderingPanel(newState(), baseData, PLAYER, [])).toMatchObject({ capacity: 0, safe: 0, sources: [] });
  });

  it("los federales ocultos no se revelan en la cabecera", () => {
    const state = newState();
    state.factions[PLAYER]!.federal = baseData.balance.federal.visibleFrom - 1;
    expect(topBarModel(state, baseData, PLAYER).federal).toBeNull();
  });

  it("la vista previa de votos identifica a cada votante elegible", () => {
    const state = newState();
    const preview = votePreview(state, baseData, PLAYER, "truce");
    for (const v of preview) {
      const m = state.members[v.memberId]!;
      expect(m.factionId).toBe(PLAYER);
      expect(m.rank).not.toBe("president");
      expect(m.rank).not.toBe("prospect");
    }
  });
});

describe("ilustraciones de la interfaz", () => {
  it("hay un PNG por asset del manifest y todos los ids de juego existen", () => {
    const ids = new Set([...baseData.goods.map((g) => g.id), ...baseData.businesses.map((b) => b.id)]);
    expect(manifest.assets).toHaveLength(16);
    for (const a of manifest.assets) {
      const png = readFileSync(new URL(`../assets/ui/illustrations/${a.filename}`, import.meta.url));
      expect(png.subarray(1, 4).toString(), a.filename).toBe("PNG");
      // 252×252 canvas (width and height in the IHDR chunk).
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], a.filename).toEqual([252, 252]);
      if (a.gameId) expect(ids.has(a.gameId), a.gameId).toBe(true);
    }
  });

  it("los mapas nunca usan las ilustraciones nuevas", () => {
    const mapSource = readFileSync(new URL("../src/render/map.ts", import.meta.url), "utf8");
    expect(mapSource).not.toMatch(/assets\/ui/);
    expect(JSON.stringify(baseData.ui)).not.toMatch(/illustrations/);
  });
});

describe("textos de la interfaz", () => {
  it("toda clave de texto literal usada en src/ui existe en strings.es.json", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(import.meta.dirname, "..", "src", "ui");
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith(".ts") ? [join(d, f)] : []));
    const missing: string[] = [];
    for (const file of files(dir)) {
      const source = readFileSync(file, "utf8");
      for (const [, key] of source.matchAll(/\b(?:tr|t)\((?:[a-z.]+, )?"([a-z_]+\.[a-z_.0-9]+)"/g)) if (!(key! in baseData.strings)) missing.push(`${file}: ${key}`);
      for (const [, key] of source.matchAll(/\bkey: "([a-z_]+\.[a-z_.0-9]+)"/g)) if (!(key! in baseData.strings)) missing.push(`${file}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("las claves armadas por vista, cadena y tipo de propuesta existen", () => {
    const keys = [
      ...VIEWS.flatMap((v) => [`ui.nav.${v}`, `ui.view.${v}`]),
      "ui.view.district",
      ...CHAIN_IDS.map((c) => `chain.${c}`),
      ...["task", "good", "business", "cartel", "sale"].map((k) => `chain.kind.${k}`),
      ...["working", "new", "suspended"].map((k) => `chain.status.${k}`),
      ...["declare_war", "truce", "promote", "expel", "cartel_deal", "open_illegal_business"].map((p) => `ui.council.about.${p}`),
    ];
    expect(keys.filter((k) => !(k in baseData.strings))).toEqual([]);
  });
});

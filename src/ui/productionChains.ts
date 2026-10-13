// Production chains for the Business view: Motos, Marihuana, Cocaína, Armas.
// Each chain is a row of nodes (tasks, goods, businesses, the cartel, the sale) built from the real content and
// state: stock is the faction's global stock, businesses are counted with their status, tasks show the members
// assigned in this week's draft, and every blocker comes from the same rules the simulation uses.
// Nothing here predicts random results: pending orders and current values are shown apart.

import type { GameData } from "../data/schemas";
import { cartelId, cartelPrice, validateManagement, type ManagementOrder } from "../sim/management";
import type { GameState } from "../sim/state";
import { businessDef, storageCapacity } from "../sim/systems/businesses";
import { getStance } from "../sim/systems/diplomacy";
import { marketPrice } from "../sim/systems/economy";
import { activeMembers } from "../sim/systems/members";
import type { Draft } from "./draft";

export const CHAIN_IDS = ["motorcycles", "marijuana", "cocaine", "weapons"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

type StepDef = { kind: "task" | "good" | "business"; id: string } | { kind: "cartel" } | { kind: "sale"; goodId: string | null; via: string | null };

/** Chain layout: which game ids form each chain, in the order goods move. The rules come from /data. */
export const CHAINS: Record<ChainId, { steps: StepDef[]; branches: { from: number; to: StepDef }[] }> = {
  motorcycles: {
    steps: [
      { kind: "task", id: "task_steal_bikes" },
      { kind: "good", id: "good_stolen_bike" },
      { kind: "business", id: "business_chop_shop" },
      { kind: "good", id: "good_parts" },
      { kind: "business", id: "business_garage" },
      { kind: "good", id: "good_custom_bike" },
      { kind: "sale", goodId: "good_custom_bike", via: null },
    ],
    // Parts can also be sold for dirty money from management.
    branches: [{ from: 3, to: { kind: "sale", goodId: "good_parts", via: null } }],
  },
  marijuana: {
    steps: [
      { kind: "business", id: "business_plantation" },
      { kind: "task", id: "task_cultivate" },
      { kind: "good", id: "good_weed" },
      { kind: "task", id: "task_retail" },
      { kind: "sale", goodId: "good_weed", via: "task_retail" },
    ],
    branches: [],
  },
  cocaine: {
    steps: [
      { kind: "cartel" },
      { kind: "good", id: "good_coke_brick" },
      { kind: "business", id: "business_cut_house" },
      { kind: "good", id: "good_coke_bag" },
      { kind: "task", id: "task_retail" },
      { kind: "sale", goodId: "good_coke_bag", via: "task_retail" },
    ],
    branches: [],
  },
  weapons: {
    steps: [
      { kind: "cartel" },
      { kind: "good", id: "good_gun_crate" },
      { kind: "business", id: "business_warehouse" },
      { kind: "task", id: "task_gun_run" },
      { kind: "sale", goodId: "good_gun_crate", via: "task_gun_run" },
    ],
    branches: [],
  },
};

/** A message as a strings key plus parameters (translated by the UI: params ending in "Key" are keys, in "Keys" lists of keys joined by "|"). */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

export interface ChainNode {
  /** Unique within the chain, e.g. "good:good_parts" or "sale:good_parts". */
  key: string;
  kind: "task" | "good" | "business" | "cartel" | "sale";
  /** Game id: task, good or business id; cartel faction id; for a sale, the good sold. */
  refId: string;
  nameKey: string;
  /** Illustration id (assets-manifest.json), or null to use the glyph. */
  illustrationId: string | null;
  glyph: string;
  /** One-line current state, e.g. "Stock: 4". */
  status: Msg;
  /** Why this step can't work right now and what to do (null = nothing blocks it). */
  blocked: Msg | null;
  good?: GoodNodeInfo;
  business?: BusinessNodeInfo;
  task?: TaskNodeInfo;
  cartel?: CartelNodeInfo;
  sale?: SaleNodeInfo;
}

export interface GoodNodeInfo {
  /** Faction stock now. */
  stock: number;
  /** Bought from the cartel, delivered at the port in the next transport stage. */
  inTransit: number;
  /** Purchases queued this week (not paid yet). */
  queuedBuy: number;
  /** Sales queued this week. */
  queuedSell: number;
  /** Storage limit, if a business stores this good (warehouse, cut house). */
  capacity: number | null;
}

export interface BusinessNodeInfo {
  typeId: string;
  legal: boolean;
  owned: { id: string; zoneId: string; status: "working" | "new" | "suspended" }[];
  /** Queued builds this week (legal businesses). */
  queuedBuilds: number;
  buildCost: number;
  maintenance: number;
  allowedZoneTypes: string[] | null;
  /** Rules read from businesses.json, as messages. */
  rules: Msg[];
  /** Task that boosts its production (garage, plantation). */
  workTaskId: string | null;
}

export interface TaskNodeInfo {
  taskId: string;
  /** Members with this task in this week's draft. */
  assigned: { memberId: string; zoneId: string | null }[];
  /** Active members without any task yet. */
  idle: number;
}

export interface CartelNodeInfo {
  cartelId: string | null;
  dealing: boolean;
  weeksLeft: number | null;
  goodId: string;
  price: number;
  /** Free storage for this good (null = no business stores it). */
  space: number | null;
  dirty: number;
  /** Port where purchases arrive. */
  portZoneId: string;
}

export interface SaleNodeInfo {
  goodId: string;
  price: number | null;
  currencyKey: string | null;
  /** "management": sold from the stock table; "task": a member sells it (retail, gun run). */
  how: "management" | "task";
  taskId: string | null;
}

export interface ChainEdge {
  from: string;
  to: string;
  /** flow: goods move along; branch: an alternative way out. */
  kind: "flow" | "branch";
}

export interface ChainView {
  id: ChainId;
  nameKey: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** Facts about the chain that matter (timing, side uses). */
  notes: Msg[];
}

export interface ChainDrafts {
  draft: Draft;
  management: readonly ManagementOrder[];
}

function nodeKey(step: StepDef): string {
  switch (step.kind) {
    case "cartel":
      return "cartel";
    case "sale":
      return `sale:${step.goodId ?? step.via}`;
    default:
      return `${step.kind}:${step.id}`;
  }
}

/** Illustration for a task: its own (illustrations-extra.json) or one reused per assets-manifest.json. */
export const TASK_ILLUSTRATIONS: Record<string, string> = {
  task_steal_bikes: "task_steal_bikes",
  task_cultivate: "business_plantation",
  task_retail: "distribution_task",
  task_gun_run: "distribution_task",
};

/** Every sale node shows the money illustration; the price and currency are written next to it. */
export const SALE_ILLUSTRATION = "sale_money";

function businessStatus(state: GameState, b: GameState["businesses"][number]): "working" | "new" | "suspended" {
  return b.suspended ? "suspended" : b.builtWeek >= state.week ? "new" : "working";
}

function goodNode(state: GameState, data: GameData, viewer: string, goodId: string, drafts: ChainDrafts): ChainNode {
  const good = data.goods.find((g) => g.id === goodId);
  const stock = state.factions[viewer]?.stock[goodId] ?? 0;
  const inTransit = state.shipments.filter((s) => s.factionId === viewer && s.goodId === goodId).reduce((sum, s) => sum + s.quantity, 0);
  const sum = (kind: "buy" | "sell") =>
    drafts.management.reduce((n, o) => n + ((o.kind === kind && o.goodId === goodId) ? o.quantity : 0), 0);
  return {
    key: `good:${goodId}`,
    kind: "good",
    refId: goodId,
    nameKey: `good.${goodId}`,
    illustrationId: goodId,
    glyph: good?.glyph ?? "?",
    status: { key: "chain.good.stock", params: { stock } },
    blocked: null,
    good: { stock, inTransit, queuedBuy: sum("buy"), queuedSell: sum("sell"), capacity: storageCapacity(state, data, viewer, goodId) },
  };
}

function businessRules(data: GameData, typeId: string): Msg[] {
  const def = businessDef(data, typeId);
  if (!def) return [];
  const rules: Msg[] = [];
  if (def.processor) {
    const p = def.processor;
    rules.push({ key: "chain.rule.processor", params: { inputPerWeek: p.inputPerWeek, inputKey: `good.${p.inputGoodId}`, outputPerInput: p.outputPerInput, outputKey: `good.${p.outputGoodId}` } });
  }
  if (def.workshop) {
    const w = def.workshop;
    rules.push(
      w.inputGoodId
        ? { key: "chain.rule.workshop", params: { baseOutput: w.baseOutput, outputKey: `good.${w.outputGoodId}`, inputPerUnit: w.inputPerUnit, inputKey: `good.${w.inputGoodId}` } }
        : { key: "chain.rule.grow", params: { baseOutput: w.baseOutput, outputKey: `good.${w.outputGoodId}` } },
    );
    rules.push({ key: "chain.rule.work_task", params: { taskKey: `task.${w.workTaskId}`, hands: w.handsPerExtraUnit } });
  }
  if (def.storage) rules.push({ key: "chain.rule.storage", params: { capacity: def.storage.capacity, goodKey: `good.${def.storage.goodId}` } });
  if (def.launderCapacity > 0) rules.push({ key: "chain.rule.launder", params: { capacity: def.launderCapacity } });
  if (def.heatPerWeek) rules.push({ key: "chain.rule.heat", params: { heat: def.heatPerWeek } });
  if (def.allowedZoneTypes) rules.push({ key: "chain.rule.zones", params: { zoneKeys: def.allowedZoneTypes.map((z) => `zone_type.${z}`).join("|") } });
  return rules;
}

function businessNode(state: GameState, data: GameData, viewer: string, typeId: string, drafts: ChainDrafts): ChainNode {
  const def = businessDef(data, typeId);
  const owned = state.businesses
    .filter((b) => b.ownerFactionId === viewer && b.typeId === typeId)
    .map((b) => ({ id: b.id, zoneId: b.zoneId, status: businessStatus(state, b) }));
  const queuedBuilds = drafts.management.filter((o) => o.kind === "build" && o.typeId === typeId).length;
  const working = owned.filter((b) => b.status === "working").length;
  let blocked: Msg | null = null;
  if (owned.length === 0) {
    blocked = def?.legal ? { key: "chain.block.no_business_legal", params: { cost: def.buildCost } } : { key: "chain.block.no_business_illegal", params: { cost: def?.buildCost ?? 0 } };
  } else if (working === 0) {
    blocked = owned.some((b) => b.status === "suspended") ? { key: "chain.block.suspended" } : { key: "chain.block.new_business" };
  }
  return {
    key: `business:${typeId}`,
    kind: "business",
    refId: typeId,
    nameKey: `business.${typeId}`,
    illustrationId: typeId,
    glyph: def?.glyph ?? "?",
    status: owned.length === 0 ? { key: "chain.business.none" } : { key: "chain.business.count", params: { count: owned.length, working } },
    blocked,
    business: {
      typeId,
      legal: def?.legal ?? true,
      owned,
      queuedBuilds,
      buildCost: def?.buildCost ?? 0,
      maintenance: def?.maintenance ?? 0,
      allowedZoneTypes: def?.allowedZoneTypes ?? null,
      rules: businessRules(data, typeId),
      workTaskId: def?.workshop?.workTaskId ?? null,
    },
  };
}

/** Goods a task needs in stock to do anything (retail: street goods; gun run: crates). */
function taskStockNeed(data: GameData, taskId: string): string[] {
  if (taskId === "task_retail") return data.goods.filter((g) => g.streetOnly).map((g) => g.id);
  if (taskId === "task_gun_run") return [data.balance.tasks.gunRun.goodId];
  return [];
}

/** Why a task would do nothing right now (no stock to sell, no business to work at), or null. Same facts the engine checks. */
export function taskBlocker(state: GameState, data: GameData, viewer: string, taskId: string): Msg | null {
  const needs = taskStockNeed(data, taskId);
  const stock = state.factions[viewer]?.stock ?? {};
  if (needs.length > 0 && needs.every((g) => (stock[g] ?? 0) <= 0)) return { key: "chain.block.no_stock", params: { goodKeys: needs.map((g) => `good.${g}`).join("|") } };
  const work = data.businesses.find((b) => b.workshop?.workTaskId === taskId);
  if (work && !state.businesses.some((b) => b.ownerFactionId === viewer && b.typeId === work.id && !b.suspended)) {
    return { key: "chain.block.no_work_business", params: { businessKey: `business.${work.id}` } };
  }
  return null;
}

function taskNode(state: GameState, data: GameData, viewer: string, taskId: string, drafts: ChainDrafts): ChainNode {
  const assigned = Object.entries(drafts.draft)
    .filter(([memberId, e]) => e.taskId === taskId && state.members[memberId]?.factionId === viewer)
    .map(([memberId, e]) => ({ memberId, zoneId: e.zoneId }));
  const idle = activeMembers(state, viewer).filter((m) => !(m.id in drafts.draft)).length;
  const task = data.tasks.find((t) => t.id === taskId);
  return {
    key: `task:${taskId}`,
    kind: "task",
    refId: taskId,
    nameKey: `task.${taskId}`,
    illustrationId: TASK_ILLUSTRATIONS[taskId] ?? null,
    glyph: "@",
    status: assigned.length > 0 ? { key: "chain.task.assigned", params: { count: assigned.length } } : { key: "chain.task.none" },
    blocked: task && !task.enabled ? { key: "order_error.task_not_available" } : taskBlocker(state, data, viewer, taskId),
    task: { taskId, assigned, idle },
  };
}

function cartelNode(state: GameState, data: GameData, viewer: string, goodId: string): ChainNode {
  const cartel = cartelId(data);
  const stance = cartel ? getStance(state, viewer, cartel) : null;
  const dealing = stance?.type === "deal";
  const price = cartelPrice(state, data, viewer, goodId);
  const capacity = storageCapacity(state, data, viewer, goodId);
  const stock = state.factions[viewer]?.stock[goodId] ?? 0;
  const space = capacity === null ? null : Math.max(0, capacity - stock);
  const dirty = state.factions[viewer]?.money.dirty ?? 0;
  const weeksLeft = dealing ? data.balance.cartel.graceWeeks - (state.week - (stance?.lastPurchaseWeek ?? stance?.sinceWeek ?? state.week)) : null;
  // Same check the purchase uses, for one unit.
  const problem = validateManagement(state, data, { kind: "buy", factionId: viewer, goodId, quantity: 1 });
  const blocked: Msg | null = !dealing
    ? { key: "chain.block.no_deal" }
    : problem === "management_error.no_storage"
      ? { key: "chain.block.no_storage", params: { goodKey: `good.${goodId}` } }
      : problem === "management_error.no_money"
        ? { key: "chain.block.no_money", params: { price } }
        : null;
  const cartelDef = data.factions.find((f) => f.id === cartel);
  return {
    key: "cartel",
    kind: "cartel",
    refId: cartel ?? "",
    nameKey: "chain.cartel",
    illustrationId: "cartel_supplier",
    glyph: cartelDef ? "$" : "?",
    status: dealing ? { key: "chain.cartel.deal", params: { weeks: weeksLeft ?? 0 } } : { key: "chain.cartel.no_deal" },
    blocked,
    cartel: { cartelId: cartel, dealing, weeksLeft, goodId, price, space, dirty, portZoneId: data.balance.cartel.portZoneId },
  };
}

function saleNode(state: GameState, data: GameData, goodId: string, via: string | null): ChainNode {
  const good = data.goods.find((g) => g.id === goodId);
  const price = marketPrice(state, data, goodId);
  const currencyKey = good?.saleCurrency ? `currency.${good.saleCurrency}` : null;
  return {
    key: `sale:${goodId}`,
    kind: "sale",
    refId: goodId,
    nameKey: via ? "chain.sale.task" : "chain.sale.management",
    illustrationId: SALE_ILLUSTRATION,
    glyph: "$",
    status: price === null ? { key: "ui.biz.not_sold" } : { key: "chain.sale.price", params: { price, currencyKey: currencyKey ?? "" } },
    blocked: null,
    sale: { goodId, price, currencyKey, how: via ? "task" : "management", taskId: via },
  };
}

export function chainView(state: GameState, data: GameData, viewer: string, chain: ChainId, drafts: ChainDrafts): ChainView {
  const def = CHAINS[chain];
  const cartelGood = def.steps.find((s, i) => s.kind === "good" && def.steps[i - 1]?.kind === "cartel");
  const build = (step: StepDef): ChainNode => {
    switch (step.kind) {
      case "good":
        return goodNode(state, data, viewer, step.id, drafts);
      case "business":
        return businessNode(state, data, viewer, step.id, drafts);
      case "task":
        return taskNode(state, data, viewer, step.id, drafts);
      case "cartel":
        return cartelNode(state, data, viewer, cartelGood?.kind === "good" ? cartelGood.id : "");
      case "sale":
        return saleNode(state, data, step.goodId ?? "", step.via);
    }
  };
  const nodes = def.steps.map(build);
  const edges: ChainEdge[] = nodes.slice(1).map((n, i) => ({ from: nodes[i]!.key, to: n.key, kind: "flow" }));
  for (const branch of def.branches) {
    const node = build(branch.to);
    nodes.push(node);
    edges.push({ from: nodeKey(def.steps[branch.from]!), to: node.key, kind: "branch" });
  }
  const notes: Msg[] = [];
  if (def.steps.some((s) => s.kind === "cartel")) {
    notes.push({ key: "chain.note.port", params: { zone: data.zones.find((z) => z.id === data.balance.cartel.portZoneId)?.name ?? "" } });
  }
  if (chain === "cocaine") notes.push({ key: "chain.note.cut_next_week" });
  if (def.steps.some((s) => s.kind === "task" && s.id === "task_retail")) notes.push({ key: "chain.note.retail" });
  if (chain === "weapons") notes.push({ key: "chain.note.guns_combat" });
  if (chain === "motorcycles") notes.push({ key: "chain.note.bikes" });
  if (chain === "marijuana") notes.push({ key: "chain.note.cultivate" });
  return { id: chain, nameKey: `chain.${chain}`, nodes, edges, notes };
}

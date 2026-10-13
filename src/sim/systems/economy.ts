// Economy stages (GDD §4, §8, §9):
//   management → production → transport → sales → … → laundering
// Stock is per faction; warehouses only limit how many gun crates a faction can hold.

import type { GameData } from "../../data/schemas";
import { zoneName, type TurnContext } from "../context";
import { cartelId, validateManagement, type ManagementOrder } from "../management";
import type { GameState } from "../state";
import { clamp } from "../util";
import { addBusiness, businessDef, launderCapacity, workingBusinesses } from "./businesses";
import { getStance, stanceKey } from "./diplomacy";

/** Current price of a good (GDD §9): base ± variance depending on recent supply. */
export function marketPrice(state: GameState, data: GameData, goodId: string): number | null {
  const good = data.goods.find((g) => g.id === goodId);
  if (!good || good.basePrice === null) return null;
  const supply = state.market[goodId]?.supply ?? 0;
  const saturation = good.marketReference > 0 ? Math.min(1, supply / good.marketReference) : 0;
  return Math.round(good.basePrice * (1 + data.balance.market.priceVariance * (1 - 2 * saturation)));
}

/** Sells units at the current price and adds them to the recent supply. Returns the money earned. */
export function sellGoods(state: GameState, data: GameData, factionId: string, goodId: string, quantity: number): number {
  const good = data.goods.find((g) => g.id === goodId);
  const faction = state.factions[factionId];
  const price = marketPrice(state, data, goodId);
  if (!good || !faction || price === null || good.saleCurrency === null || quantity <= 0) return 0;
  const income = price * quantity;
  faction.stock[goodId] = (faction.stock[goodId] ?? 0) - quantity;
  faction.money[good.saleCurrency] += income;
  state.market[goodId] = { supply: (state.market[goodId]?.supply ?? 0) + quantity };
  return income;
}

function ordersOfKind<K extends ManagementOrder["kind"]>(orders: readonly ManagementOrder[], kind: K) {
  return orders.filter((o): o is Extract<ManagementOrder, { kind: K }> => o.kind === kind);
}

function reject(ctx: TurnContext, order: ManagementOrder, reasonKey: string): void {
  ctx.report("report.management.rejected", { orderKey: `management.${order.kind}`, reasonKey }, order.factionId);
}

/** Builds legal businesses and places gun orders with the cartel (shipments arrive in the transport stage). */
export function resolveManagement(state: GameState, orders: readonly ManagementOrder[], ctx: TurnContext): void {
  const { data } = ctx;
  for (const order of [...ordersOfKind(orders, "build"), ...ordersOfKind(orders, "buy_guns")]) {
    const problem = validateManagement(state, data, order);
    if (problem) {
      reject(ctx, order, problem);
      continue;
    }
    if (order.kind === "build") {
      addBusiness(state, data, order.factionId, order.typeId, order.zoneId);
      ctx.report(
        "report.management.built",
        { businessKey: `business.${order.typeId}`, zone: zoneName(data, order.zoneId), cost: businessDef(data, order.typeId)?.buildCost ?? 0 },
        order.factionId,
      );
    } else {
      const cartel = cartelId(data)!;
      const faction = state.factions[order.factionId]!;
      const cost = order.quantity * data.balance.cartel.dealPrice;
      faction.money.dirty -= cost;
      const cartelState = state.factions[cartel];
      if (cartelState) {
        cartelState.money.dirty += cost;
        cartelState.relations[order.factionId] = clamp(
          (cartelState.relations[order.factionId] ?? 0) + data.balance.cartel.purchaseRelationGain,
          data.balance.ranges.relation,
        );
      }
      const stance = getStance(state, order.factionId, cartel);
      if (stance) state.stances[stanceKey(order.factionId, cartel)] = { ...stance, lastPurchaseWeek: state.week };
      state.shipments.push({ factionId: order.factionId, goodId: data.balance.tasks.gunRun.goodId, quantity: order.quantity });
      ctx.report("report.management.guns_bought", { quantity: order.quantity, cost }, order.factionId);
    }
  }
}

/** Chop shops first (bikes → parts), then garages (parts → custom bikes), then bars (clean income). */
export function resolveProduction(state: GameState, ctx: TurnContext): void {
  const { data } = ctx;
  const order = (typeId: string) => {
    const def = businessDef(data, typeId);
    return def?.chop ? 0 : def?.garage ? 1 : 2;
  };
  for (const def of data.factions) {
    const faction = state.factions[def.id];
    if (!faction) continue;
    const businesses = [...workingBusinesses(state, def.id)].sort((a, b) => order(a.typeId) - order(b.typeId) || a.id.localeCompare(b.id));
    for (const business of businesses) {
      const bdef = businessDef(data, business.typeId);
      if (!bdef) continue;
      const params = { zone: zoneName(data, business.zoneId), businessKey: `business.${bdef.id}` };
      if (bdef.chop) {
        const bikes = Math.min(faction.stock[bdef.chop.inputGoodId] ?? 0, bdef.chop.bikesPerWeek);
        if (bikes > 0) {
          const parts = bikes * bdef.chop.partsPerBike;
          faction.stock[bdef.chop.inputGoodId] = (faction.stock[bdef.chop.inputGoodId] ?? 0) - bikes;
          faction.stock[bdef.chop.outputGoodId] = (faction.stock[bdef.chop.outputGoodId] ?? 0) + parts;
          ctx.report("report.production.chop", { ...params, bikes, parts }, def.id);
        }
      }
      if (bdef.garage) {
        const g = bdef.garage;
        const capacity = g.baseOutput + business.workCapacity;
        const units = Math.min(capacity, Math.floor((faction.stock[g.inputGoodId] ?? 0) / g.partsPerUnit));
        business.workCapacity = 0;
        if (units > 0) {
          faction.stock[g.inputGoodId] = (faction.stock[g.inputGoodId] ?? 0) - units * g.partsPerUnit;
          faction.stock[g.outputGoodId] = (faction.stock[g.outputGoodId] ?? 0) + units;
          ctx.report("report.production.garage", { ...params, units, parts: units * g.partsPerUnit }, def.id);
        }
      }
      if (bdef.bar) {
        const wealth = data.zones.find((z) => z.id === business.zoneId)?.wealth ?? 0;
        const income = Math.round(bdef.bar.incomePerWealth * wealth);
        faction.money.clean += income;
        ctx.report("report.production.bar", { ...params, income }, def.id);
      }
    }
  }
}

/** Gun shipments from the cartel: the hotter the port, the likelier the police seize them. */
export function resolveTransport(state: GameState, ctx: TurnContext): void {
  const { cartel } = ctx.data.balance;
  const port = state.zones[cartel.portZoneId];
  for (const shipment of state.shipments) {
    const faction = state.factions[shipment.factionId];
    if (!faction) continue;
    const seizeChance = (port?.heat ?? 0) * cartel.interceptPerHeat;
    if (ctx.rng.chance(seizeChance)) {
      ctx.report("report.transport.seized", { quantity: shipment.quantity, zone: zoneName(ctx.data, cartel.portZoneId), chance: Math.round(seizeChance * 100) }, shipment.factionId);
      continue;
    }
    faction.stock[shipment.goodId] = (faction.stock[shipment.goodId] ?? 0) + shipment.quantity;
    ctx.report("report.transport.delivered", { quantity: shipment.quantity, goodKey: `good.${shipment.goodId}` }, shipment.factionId);
  }
  state.shipments = [];
}

export function resolveSales(state: GameState, orders: readonly ManagementOrder[], ctx: TurnContext): void {
  for (const order of ordersOfKind(orders, "sell")) {
    const problem = validateManagement(state, ctx.data, order);
    if (problem) {
      reject(ctx, order, problem);
      continue;
    }
    const price = marketPrice(state, ctx.data, order.goodId) ?? 0;
    const income = sellGoods(state, ctx.data, order.factionId, order.goodId, order.quantity);
    const currency = ctx.data.goods.find((g) => g.id === order.goodId)?.saleCurrency ?? "dirty";
    ctx.report(
      "report.sales.sold",
      { quantity: order.quantity, goodKey: `good.${order.goodId}`, price, income, currencyKey: `currency.${currency}` },
      order.factionId,
    );
  }
}

/** Dirty → clean through legal businesses (GDD §8). Laundering over 70% of capacity draws the federals. */
export function resolveLaundering(state: GameState, orders: readonly ManagementOrder[], ctx: TurnContext): void {
  const { data } = ctx;
  const { laundering, ranges } = data.balance;
  const byFaction = new Map<string, number>();
  for (const order of ordersOfKind(orders, "launder")) {
    const problem = validateManagement(state, data, order);
    if (problem) {
      reject(ctx, order, problem);
      continue;
    }
    byFaction.set(order.factionId, (byFaction.get(order.factionId) ?? 0) + order.amount);
  }
  for (const [factionId, requested] of byFaction) {
    const faction = state.factions[factionId];
    const capacity = launderCapacity(state, data, factionId);
    if (!faction || capacity <= 0) continue;
    const amount = Math.min(requested, capacity, faction.money.dirty);
    faction.money.dirty -= amount;
    faction.money.clean += amount;
    const usage = amount / capacity;
    let federalAdded = 0;
    if (usage > laundering.federalAttentionCapacityRatio) {
      federalAdded = Math.round((usage - laundering.federalAttentionCapacityRatio) * laundering.federalPerExcess * 10) / 10;
      faction.federal = clamp(faction.federal + federalAdded, ranges.federalInvestigation);
    }
    ctx.report(
      federalAdded > 0 ? "report.laundering.too_much" : "report.laundering.done",
      { amount, capacity, percent: Math.round(usage * 100), limit: Math.round(laundering.federalAttentionCapacityRatio * 100) },
      factionId,
    );
  }
}

/** Recent supply fades each week, so prices recover (GDD §9). */
export function decayMarket(state: GameState, data: GameData): void {
  for (const [goodId, entry] of Object.entries(state.market)) {
    state.market[goodId] = { supply: Math.round(entry.supply * data.balance.market.supplyDecay * 100) / 100 };
  }
}


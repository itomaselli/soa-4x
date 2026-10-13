// Businesses (GDD §8): where they can be built, capacities, and small helpers shared by
// management, production, laundering, combat and the AI.

import type { BusinessDef, GameData } from "../../data/schemas";
import type { BusinessState, GameState } from "../state";
import { zoneOwner } from "./control";

export function businessDef(data: GameData, typeId: string): BusinessDef | undefined {
  return data.businesses.find((b) => b.id === typeId);
}

export function factionBusinesses(state: GameState, factionId: string): BusinessState[] {
  return state.businesses.filter((b) => b.ownerFactionId === factionId);
}

/** Businesses that work this week: not suspended for unpaid upkeep and not built this same week. */
export function workingBusinesses(state: GameState, factionId: string): BusinessState[] {
  return factionBusinesses(state, factionId).filter((b) => !b.suspended && b.builtWeek < state.week);
}

export function freeSlots(state: GameState, data: GameData, zoneId: string): number {
  const slots = data.zones.find((z) => z.id === zoneId)?.businessSlots ?? 0;
  return slots - state.businesses.filter((b) => b.zoneId === zoneId).length;
}

/** How many units of a good the faction can hold (warehouses). Goods without storage rules are unlimited. */
export function storageCapacity(state: GameState, data: GameData, factionId: string, goodId: string): number | null {
  const storing = data.businesses.filter((b) => b.storage?.goodId === goodId);
  if (storing.length === 0) return null;
  return factionBusinesses(state, factionId).reduce((sum, b) => {
    const def = businessDef(data, b.typeId);
    return sum + (def?.storage?.goodId === goodId ? def.storage.capacity : 0);
  }, 0);
}

export function launderCapacity(state: GameState, data: GameData, factionId: string): number {
  return workingBusinesses(state, factionId).reduce((sum, b) => sum + (businessDef(data, b.typeId)?.launderCapacity ?? 0), 0);
}

/**
 * Whether a faction can build a business type in a zone (GDD §8): it must own the zone, have a free slot
 * and enough clean money. Returns a strings.es.json key or null.
 */
export function buildProblem(state: GameState, data: GameData, factionId: string, typeId: string, zoneId: string): string | null {
  const def = businessDef(data, typeId);
  const zone = state.zones[zoneId];
  if (!def) return "build_error.unknown_type";
  if (!zone) return "build_error.unknown_zone";
  if (zoneOwner(zone, data.balance) !== factionId) return "build_error.not_owner";
  if (freeSlots(state, data, zoneId) <= 0) return "build_error.no_slot";
  if ((state.factions[factionId]?.money.clean ?? 0) < def.buildCost) return "build_error.no_money";
  return null;
}

/** Builds without checks (call buildProblem first). Pays with clean money. Returns the new business. */
export function addBusiness(state: GameState, data: GameData, factionId: string, typeId: string, zoneId: string): BusinessState {
  const def = businessDef(data, typeId);
  const faction = state.factions[factionId];
  if (faction && def) faction.money.clean -= def.buildCost;
  state.businessSerial += 1;
  const business: BusinessState = {
    id: `biz_${state.businessSerial}`,
    typeId,
    zoneId,
    ownerFactionId: factionId,
    raidWarned: false,
    builtWeek: state.week,
    suspended: false,
    workCapacity: 0,
  };
  state.businesses.push(business);
  return business;
}

// Plain data for the interface, computed from GameState with the sim's own query functions.
// No DOM here, so it's testable in Node.

import type { GameData } from "../data/schemas";
import type { MapViewModel } from "../render/map";
import { reachableZones } from "../sim/orders";
import { RANKS, type GameState, type MemberState } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { factionMembers } from "../sim/systems/members";

export function mapViewModel(state: GameState, data: GameData, viewer: string, selectedZoneId: string | null): MapViewModel {
  const reachable = new Set(reachableZones(state, data, viewer));
  const { colors } = data.ui;
  const zones: MapViewModel["zones"] = {};
  for (const def of data.zones) {
    const zone = state.zones[def.id];
    if (!zone) continue;
    const owner = zoneOwner(zone, data.balance);
    zones[def.id] = {
      borderColor: owner ? (data.factions.find((f) => f.id === owner)?.color ?? colors.neutral) : colors.neutral,
      glyph: def.glyph,
      glyphColor: colors.glyph,
      labelColor: reachable.has(def.id) ? colors.label : colors.labelDim,
      heatWarning: zone.heat >= data.balance.heat.patrolThreshold,
    };
  }
  return { zones, selectedZoneId };
}

export interface TopBarModel {
  week: number;
  factionName: string;
  clean: number;
  dirty: number;
  owned: number;
  totalZones: number;
  target: number;
  weeksHeld: number;
  streak: number;
  relations: { name: string; color: string; value: number }[];
}

export function topBarModel(state: GameState, data: GameData, viewer: string): TopBarModel {
  const faction = state.factions[viewer];
  return {
    week: state.week,
    factionName: data.factions.find((f) => f.id === viewer)?.name ?? viewer,
    clean: faction?.money.clean ?? 0,
    dirty: faction?.money.dirty ?? 0,
    owned: ownedZones(state, viewer, data.balance).length,
    totalZones: data.zones.length,
    target: data.balance.victory.zonesToControl,
    weeksHeld: data.balance.victory.weeksHeld,
    streak: state.controlStreaks[viewer] ?? 0,
    relations: data.factions
      .filter((f) => f.kind === "club" && f.id !== viewer)
      .map((f) => ({ name: f.name, color: f.color, value: state.factions[f.id]?.relations[viewer] ?? 0 })),
  };
}

export interface ZoneDetails {
  id: string;
  name: string;
  typeKey: string;
  wealth: number;
  policePresence: number;
  heat: number;
  patrols: boolean;
  businessSlots: number;
  owner: { name: string; color: string } | null;
  control: { name: string; color: string; value: number }[];
  freeControl: number;
  neighbors: { id: string; name: string }[];
  reachable: boolean;
}

export function zoneDetails(state: GameState, data: GameData, zoneId: string, viewer: string): ZoneDetails | null {
  const def = data.zones.find((z) => z.id === zoneId);
  const zone = state.zones[zoneId];
  if (!def || !zone) return null;
  const ownerId = zoneOwner(zone, data.balance);
  const owner = ownerId ? data.factions.find((f) => f.id === ownerId) : undefined;
  const control = data.factions
    .filter((f) => controlOf(zone, f.id) > 0)
    .map((f) => ({ name: f.name, color: f.color, value: controlOf(zone, f.id) }))
    .sort((a, b) => b.value - a.value);
  return {
    id: def.id,
    name: def.name,
    typeKey: `zone_type.${def.type}`,
    wealth: def.wealth,
    policePresence: zone.policePresence,
    heat: zone.heat,
    patrols: zone.heat >= data.balance.heat.patrolThreshold,
    businessSlots: def.businessSlots,
    owner: owner ? { name: owner.name, color: owner.color } : null,
    control,
    freeControl: data.balance.ranges.control.max - control.reduce((s, c) => s + c.value, 0),
    neighbors: def.adjacent.map((id) => ({ id, name: data.zones.find((z) => z.id === id)?.name ?? id })),
    reachable: reachableZones(state, data, viewer).includes(zoneId),
  };
}

/** Viewer's members, highest rank first. */
export function memberRows(state: GameState, viewer: string): MemberState[] {
  return factionMembers(state, viewer)
    .filter((m) => m.status !== "dead")
    .sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || a.name.localeCompare(b.name));
}

// Plain data for the interface, computed from GameState with the sim's own query functions.
// No DOM here, so it's testable in Node.

import type { GameData } from "../data/schemas";
import type { MapViewModel } from "../render/map";
import { reachableZones } from "../sim/orders";
import { RANKS, type GameState, type MemberState } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { chanceWithPresident, voters } from "../sim/systems/council";
import { diplomaticState, getStance } from "../sim/systems/diplomacy";
import { averageLoyalty } from "../sim/systems/loyalty";
import { factionMembers } from "../sim/systems/members";
import type { VoteType } from "../sim/state";

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
  relations: { name: string; color: string; value: number; stateKey: string }[];
  averageLoyalty: number | null;
  /** Weeks of unrest so far and the limit before a motion to remove the president. */
  unrestWeeks: number;
  unrestLimit: number;
  lowLoyalty: boolean;
  sheriffRelation: number;
  /** null while the federals are still invisible (GDD §12). */
  federal: number | null;
}

export function topBarModel(state: GameState, data: GameData, viewer: string): TopBarModel {
  const faction = state.factions[viewer];
  const avg = averageLoyalty(state, viewer);
  const sheriff = data.factions.find((f) => f.kind === "sheriff")?.id;
  const federal = faction?.federal ?? 0;
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
      .map((f) => ({
        name: f.name,
        color: f.color,
        value: state.factions[f.id]?.relations[viewer] ?? 0,
        stateKey: `diplomacy.${diplomaticState(state, viewer, f.id, data.balance)}`,
      })),
    averageLoyalty: avg === null ? null : Math.round(avg),
    unrestWeeks: faction?.lowLoyaltyWeeks ?? 0,
    unrestLimit: data.balance.council.impeachmentWeeks,
    lowLoyalty: avg !== null && avg < data.balance.council.impeachmentAverageLoyalty,
    sheriffRelation: sheriff ? (state.factions[sheriff]?.relations[viewer] ?? 0) : 0,
    federal: federal >= data.balance.federal.visibleFrom ? Math.round(federal) : null,
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

export interface VotePreview {
  name: string;
  /** Chance of voting with the president, 0–100. */
  chance: number;
  fixed: "yes" | "no" | null;
}

/** How each member at the table is likely to vote (GDD pillar 4: readable decisions). */
export function votePreview(state: GameState, data: GameData, viewer: string, type: VoteType, targetMemberId?: string): VotePreview[] {
  return voters(state, viewer).map((m) => ({
    name: m.nickname || m.name,
    chance: Math.round(chanceWithPresident(m, type, state, data) * 100),
    fixed: m.id === targetMemberId ? (type === "promote" ? "yes" : type === "expel" ? "no" : null) : null,
  }));
}

export interface DiplomacyRow {
  id: string;
  name: string;
  color: string;
  stateKey: string;
  /** Weeks left of a truce, if any. */
  truceWeeksLeft: number | null;
  /** Weeks since war was declared, if at war. */
  warWeeks: number | null;
}

export function diplomacyRows(state: GameState, data: GameData, viewer: string): DiplomacyRow[] {
  return data.factions
    .filter((f) => f.kind === "club" && f.id !== viewer)
    .map((f) => {
      const stance = getStance(state, viewer, f.id);
      return {
        id: f.id,
        name: f.name,
        color: f.color,
        stateKey: `diplomacy.${diplomaticState(state, viewer, f.id, data.balance)}`,
        truceWeeksLeft: stance?.type === "truce" ? data.balance.council.truceWeeks - (state.week - stance.sinceWeek) : null,
        warWeeks: stance?.type === "war" ? state.week - stance.sinceWeek : null,
      };
    });
}

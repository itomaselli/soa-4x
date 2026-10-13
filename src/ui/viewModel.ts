// Plain data for the interface, computed from GameState with the sim's own query functions.
// No DOM here, so it's testable in Node.

import type { GameData } from "../data/schemas";
import type { LocalViewModel, MapViewModel, RenderMode } from "../render/map";
import { reachableZones } from "../sim/orders";
import { RANKS, type GameState, type MemberState } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { chanceWithPresident, voters } from "../sim/systems/council";
import { diplomaticState, getStance } from "../sim/systems/diplomacy";
import { averageLoyalty } from "../sim/systems/loyalty";
import { factionMembers } from "../sim/systems/members";
import { cartelId } from "../sim/management";
import { businessAtLot, buildProblem, businessDef, freeSlots, launderCapacity, storageCapacity } from "../sim/systems/businesses";
import { marketPrice } from "../sim/systems/economy";
import { canAfford } from "../sim/systems/events";
import type { VoteType } from "../sim/state";

export function mapViewModel(
  state: GameState,
  data: GameData,
  viewer: string,
  selectedZoneId: string | null,
  plannedZoneIds: readonly string[] = [],
  mode: RenderMode = "tiles",
  local: LocalViewModel | null = null,
): MapViewModel {
  const planned = new Set(plannedZoneIds);
  const reachable = new Set(reachableZones(state, data, viewer));
  const { colors } = data.ui;
  const zones: MapViewModel["zones"] = {};
  for (const def of data.zones) {
    const zone = state.zones[def.id];
    if (!zone) continue;
    const owner = zoneOwner(zone, data.balance);
    zones[def.id] = {
      ownerColor: owner ? (data.factions.find((f) => f.id === owner)?.color ?? null) : null,
      glyph: def.glyph,
      spriteId: `zone_type.${def.type}`,
      glyphColor: planned.has(def.id) ? colors.planned : data.ui.zoneTypeColors[def.type] ?? colors.glyph,
      businesses: state.businesses
        .filter((b) => b.zoneId === def.id)
        .slice(0, 3)
        .map((b) => ({
          glyph: businessDef(data, b.typeId)?.glyph ?? "?",
          spriteId: `business.${b.typeId}`,
          color: data.factions.find((f) => f.id === b.ownerFactionId)?.color ?? colors.neutral,
        })),
      labelColor: reachable.has(def.id) ? colors.label : colors.labelDim,
      heatWarning: zone.heat >= data.balance.heat.patrolThreshold,
    };
  }
  return { zones, selectedZoneId, mode, local };
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

export interface BusinessRow {
  id: string;
  typeKey: string;
  zone: string;
  statusKey: string;
  legal: boolean;
}

export function businessRows(state: GameState, data: GameData, viewer: string): BusinessRow[] {
  return state.businesses
    .filter((b) => b.ownerFactionId === viewer)
    .map((b) => ({
      id: b.id,
      typeKey: `business.${b.typeId}`,
      zone: data.zones.find((z) => z.id === b.zoneId)?.name ?? b.zoneId,
      statusKey: b.suspended ? "ui.biz.suspended" : b.builtWeek >= state.week ? "ui.biz.new" : "ui.biz.working",
      legal: businessDef(data, b.typeId)?.legal ?? true,
    }));
}

export interface GoodRow {
  id: string;
  nameKey: string;
  stock: number;
  /** null if it can't be sold directly. */
  price: number | null;
  currencyKey: string | null;
  /** Drugs: sold on the street by members, not from this panel. */
  streetOnly: boolean;
}

export function goodRows(state: GameState, data: GameData, viewer: string): GoodRow[] {
  return data.goods.map((g) => ({
    id: g.id,
    nameKey: `good.${g.id}`,
    stock: state.factions[viewer]?.stock[g.id] ?? 0,
    price: marketPrice(state, data, g.id),
    currencyKey: g.saleCurrency ? `currency.${g.saleCurrency}` : null,
    streetOnly: g.streetOnly,
  }));
}

/** Zones where the viewer can build (owned, with free slots). */
export function buildableZones(state: GameState, data: GameData, viewer: string): string[] {
  return ownedZones(state, viewer, data.balance).filter((z) => freeSlots(state, data, z) > 0);
}

export interface LaunderingInfo {
  capacity: number;
  /** Most that can be laundered without drawing federal attention. */
  safe: number;
}

export function launderingInfo(state: GameState, data: GameData, viewer: string): LaunderingInfo {
  const capacity = launderCapacity(state, data, viewer);
  return { capacity, safe: Math.floor(capacity * data.balance.laundering.federalAttentionCapacityRatio) };
}

export interface CartelInfo {
  cartelId: string | null;
  dealing: boolean;
  /** What the cartel sells: price and free storage space we have for it. */
  catalog: { goodId: string; nameKey: string; price: number; space: number }[];
  /** Weeks left to buy before the cartel considers the deal broken. */
  weeksLeft: number | null;
}

export function cartelInfo(state: GameState, data: GameData, viewer: string): CartelInfo {
  const cartel = cartelId(data);
  const stance = cartel ? getStance(state, viewer, cartel) : null;
  const dealing = stance?.type === "deal";
  return {
    cartelId: cartel,
    dealing,
    catalog: Object.entries(data.balance.cartel.catalog).map(([goodId, price]) => ({
      goodId,
      nameKey: `good.${goodId}`,
      price,
      space: Math.max(0, (storageCapacity(state, data, viewer, goodId) ?? 0) - (state.factions[viewer]?.stock[goodId] ?? 0)),
    })),
    weeksLeft: dealing ? data.balance.cartel.graceWeeks - (state.week - (stance?.lastPurchaseWeek ?? stance?.sinceWeek ?? state.week)) : null,
  };
}

export interface EventView {
  instanceId: string;
  titleKey: string;
  textKey: string;
  subject: string;
  options: { id: string; labelKey: string; affordable: boolean; isDefault: boolean }[];
}

export function pendingEventViews(state: GameState, data: GameData, viewer: string): EventView[] {
  return state.pendingEvents
    .filter((e) => e.factionId === viewer)
    .map((e) => {
      const def = data.events.find((d) => d.id === e.eventId);
      const subject = e.subjectMemberId ? state.members[e.subjectMemberId] : undefined;
      return {
        instanceId: e.instanceId,
        titleKey: `event.${e.eventId}.title`,
        textKey: `event.${e.eventId}.text`,
        subject: subject ? `${subject.nickname} (${subject.name})` : "",
        options: (def?.options ?? []).map((o) => ({
          id: o.id,
          labelKey: `event.${e.eventId}.option.${o.id}`,
          affordable: def ? canAfford(state, viewer, def, o.id) : false,
          isDefault: def?.defaultOption === o.id,
        })),
      };
    });
}

/** Businesses in a zone, for the zone panel. */
export function zoneBusinesses(state: GameState, data: GameData, zoneId: string): { typeKey: string; owner: string; color: string }[] {
  return state.businesses
    .filter((b) => b.zoneId === zoneId)
    .map((b) => {
      const owner = data.factions.find((f) => f.id === b.ownerFactionId);
      return { typeKey: `business.${b.typeId}`, owner: owner?.name ?? b.ownerFactionId, color: owner?.color ?? data.ui.colors.neutral };
    });
}

export interface ZoneTooltip {
  name: string;
  typeKey: string;
  owner: { name: string; color: string } | null;
  ourControl: number;
  heat: number;
  patrols: boolean;
  businesses: number;
}

/** Short summary for the hover tooltip on the map. */
export function zoneTooltip(state: GameState, data: GameData, zoneId: string, viewer: string): ZoneTooltip | null {
  const d = zoneDetails(state, data, zoneId, viewer);
  if (!d) return null;
  return {
    name: d.name,
    typeKey: d.typeKey,
    owner: d.owner,
    ourControl: state.zones[zoneId]?.control[viewer] ?? 0,
    heat: d.heat,
    patrols: d.patrols,
    businesses: state.businesses.filter((b) => b.zoneId === zoneId).length,
  };
}

/** What the zoomed-in map shows for a district: its lots and our members working there this week. */
export function localViewModel(
  state: GameState,
  data: GameData,
  viewer: string,
  zoneId: string,
  selectedLot: number | null,
  plannedZoneIds: readonly string[],
): LocalViewModel {
  const def = data.zones.find((z) => z.id === zoneId);
  const zone = state.zones[zoneId];
  const ownsZone = zone ? zoneOwner(zone, data.balance) === viewer : false;
  const memberColor = data.factions.find((f) => f.id === viewer)?.color ?? data.ui.colors.glyph;
  return {
    zoneId,
    lots: Array.from({ length: def?.businessSlots ?? 0 }, (_, index) => {
      const business = businessAtLot(state, zoneId, index);
      return {
        index,
        business: business
          ? {
              glyph: businessDef(data, business.typeId)?.glyph ?? "?",
              spriteId: `business.${business.typeId}`,
              color: data.factions.find((f) => f.id === business.ownerFactionId)?.color ?? data.ui.colors.neutral,
            }
          : null,
        buildable: !business && ownsZone,
        selected: selectedLot === index,
      };
    }),
    members: plannedZoneIds.filter((z) => z === zoneId).map(() => ({ color: memberColor })),
  };
}

export interface LotDetails {
  zoneId: string;
  lot: number;
  business: { typeKey: string; owner: string; color: string; ours: boolean; statusKey: string } | null;
  /** Business types we could put here, with the problem (strings key) if we can't right now. */
  options: { typeId: string; nameKey: string; legal: boolean; cost: number; problem: string | null }[];
}

export function lotDetails(state: GameState, data: GameData, viewer: string, zoneId: string, lot: number): LotDetails {
  const business = businessAtLot(state, zoneId, lot);
  const owner = business ? data.factions.find((f) => f.id === business.ownerFactionId) : undefined;
  return {
    zoneId,
    lot,
    business: business
      ? {
          typeKey: `business.${business.typeId}`,
          owner: owner?.name ?? business.ownerFactionId,
          color: owner?.color ?? data.ui.colors.neutral,
          ours: business.ownerFactionId === viewer,
          statusKey: business.suspended ? "ui.biz.suspended" : business.builtWeek >= state.week ? "ui.biz.new" : "ui.biz.working",
        }
      : null,
    options: business
      ? []
      : data.businesses.map((b) => ({
          typeId: b.id,
          nameKey: `business.${b.id}`,
          legal: b.legal,
          cost: b.buildCost,
          problem: buildProblem(state, data, viewer, b.id, zoneId, lot),
        })),
  };
}

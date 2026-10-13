// Plain data for the interface, computed from GameState with the sim's own query functions.
// No DOM here, so it's testable in Node.

import type { GameData } from "../data/schemas";
import type { LocalViewModel, MapViewModel, MarkerLook, RenderMode } from "../render/map";
import type { ReportEntry } from "../sim/report";
import { reachableZones } from "../sim/orders";
import { RANKS, STAT_KEYS, type GameState, type MemberState, type StatKey } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { chanceWithPresident, voters } from "../sim/systems/council";
import { diplomaticState, getStance } from "../sim/systems/diplomacy";
import { averageLoyalty } from "../sim/systems/loyalty";
import { factionMembers, livingMembers } from "../sim/systems/members";
import { levelFor, maxPerks, nextLevelXp } from "../sim/systems/perks";
import { cartelId, cartelPrice } from "../sim/management";
import { businessAtLot, buildProblem, businessDef, freeSlots, launderCapacity, storageCapacity, workingBusinesses } from "../sim/systems/businesses";
import { marketPrice } from "../sim/systems/economy";
import { canAfford, eventZone } from "../sim/systems/events";
import type { VoteType } from "../sim/state";

/** What feeds the political map's markers besides the state: this week's orders and last week's report. */
export interface MarkerSources {
  plannedTasks?: readonly { taskId: string; zoneId: string }[];
  lastReport?: readonly ReportEntry[];
}

const COMBAT_REPORT_KEYS = new Set(["report.combat.attacker_won", "report.combat.defender_won"]);

function markerLook(data: GameData, spriteId: string): MarkerLook {
  return { spriteId, glyph: data.ui.tileset.glyphs[spriteId] ?? "?", color: data.ui.markers.colors[spriteId] ?? data.ui.colors.label };
}

/**
 * Markers per district, in priority order: deaths and fights from last week's combats, raids the sheriff warned
 * us about, then our planned tasks (attack, gun run, collecting money). At most ui.markers.max each, no repeats.
 */
export function zoneMarkers(state: GameState, data: GameData, viewer: string, sources: MarkerSources = {}): Record<string, MarkerLook[]> {
  const ids: Record<string, string[]> = {};
  const add = (zoneId: string, spriteId: string) => {
    const list = (ids[zoneId] ??= []);
    if (!list.includes(spriteId)) list.push(spriteId);
  };
  for (const entry of sources.lastReport ?? []) {
    if (!COMBAT_REPORT_KEYS.has(entry.key) || typeof entry.params.zoneId !== "string") continue;
    if (Number(entry.params.deaths) > 0) add(entry.params.zoneId, "marker.death");
    add(entry.params.zoneId, "marker.combat");
  }
  for (const b of state.businesses) if (b.ownerFactionId === viewer && b.raidWarned) add(b.zoneId, "marker.raid_warned");
  for (const task of sources.plannedTasks ?? []) {
    const marker = data.ui.markers.tasks[task.taskId];
    if (marker) add(task.zoneId, marker);
  }
  return Object.fromEntries(Object.entries(ids).map(([zoneId, list]) => [zoneId, list.slice(0, data.ui.markers.max).map((id) => markerLook(data, id))]));
}

/** Face for the club's average loyalty, shown on its headquarters (first threshold reached). */
export function moodMarker(state: GameState, data: GameData, factionId: string): MarkerLook | null {
  const avg = averageLoyalty(state, factionId);
  if (avg === null) return null;
  const step = [...data.ui.markers.mood].sort((a, b) => b.min - a.min).find((m) => avg >= m.min);
  return step ? markerLook(data, step.sprite) : null;
}

export function mapViewModel(
  state: GameState,
  data: GameData,
  viewer: string,
  selectedZoneId: string | null,
  plannedZoneIds: readonly string[] = [],
  mode: RenderMode = "tiles",
  local: LocalViewModel | null = null,
  sources: MarkerSources = {},
): MapViewModel {
  const markers = zoneMarkers(state, data, viewer, sources);
  const hqZoneId = data.factions.find((f) => f.id === viewer)?.hqZoneId ?? null;
  const mood = moodMarker(state, data, viewer);
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
      ownerPatchId: owner ? (data.factions.find((f) => f.id === owner)?.patchId ?? null) : null,
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
      markers: markers[def.id] ?? [],
      mood: def.id === hqZoneId ? mood : null,
    };
  }
  return { zones, selectedZoneId, mode, local };
}

export interface TopBarModel {
  week: number;
  factionName: string;
  patchId: string | null;
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
    patchId: data.factions.find((f) => f.id === viewer)?.patchId ?? null,
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

/** Everything the member sheet shows (window opened from a row of the Club tab). */
export interface MemberSheet {
  member: MemberState;
  /** Patch on the vest: the club's current patch. */
  patchId: string | null;
  stats: { key: StatKey; value: number; max: number }[];
  loyalty: { value: number; max: number; low: boolean };
  likes: string[];
  dislikes: string[];
  /** Order planned this week, if any. */
  plan: { taskId: string; zoneId: string | null } | null;
  /** Phase 13: experience and specialties. */
  level: number;
  xp: number;
  /** Experience for the next level, or null at the top. */
  nextXp: number | null;
  perks: { id: string; stat: StatKey }[];
  maxPerks: number;
  scars: { id: string; stat: StatKey }[];
  /** Specialties on offer after a level-up (empty = none). */
  options: { id: string; stat: StatKey }[];
  /** A level earned but no room at this rank. */
  rankFull: boolean;
  /** Tasks that use each stat (tasks.json) and specialties built on it. */
  statUses: { key: StatKey; taskIds: string[]; perkIds: string[] }[];
}

export function memberSheet(
  state: GameState,
  data: GameData,
  memberId: string,
  plan: { taskId: string; zoneId: string | null } | null,
): MemberSheet | null {
  const member = state.members[memberId];
  if (!member) return null;
  const { ranges } = data.balance;
  const affinity = data.traits.tasks[member.trait];
  return {
    member,
    patchId: data.factions.find((f) => f.id === member.factionId)?.patchId ?? null,
    stats: STAT_KEYS.map((key) => ({ key, value: member.stats[key], max: ranges.stat.max })),
    loyalty: { value: member.loyalty, max: ranges.loyalty.max, low: member.loyalty < data.balance.club.lowLoyaltyThreshold },
    likes: affinity?.likes ?? [],
    dislikes: affinity?.dislikes ?? [],
    plan,
    level: levelFor(data, member.xp),
    xp: member.xp,
    nextXp: nextLevelXp(data, member.xp),
    perks: member.perks.map((id) => ({ id, stat: data.perks.perks.find((p) => p.id === id)?.stat ?? "strength" })),
    maxPerks: maxPerks(data, member),
    scars: member.scars.map((id) => ({ id, stat: data.perks.scars.list.find((x) => x.id === id)?.stat ?? "strength" })),
    options: member.perkOptions.map((id) => ({ id, stat: data.perks.perks.find((p) => p.id === id)?.stat ?? "strength" })),
    rankFull: levelFor(data, member.xp) > member.perks.length && member.perks.length >= maxPerks(data, member),
    statUses: STAT_KEYS.map((key) => ({
      key,
      taskIds: data.tasks.filter((t) => t.enabled && t.stat === key).map((t) => t.id),
      perkIds: data.perks.perks.filter((p) => p.stat === key).map((p) => p.id),
    })),
  };
}

export interface VotePreview {
  memberId: string;
  name: string;
  /** Chance of voting with the president, 0–100. */
  chance: number;
  fixed: "yes" | "no" | null;
}

/** How each member at the table is likely to vote (GDD pillar 4: readable decisions). */
export function votePreview(state: GameState, data: GameData, viewer: string, type: VoteType, targetMemberId?: string): VotePreview[] {
  return voters(state, viewer).map((m) => ({
    memberId: m.id,
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
  typeId: string;
  typeKey: string;
  zoneId: string;
  zone: string;
  lot: number;
  statusKey: string;
  legal: boolean;
  maintenance: number;
}

export function businessRows(state: GameState, data: GameData, viewer: string): BusinessRow[] {
  return state.businesses
    .filter((b) => b.ownerFactionId === viewer)
    .map((b) => ({
      id: b.id,
      typeId: b.typeId,
      typeKey: `business.${b.typeId}`,
      zoneId: b.zoneId,
      zone: data.zones.find((z) => z.id === b.zoneId)?.name ?? b.zoneId,
      lot: b.lot,
      statusKey: b.suspended ? "ui.biz.suspended" : b.builtWeek >= state.week ? "ui.biz.new" : "ui.biz.working",
      legal: businessDef(data, b.typeId)?.legal ?? true,
      maintenance: businessDef(data, b.typeId)?.maintenance ?? 0,
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

export interface LaunderingPanel extends LaunderingInfo {
  /** Percent of capacity that's safe (from balance.json). */
  safePercent: number;
  /** What each of our businesses adds; legal ones that aren't working this week add 0 and say why. */
  sources: { businessId: string; typeKey: string; zone: string; capacity: number; statusKey: string }[];
  dirty: number;
  /** Amount already queued to launder this week. */
  queued: number;
}

/** Laundering panel: total capacity, the safe threshold and what each legal business contributes (GDD §8). */
export function launderingPanel(state: GameState, data: GameData, viewer: string, management: readonly { kind: string; amount?: number }[]): LaunderingPanel {
  const info = launderingInfo(state, data, viewer);
  const working = new Set(workingBusinesses(state, viewer).map((b) => b.id));
  const sources = state.businesses
    .filter((b) => b.ownerFactionId === viewer && (businessDef(data, b.typeId)?.launderCapacity ?? 0) > 0)
    .map((b) => ({
      businessId: b.id,
      typeKey: `business.${b.typeId}`,
      zone: data.zones.find((z) => z.id === b.zoneId)?.name ?? b.zoneId,
      capacity: working.has(b.id) ? (businessDef(data, b.typeId)?.launderCapacity ?? 0) : 0,
      statusKey: b.suspended ? "ui.biz.suspended" : b.builtWeek >= state.week ? "ui.biz.new" : "ui.biz.working",
    }));
  return {
    ...info,
    safePercent: Math.round(data.balance.laundering.federalAttentionCapacityRatio * 100),
    sources,
    dirty: state.factions[viewer]?.money.dirty ?? 0,
    queued: management.reduce((sum, o) => sum + (o.kind === "launder" ? (o.amount ?? 0) : 0), 0),
  };
}

/** Club headquarters (club_hq): an identity and a place, not a business. Only what the game already knows. */
export interface HqSheet {
  factionName: string;
  patchId: string | null;
  color: string;
  zoneId: string;
  zoneName: string;
  zoneTypeKey: string;
  ourControl: number;
  owner: { name: string; color: string } | null;
  /** Living members and the club's member cap (recruiting stops at the cap). */
  members: number;
  memberCap: number;
  /** Businesses we own in the headquarters district. */
  businesses: number;
}

export function hqSheet(state: GameState, data: GameData, viewer: string): HqSheet | null {
  const faction = data.factions.find((f) => f.id === viewer);
  const zoneId = faction?.hqZoneId;
  const def = zoneId ? data.zones.find((z) => z.id === zoneId) : undefined;
  const zone = zoneId ? state.zones[zoneId] : undefined;
  if (!faction || !def || !zone) return null;
  const ownerId = zoneOwner(zone, data.balance);
  const owner = ownerId ? data.factions.find((f) => f.id === ownerId) : undefined;
  return {
    factionName: faction.name,
    patchId: faction.patchId,
    color: faction.color,
    zoneId: def.id,
    zoneName: def.name,
    zoneTypeKey: `zone_type.${def.type}`,
    ourControl: controlOf(zone, viewer),
    owner: owner ? { name: owner.name, color: owner.color } : null,
    members: livingMembers(state, viewer).length,
    memberCap: data.balance.club.memberCap,
    businesses: state.businesses.filter((b) => b.ownerFactionId === viewer && b.zoneId === def.id).length,
  };
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
    catalog: Object.keys(data.balance.cartel.catalog).map((goodId) => ({
      goodId,
      nameKey: `good.${goodId}`,
      price: cartelPrice(state, data, viewer, goodId),
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
  /** Text parameters: the rival club and the zone the event happens in, when it has them. */
  rival: string;
  zone: string;
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
        rival: e.rivalFactionId ? (data.factions.find((f) => f.id === e.rivalFactionId)?.name ?? "") : "",
        zone: eventPlace(data, e.factionId, def),
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
        sign: business ? businessDef(data, business.typeId)?.bar !== undefined : false,
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

/** Name of the first zone an event's effects point to (e.g. "the road nearest to our HQ"), for its text. */
function eventPlace(data: GameData, factionId: string, def: GameData["events"][number] | undefined): string {
  type Effect = GameData["events"][number]["options"][number]["effects"][number];
  const find = (effects: readonly Effect[]): string | null => {
    for (const fx of effects) {
      if (fx.type === "heat") return eventZone(data, factionId, fx);
      if (fx.type === "chance") return find(fx.success) ?? find(fx.failure);
    }
    return null;
  };
  for (const option of def?.options ?? []) {
    const zoneId = find(option.effects);
    if (zoneId) return data.zones.find((z) => z.id === zoneId)?.name ?? "";
  }
  return "";
}

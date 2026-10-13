// Text formatting for the terminal: turns GameState and ReportEntry[] into Spanish text.
// Pure functions (no I/O) so they can be tested.

import type { GameData } from "../data/schemas";
import { reachableZones } from "../sim/orders";
import { TURN_STAGES, type ReportEntry } from "../sim/report";
import { RANKS, type GameState, type MemberState } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { factionMembers } from "../sim/systems/members";
import { t } from "../ui/strings";

/** Params whose name ends in "Key" are strings.es.json keys and get translated too. */
export function formatEntry(entry: ReportEntry, data: GameData): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(entry.params)) {
    params[name] = name.endsWith("Key") && typeof value === "string" ? t(data.strings, value) : value;
  }
  return t(data.strings, entry.key, params);
}

/** Report grouped by stage, showing only public entries and the viewer's own. */
export function formatReport(report: readonly ReportEntry[], data: GameData, viewerFactionId: string): string[] {
  const visible = report.filter((e) => e.factionId === null || e.factionId === viewerFactionId);
  const lines: string[] = [];
  for (const stage of TURN_STAGES) {
    const entries = visible.filter((e) => e.stage === stage);
    if (entries.length === 0) continue;
    lines.push(`[${t(data.strings, `report.stage.${stage}`)}]`);
    for (const entry of entries) lines.push(`  ${formatEntry(entry, data)}`);
  }
  return lines;
}

export function sortedMembers(state: GameState, factionId: string): MemberState[] {
  return factionMembers(state, factionId).sort(
    (a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || a.name.localeCompare(b.name),
  );
}

export function formatMember(member: MemberState, data: GameData): string {
  const s = data.strings;
  const status = t(s, `status.${member.status}`);
  return t(s, "play.member_line", {
    nickname: member.nickname || member.name,
    name: member.name,
    rank: t(s, `rank.${member.rank}`),
    trait: t(s, `trait.${member.trait}`),
    ...member.stats,
    loyalty: member.loyalty,
    status: member.statusWeeks > 0 ? t(s, "play.member_status_weeks", { status, weeks: member.statusWeeks }) : status,
  });
}

export function formatZone(state: GameState, data: GameData, zoneId: string, index: number, viewer: string): string {
  const s = data.strings;
  const zone = state.zones[zoneId];
  const def = data.zones.find((z) => z.id === zoneId);
  if (!zone || !def) return zoneId;
  const controlParts = data.factions
    .filter((f) => controlOf(zone, f.id) > 0)
    .map((f) => `${f.name} ${controlOf(zone, f.id)}`);
  const owner = zoneOwner(zone, data.balance);
  const ownerText =
    owner === null
      ? ""
      : owner === viewer
        ? t(s, "play.zone_owner_you")
        : t(s, "play.zone_owner_other", { owner: data.factions.find((f) => f.id === owner)?.name ?? owner });
  return t(s, "play.zone_line", {
    index,
    name: def.name,
    type: t(s, `zone_type.${def.type}`),
    wealth: def.wealth,
    police: zone.policePresence,
    heat: zone.heat,
    control: controlParts.length > 0 ? controlParts.join(" · ") : t(s, "play.zone_no_control"),
    owner: ownerText,
  });
}

/** Header, money, territory, stock, reachable zones and members. */
export function formatStatus(state: GameState, data: GameData, viewer: string): string[] {
  const s = data.strings;
  const faction = state.factions[viewer];
  const factionDef = data.factions.find((f) => f.id === viewer);
  if (!faction || !factionDef) return [];
  const stockItems = Object.entries(faction.stock).filter(([, n]) => n > 0);
  const lines = [
    t(s, "play.header", { week: state.week, faction: factionDef.name }),
    t(s, "play.money", { clean: faction.money.clean, dirty: faction.money.dirty }),
    t(s, "play.territory", {
      owned: ownedZones(state, viewer, data.balance).length,
      total: data.zones.length,
      target: data.balance.victory.zonesToControl,
      weeks: data.balance.victory.weeksHeld,
      streak: state.controlStreaks[viewer] ?? 0,
    }),
    stockItems.length > 0
      ? t(s, "play.stock", { items: stockItems.map(([id, n]) => `${t(s, `good.${id}`)} ×${n}`).join(", ") })
      : t(s, "play.stock_empty"),
    "",
    t(s, "play.zones_title"),
    ...reachableZones(state, data, viewer).map((id, i) => `  ${formatZone(state, data, id, i + 1, viewer)}`),
    "",
    t(s, "play.members_title"),
    ...sortedMembers(state, viewer).map((m) => `  ${formatMember(m, data)}`),
  ];
  return lines;
}

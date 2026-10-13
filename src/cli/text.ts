// Text formatting for the terminal: turns GameState and ReportEntry[] into Spanish text.
// Pure functions (no I/O) so they can be tested.

import type { GameData } from "../data/schemas";
import { reachableZones } from "../sim/orders";
import { RANKS, type GameState, type MemberState } from "../sim/state";
import { controlOf, ownedZones, zoneOwner } from "../sim/systems/control";
import { factionMembers } from "../sim/systems/members";
import { t } from "../ui/strings";
import { topBarModel } from "../ui/viewModel";
import { withIdentities } from "../sim/identity";

export { formatEntry, formatReport } from "../ui/report";

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

/** Loyalty, sheriff and federal investigation, as the browser's top bar shows them. */
function statusLine(state: GameState, data: GameData, viewer: string): string {
  const m = topBarModel(state, data, viewer);
  return [
    m.averageLoyalty === null ? "" : t(data.strings, "ui.average_loyalty", { value: m.averageLoyalty }) + (m.unrestWeeks > 0 ? t(data.strings, "ui.unrest", { weeks: m.unrestWeeks, limit: m.unrestLimit }) : ""),
    t(data.strings, "ui.sheriff", { value: m.sheriffRelation }),
    m.federal === null ? t(data.strings, "ui.federal_hidden") : t(data.strings, "ui.federal", { value: m.federal }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Header, money, territory, stock, reachable zones and members. */
export function formatStatus(state: GameState, content: GameData, viewer: string): string[] {
  const data = withIdentities(content, state);
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
    statusLine(state, data, viewer),
    t(s, "play.relations", {
      items: data.factions
        .filter((f) => f.id !== viewer && f.kind === "club")
        .map((f) => t(s, "play.relation_item", { faction: f.name, value: state.factions[f.id]?.relations[viewer] ?? 0 }))
        .join(" · "),
    }),
    ...state.pendingEvents
      .filter((e) => e.factionId === viewer)
      .map((e) => t(s, "play.pending_event", { title: t(s, `event.${e.eventId}.title`) })),
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

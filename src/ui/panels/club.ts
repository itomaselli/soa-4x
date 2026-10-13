// Club view: compare and assign members. One task per active member (resting is fine); the destination is picked
// from the list or by clicking the map. Wounded and jailed members show when they're back. The headquarters card
// opens the "Sede del club" sheet (identity and place, not a business).

import { h } from "../dom";
import { illustration } from "../assets";
import { msg, zoneName, type UiContext } from "../context";
import { draftProblems, draftToOrders } from "../draft";
import { patchCanvas } from "../patchCanvas";
import { portraitCanvas } from "../portraitCanvas";
import { taskBlocker } from "../productionChains";
import { availableTasks, reachableZones } from "../../sim/orders";
import type { MemberState } from "../../sim/state";
import { hqSheet, memberRows, topBarModel } from "../viewModel";

function memberRow(ctx: UiContext, member: MemberState, problems: Record<string, string>, zones: string[]): HTMLElement {
  const { state, data, ui, tr, set, actions } = ctx;
  const entry = ui.draft[member.id];
  const active = member.status === "active";
  const status = tr(`status.${member.status}`);
  const statusText = member.statusWeeks > 0 ? tr("ui.club.back_in", { status, weeks: member.statusWeeks }) : status;
  const selected = ui.focusedMemberId === member.id;
  const lowLoyalty = member.loyalty < data.balance.club.lowLoyaltyThreshold;

  const taskSelect = h(
    "select",
    {
      disabled: !active,
      "aria-label": tr("ui.task_for", { member: member.nickname || member.name }),
      onchange: (e: Event) => {
        const taskId = (e.target as HTMLSelectElement).value;
        const draft = { ...ui.draft };
        if (taskId === "") delete draft[member.id];
        else {
          const keep = entry?.zoneId ?? (ui.selectedZoneId && zones.includes(ui.selectedZoneId) ? ui.selectedZoneId : null);
          draft[member.id] = { taskId, zoneId: keep };
        }
        set({ draft, focusedMemberId: taskId === "" ? null : member.id });
      },
    },
    [
      h("option", { value: "" }, [tr("ui.rest")]),
      ...availableTasks(data).map((id) => {
        const task = data.tasks.find((x) => x.id === id);
        const blocker = active ? taskBlocker(state, data, state.playerFactionId, id) : null;
        const label = task?.illegal ? tr("ui.task_illegal", { name: tr(`task.${id}`), heat: task.heat }) : tr(`task.${id}`);
        return h("option", { value: id, selected: id === entry?.taskId, title: blocker ? msg(data, blocker) : "" }, [blocker ? `${label} ${tr("ui.club.task_idle_mark")}` : label]);
      }),
    ],
  );
  const zoneSelect = h(
    "select",
    {
      disabled: !active || !entry,
      "aria-label": tr("ui.zone_for", { member: member.nickname || member.name }),
      onchange: (e: Event) => {
        const zoneId = (e.target as HTMLSelectElement).value || null;
        if (entry) set({ draft: { ...ui.draft, [member.id]: { ...entry, zoneId } }, ...(zoneId ? { selectedZoneId: zoneId } : {}) });
      },
    },
    [h("option", { value: "" }, [tr("ui.pick_zone")]), ...zones.map((id) => h("option", { value: id, selected: entry?.zoneId === id }, [zoneName(data, id)]))],
  );
  const problem = entry ? problems[member.id] : undefined;
  const blocker = entry && active ? taskBlocker(state, data, state.playerFactionId, entry.taskId) : null;

  return h("tr", { class: [selected ? "focused" : "", active ? "" : "inactive"].join(" ") }, [
    h("td", { class: "member-cell" }, [
      h("button", { class: "portrait-button", title: tr("ui.sheet.open"), "aria-label": tr("ui.sheet.open_for", { member: member.nickname || member.name }), onclick: () => set({ sheetMemberId: member.id }) }, [
        portraitCanvas(data, member, data.factions.find((f) => f.id === member.factionId)?.patchId ?? null, 2),
      ]),
      h("div", {}, [
        h("button", { class: "link strong", onclick: () => set({ sheetMemberId: member.id }) }, [member.nickname || member.name]),
        h("div", { class: "muted" }, [member.name]),
      ]),
    ]),
    h("td", {}, [tr(`rank.${member.rank}`), h("div", { class: "muted" }, [tr(`trait.${member.trait}`)])]),
    h("td", { class: active ? "" : "warn" }, [active ? status : statusText]),
    h("td", { class: "mono" }, [tr("ui.stats", { strength: member.stats.strength, cunning: member.stats.cunning, hands: member.stats.hands, charm: member.stats.charm })]),
    h("td", {}, [
      h("div", { class: lowLoyalty ? "bar low" : "bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": String(data.balance.ranges.loyalty.max), "aria-valuenow": String(Math.round(member.loyalty)), "aria-label": tr("ui.sheet.loyalty") }, [
        h("div", { class: "fill", style: `width:${Math.round((100 * member.loyalty) / data.balance.ranges.loyalty.max)}%` }),
      ]),
      h("span", { class: lowLoyalty ? "mono error" : "mono" }, [String(Math.round(member.loyalty)), lowLoyalty ? ` ${tr("ui.club.low")}` : ""]),
    ]),
    h("td", { class: "orders" }, [
      taskSelect,
      h("div", { class: "row" }, [
        zoneSelect,
        h("button", { class: "chip", disabled: !active || !entry, title: tr("ui.club.pick_on_map_hint"), onclick: () => actions.pickOnMap(member.id) }, [tr("ui.club.pick_on_map")]),
      ]),
      problem ? h("div", { class: "error" }, [tr(problem)]) : null,
      !problem && blocker ? h("div", { class: "warn-text" }, [msg(data, blocker)]) : null,
    ]),
  ]);
}

function hqCard(ctx: UiContext): HTMLElement | null {
  const { state, data, tr, set, actions } = ctx;
  const hq = hqSheet(state, data, state.playerFactionId);
  if (!hq) return null;
  return h("div", { class: "hq-summary" }, [
    illustration("club_hq", "medium", tr("ui.hq.title"), "H"),
    h("div", {}, [
      h("h3", {}, [tr("ui.hq.title")]),
      h("div", {}, [tr("ui.hq.district"), " ", h("strong", {}, [hq.zoneName])]),
      h("div", { class: "muted" }, [tr("ui.hq.control", { value: hq.ourControl }), " · ", tr("ui.hq.members", { members: hq.members, cap: hq.memberCap })]),
      h("div", { class: "row" }, [
        h("button", { onclick: () => set({ showHqSheet: true }) }, [tr("ui.hq.open")]),
        h("button", { class: "link", onclick: () => actions.enterZone(hq.zoneId) }, [tr("ui.hq.to_map")]),
      ]),
    ]),
  ]);
}

export function renderClub(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr } = ctx;
  const viewer = state.playerFactionId;
  const zones = reachableZones(state, data, viewer);
  const problems = draftProblems(ui.draft, state, data);
  const members = memberRows(state, viewer);
  const active = members.filter((m) => m.status === "active").length;
  const ready = draftToOrders(ui.draft).assignments.filter((a) => !(a.memberId in problems)).length;
  const me = topBarModel(state, data, viewer);
  return h("div", { class: "club-view" }, [
    h("div", { class: "club-top" }, [
      h("div", { class: "club-id club-header" }, [patchCanvas(data, me.patchId, 4, me.factionName), h("div", {}, [h("h2", {}, [me.factionName]), h("p", {}, [tr("ui.orders_ready", { ready, active })])])]),
      hqCard(ctx),
    ]),
    h("p", { class: "hint" }, [tr("ui.club.hint")]),
    h("div", { class: "table-scroll" }, [
      h("table", { class: "members" }, [
        h("thead", {}, [
          h(
            "tr",
            {},
            ["ui.col.member", "ui.col.rank", "ui.col.status", "ui.col.stats", "ui.col.loyalty", "ui.col.orders"].map((k) => h("th", { scope: "col" }, [tr(k)])),
          ),
        ]),
        h("tbody", {}, members.map((m) => memberRow(ctx, m, problems, zones))),
      ]),
    ]),
  ]);
}

// Condado view: the map (unchanged renderer) with an inspector on the right.
// County: the selected district's details, control, businesses, neighbours and our planned orders.
// District (zoomed in, "Condado > Distrito"): the selected lot, what's on it and what we could build there,
// with real costs and the concrete reason when we can't. Legal builds go to management; illegal ones to the council.

import { h } from "../dom";
import { illustration } from "../assets";
import { zoneName, type UiContext } from "../context";
import { patchCanvas } from "../patchCanvas";
import { portraitCanvas } from "../portraitCanvas";
import { hqSheet, lotDetails, memberRows, topBarModel, zoneBusinesses, zoneDetails } from "../viewModel";
import { draftProblems } from "../draft";

export function renderMapBar(ctx: UiContext): HTMLElement {
  const { ui, data, tr, actions } = ctx;
  if (!ui.localZoneId) return h("div", { class: "map-bar" }, [h("span", { class: "muted" }, [tr("ui.map.county_hint")])]);
  return h("div", { class: "map-bar" }, [
    h("button", { onclick: actions.leaveDistrict }, [tr("ui.map.back")]),
    h("nav", { class: "breadcrumb", "aria-label": tr("ui.map.breadcrumb") }, [
      h("button", { class: "link", onclick: actions.leaveDistrict }, [tr("ui.view.county")]),
      h("span", { "aria-hidden": "true" }, [" › "]),
      h("strong", { "aria-current": "page" }, [zoneName(data, ui.localZoneId)]),
    ]),
    h("span", { class: "muted" }, [tr("ui.map.local_hint")]),
  ]);
}

export function renderLegend(ctx: UiContext): HTMLElement {
  const { data, ui, tr, actions } = ctx;
  const { colors } = data.ui;
  const sw = (color: string, ch: string) => h("span", { class: "mono", style: `color:${color}` }, [ch]);
  const toggle = h("button", { class: "chip", onclick: actions.toggleRenderMode }, [tr(ui.renderMode === "tiles" ? "ui.legend.to_ascii" : "ui.legend.to_tiles")]);
  if (ui.localZoneId) {
    return h("div", { class: "legend" }, [
      h("span", {}, [sw(data.ui.localMap.colors.lot ?? colors.selected, "[+]"), " ", tr("ui.legend.lot_free")]),
      h("span", {}, [sw(colors.selected, "> v"), " ", tr("ui.legend.exits")]),
      h("span", {}, [sw(data.ui.localMap.colors.member ?? colors.glyph, "@"), " ", tr("ui.legend.members_here")]),
      toggle,
    ]);
  }
  return h("div", { class: "legend" }, [
    ...data.factions.filter((f) => f.kind === "club" || f.kind === "cartel").map((f) => h("span", {}, [sw(f.color, "##"), " ", f.name])),
    h("span", {}, [sw(colors.border.open, "· ·"), " ", tr("ui.legend.border_open")]),
    h("span", {}, [sw(colors.border.closed, "==="), " ", tr("ui.legend.border_closed")]),
    h("span", {}, [sw(colors.planned, "*"), " ", tr("ui.legend.planned")]),
    h("span", {}, [sw(colors.heat, "!"), " ", tr("ui.legend.patrols")]),
    toggle,
  ]);
}

function section(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return h("section", { class: "inspector-section" }, [h("h3", {}, [title]), ...children]);
}

function controlBars(ctx: UiContext, zoneId: string): HTMLElement[] {
  const d = zoneDetails(ctx.state, ctx.data, zoneId, ctx.state.playerFactionId);
  if (!d) return [];
  return [
    ...d.control.map((c) =>
      h("div", { class: "bar-row" }, [
        h("span", { class: "bar-label" }, [c.name]),
        h("span", { class: "bar" }, [h("span", { class: "bar-fill", style: `width:${c.value}%;background:${c.color}` })]),
        h("span", { class: "mono" }, [String(c.value)]),
      ]),
    ),
    h("p", { class: "muted" }, [ctx.tr("ui.zone.free_control", { value: d.freeControl })]),
  ];
}

/** Destination picking for a member (from Club): clicking a reachable district assigns it. */
function pickingBanner(ctx: UiContext): HTMLElement | null {
  const { state, data, ui, tr, set, actions } = ctx;
  const member = ui.focusedMemberId ? state.members[ui.focusedMemberId] : undefined;
  const entry = member ? ui.draft[member.id] : undefined;
  if (!member || !entry) return null;
  return h("div", { class: "picking", role: "status" }, [
    portraitCanvas(data, member, data.factions.find((f) => f.id === member.factionId)?.patchId ?? null, 2),
    h("div", {}, [
      h("strong", {}, [tr("ui.pick.title", { member: member.nickname || member.name })]),
      h("div", { class: "muted" }, [tr(`task.${entry.taskId}`), " · ", entry.zoneId ? zoneName(data, entry.zoneId) : tr("ui.pick_zone")]),
      h("div", { class: "muted" }, [tr("ui.pick.hint")]),
      h("div", { class: "row" }, [
        h("button", { onclick: () => { set({ focusedMemberId: null }); actions.navigate("club"); } }, [tr("ui.pick.back_to_club")]),
        h("button", { class: "link", onclick: () => set({ focusedMemberId: null }) }, [tr("ui.pick.done")]),
      ]),
    ]),
  ]);
}

function renderLot(ctx: UiContext, zoneId: string, lot: number): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const viewer = state.playerFactionId;
  const d = lotDetails(state, data, viewer, zoneId, lot);
  const queued = ui.management.some((o) => o.kind === "build" && o.zoneId === zoneId && o.lot === lot) || ui.proposals.some((p) => p.type === "open_illegal_business" && p.zoneId === zoneId && p.lot === lot);
  const money = state.factions[viewer]?.money ?? { clean: 0, dirty: 0 };
  return h("div", { class: "lot-panel" }, [
    h("h2", {}, [tr("ui.lot.title", { index: lot + 1 })]),
    h("p", { class: "muted" }, [zoneName(data, zoneId)]),
    d.business
      ? h("div", { class: "lot-business" }, [
          illustration(d.business.typeKey.replace(/^business\./, ""), "medium", tr(d.business.typeKey), "?"),
          h("div", {}, [
            h("strong", {}, [tr(d.business.typeKey)]),
            h("div", {}, [h("span", { style: `color:${d.business.color}` }, [d.business.owner])]),
            h("div", { class: "muted" }, [tr(d.business.statusKey)]),
          ]),
        ])
      : h("p", {}, [tr("ui.lot.empty")]),
    d.business && !d.business.ours ? h("p", { class: "hint" }, [tr("ui.lot.attack_hint")]) : null,
    queued ? h("p", { class: "notice-inline" }, [tr("ui.lot.queued")]) : null,
    d.business
      ? null
      : section(
          tr("ui.lot.options"),
          ...d.options.map((o) => {
            const add = (): void => {
              if (o.legal) set({ management: [...ui.management, { kind: "build", factionId: viewer, typeId: o.typeId, zoneId, lot }] });
              else set({ proposals: [...ui.proposals, { factionId: viewer, type: "open_illegal_business", businessTypeId: o.typeId, zoneId, lot }] });
            };
            const missing = o.problem === "build_error.no_money" ? Math.max(0, o.cost - money.clean) : 0;
            return h("div", { class: o.problem ? "lot-option blocked" : "lot-option" }, [
              illustration(o.typeId, "small", tr(o.nameKey), "?"),
              h("div", { class: "lot-option-body" }, [
                h("strong", {}, [tr(o.nameKey)]),
                h("div", { class: "muted" }, [
                  tr("ui.lot.cost", { cost: o.cost }),
                  " · ",
                  o.legal ? tr("ui.lot.legal") : tr("ui.lot.illegal_council"),
                ]),
                o.problem ? h("div", { class: "error" }, [tr(o.problem), missing > 0 ? ` ${tr("ui.lot.missing", { missing, clean: money.clean })}` : ""]) : null,
              ]),
              h("button", { disabled: o.problem !== null, onclick: add }, [o.legal ? tr("ui.lot.queue_build") : tr("ui.lot.queue_propose")]),
            ]);
          }),
        ),
  ]);
}

function hqCard(ctx: UiContext, zoneId: string): HTMLElement | null {
  const hq = hqSheet(ctx.state, ctx.data, ctx.state.playerFactionId);
  if (!hq || hq.zoneId !== zoneId) return null;
  return h("button", { class: "hq-card", onclick: () => ctx.set({ showHqSheet: true }) }, [
    illustration("club_hq", "small", ctx.tr("ui.hq.title"), "H"),
    h("span", {}, [h("strong", {}, [ctx.tr("ui.hq.title")]), h("span", { class: "muted" }, [ctx.tr("ui.hq.open")])]),
  ]);
}

export function renderInspector(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, actions, set } = ctx;
  const viewer = state.playerFactionId;
  const picking = pickingBanner(ctx);
  if (ui.localZoneId && ui.selectedLot !== null) return h("div", { class: "inspector" }, [picking, renderLot(ctx, ui.localZoneId, ui.selectedLot)]);

  const zoneId = ui.selectedZoneId;
  const d = zoneId ? zoneDetails(state, data, zoneId, viewer) : null;
  if (!d) return h("div", { class: "inspector" }, [picking, h("p", { class: "hint" }, [tr("ui.zone_none")])]);

  const planned = Object.entries(ui.draft).filter(([, e]) => e.zoneId === d.id);
  const members = memberRows(state, viewer);
  const problems = draftProblems(ui.draft, state, data);
  const withTask = members.filter((m) => m.id in ui.draft && !(m.id in problems)).length;
  const active = members.filter((m) => m.status === "active").length;
  const businesses = zoneBusinesses(state, data, d.id);
  const goal = topBarModel(state, data, viewer);
  const ours = data.factions.find((f) => f.id === viewer);
  const reachable = d.reachable;

  return h("div", { class: "inspector" }, [
    picking,
    h("h2", {}, [d.name]),
    h("p", { class: "muted" }, [tr(d.typeKey), " · ", reachable ? tr("ui.zone_reachable") : tr("ui.zone_unreachable")]),
    ui.localZoneId === d.id
      ? h("p", { class: "hint" }, [tr("ui.lot.hint")])
      : h("button", { class: "secondary", onclick: () => actions.enterZone(d.id) }, [tr("ui.zone.enter")]),
    hqCard(ctx, d.id),
    h("dl", { class: "facts" }, [
      h("dt", {}, [tr("ui.zone.owner")]),
      h("dd", {}, [d.owner ? h("span", { style: `color:${d.owner.color}` }, [d.owner.name]) : tr("ui.zone.no_owner")]),
      h("dt", {}, [tr("ui.zone.heat")]),
      h("dd", {}, [String(d.heat), d.patrols ? h("span", { class: "warn" }, [" ", tr("ui.zone.patrols")]) : null]),
      h("dt", {}, [tr("ui.zone.police")]),
      h("dd", {}, [String(d.policePresence)]),
      h("dt", {}, [tr("ui.zone.wealth")]),
      h("dd", {}, [String(d.wealth)]),
      h("dt", {}, [tr("ui.zone.slots")]),
      h("dd", {}, [tr("ui.zone.lots_used", { used: businesses.length, total: d.businessSlots })]),
    ]),
    section(tr("ui.zone.control"), ...controlBars(ctx, d.id)),
    section(
      tr("ui.zone.businesses"),
      businesses.length === 0
        ? h("p", { class: "muted" }, [tr("ui.zone.nobody")])
        : h("ul", { class: "plain" }, businesses.map((b) => h("li", {}, [tr(b.typeKey), " · ", h("span", { style: `color:${b.color}` }, [b.owner])]))),
    ),
    section(
      tr("ui.zone.neighbors"),
      h("div", { class: "chips" }, d.neighbors.map((n) => h("button", { class: "chip", onclick: () => actions.selectZone(n.id) }, [n.name]))),
    ),
    section(
      tr("ui.zone.planned"),
      planned.length === 0
        ? h("p", { class: "muted" }, [tr("ui.zone.nobody")])
        : h(
            "ul",
            { class: "plain" },
            planned.map(([memberId, e]) => h("li", {}, [h("strong", {}, [state.members[memberId]?.nickname ?? memberId]), ": ", tr(`task.${e.taskId}`)])),
          ),
    ),
    section(
      tr("ui.inspector.members"),
      h("p", {}, [tr("ui.orders_ready", { ready: withTask, active })]),
      h("button", { class: "link", onclick: () => { set({ focusedMemberId: null }); actions.navigate("club"); } }, [tr("ui.inspector.to_club")]),
    ),
    section(
      tr("ui.inspector.goal"),
      h("p", { class: "muted" }, [tr("ui.inspector.goal_text", { target: goal.target, weeks: goal.weeksHeld })]),
      h("div", { class: "bar-row" }, [
        h("span", { class: "bar-label" }, [ours ? patchCanvas(data, goal.patchId, 1) : "", " ", goal.factionName]),
        h("span", { class: "bar" }, [h("span", { class: "bar-fill", style: `width:${Math.min(100, (100 * goal.owned) / goal.target)}%;background:${ours?.color ?? "var(--accent)"}` })]),
        h("span", { class: "mono" }, [`${goal.owned}/${goal.target}`]),
      ]),
      h("p", { class: "muted" }, [tr("ui.h.streak", { streak: goal.streak, weeks: goal.weeksHeld })]),
    ),
  ]);
}

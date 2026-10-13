// Windows over the game: new game (name and patch), help, member sheet, headquarters sheet, the weekly review
// before resolving, and the end of the game.

import { h } from "../dom";
import { illustration } from "../assets";
import { msg, zoneName, type UiContext } from "../context";
import { patchCanvas } from "../patchCanvas";
import { portraitCanvas } from "../portraitCanvas";
import { patchNameParts } from "../../render/patch";
import { CLUB_NAME_MAX_LENGTH } from "../../sim/identity";
import { MAP_SIZES } from "../../sim/state";
import { weekReview } from "../review";
import { hqSheet, memberSheet, topBarModel } from "../viewModel";
import { proposalLabel } from "./council";
import { managementLabel } from "./business";
import type { NewGameForm } from "../uiState";

function renderNewGame(ctx: UiContext, form: NewGameForm): HTMLElement {
  const { content, tr, set, actions } = ctx;
  const startButton = h("button", { class: "primary", disabled: form.name.trim().length === 0, onclick: () => actions.startNewGame(form.name.trim(), form.patchId, form.size) }, [tr("ui.new.start")]);
  const nameInput = h("input", {
    type: "text",
    value: form.name,
    maxlength: String(CLUB_NAME_MAX_LENGTH),
    class: "club-name",
    "aria-label": tr("ui.new.name"),
    oninput: (e: Event) => {
      form.name = (e.target as HTMLInputElement).value;
      startButton.disabled = form.name.trim().length === 0;
    },
  });
  const parts = (id: string) => {
    const p = patchNameParts(content, id);
    return p ? tr("patch.name", { emblem: tr(p.emblemKey), palette: tr(p.paletteKey) }) : id;
  };
  return h("div", { class: "modal new-game", role: "dialog", "aria-modal": "true", "aria-label": tr(form.firstTime ? "ui.new.title_first" : "ui.new.title") }, [
    h("h2", {}, [tr(form.firstTime ? "ui.new.title_first" : "ui.new.title")]),
    h("label", { class: "field" }, [h("span", {}, [tr("ui.new.name")]), nameInput]),
    h("fieldset", { class: "map-size" }, [
      h("legend", {}, [tr("ui.new.size")]),
      h(
        "div",
        { class: "segmented size-choice", role: "radiogroup", "aria-label": tr("ui.new.size") },
        MAP_SIZES.map((size) => {
          const cfg = content.mapgen.sizes[size];
          return h(
            "button",
            { role: "radio", "aria-checked": form.size === size ? "true" : "false", class: form.size === size ? "active" : "", onclick: () => set({ newGameForm: { ...form, size } }) },
            [h("strong", {}, [tr(`map_size.${size}`)]), h("span", {}, [tr("ui.new.size_detail", { zones: cfg.zones, clubs: cfg.clubs })])],
          );
        }),
      ),
      h("p", { class: "muted" }, [tr("ui.new.size_hint")]),
    ]),
    h("p", { class: "muted" }, [tr("ui.new.patch_hint"), " ", h("strong", {}, [parts(form.patchId)])]),
    h(
      "div",
      { class: "patch-grid" },
      content.patches.patches.map((p) =>
        h(
          "button",
          { class: p.id === form.patchId ? "patch-choice selected" : "patch-choice", title: parts(p.id), "aria-label": parts(p.id), "aria-pressed": p.id === form.patchId ? "true" : "false", onclick: () => set({ newGameForm: { ...form, patchId: p.id } }) },
          [patchCanvas(content, p.id, 3)],
        ),
      ),
    ),
    h("div", { class: "row" }, [
      startButton,
      form.firstTime ? null : h("button", { onclick: () => set({ newGameForm: null }) }, [tr("ui.new.cancel")]),
      form.firstTime ? null : h("span", { class: "muted" }, [tr("ui.new.warning")]),
    ]),
  ]);
}

function renderHelp(ctx: UiContext): HTMLElement {
  const { data, tr, set } = ctx;
  return h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": tr("ui.help.title") }, [
    h("h2", {}, [tr("ui.help.title")]),
    h("p", {}, [tr("ui.help.goal", { target: data.balance.victory.zonesToControl, total: data.zones.length, weeks: data.balance.victory.weeksHeld })]),
    ...["ui.help.week", "ui.help.tasks", "ui.help.money", "ui.help.law", "ui.help.council", "ui.help.lose", "ui.help.keys"].map((k) => h("p", {}, [tr(k)])),
    h("p", { class: "muted" }, [tr("ui.help.credits", { credit: data.ui.tileset.credit })]),
    h("p", { class: "muted" }, [tr("ui.help.credits_ui")]),
    h("button", { class: "primary", onclick: () => set({ showHelp: false }) }, [tr("ui.close")]),
  ]);
}

function renderMemberSheet(ctx: UiContext, memberId: string): HTMLElement | null {
  const { state, data, ui, tr, set, actions } = ctx;
  const entry = ui.draft[memberId];
  const sheet = memberSheet(state, data, memberId, entry ? { taskId: entry.taskId, zoneId: entry.zoneId } : null);
  if (!sheet) return null;
  const { member } = sheet;
  const status = tr(`status.${member.status}`);
  const bar = (value: number, max: number, low = false) => h("div", { class: low ? "bar low" : "bar" }, [h("div", { class: "fill", style: `width: ${Math.round((100 * value) / max)}%` })]);
  const taskList = (ids: string[]) => (ids.length > 0 ? ids.map((id) => tr(`task.${id}`)).join(", ") : tr("ui.sheet.nothing"));
  return h("div", { class: "modal member-sheet", role: "dialog", "aria-modal": "true", "aria-label": tr("ui.sheet.title") }, [
    h("div", { class: "sheet-head" }, [
      portraitCanvas(data, member, sheet.patchId, 6),
      h("div", {}, [
        h("h2", {}, [member.nickname || member.name]),
        h("div", {}, [member.name]),
        h("div", { class: "muted" }, [tr(`rank.${member.rank}`), " · ", tr(`trait.${member.trait}`)]),
        h("div", { class: member.status === "active" ? "muted" : "error" }, [member.statusWeeks > 0 ? tr("ui.club.back_in", { status, weeks: member.statusWeeks }) : status]),
      ]),
    ]),
    h("table", { class: "sheet-stats" }, [
      h("tbody", {}, [
        ...sheet.stats.map((st) => h("tr", {}, [h("th", {}, [tr(`stat.${st.key}`)]), h("td", { class: "mono" }, [String(st.value)]), h("td", {}, [bar(st.value, st.max)])])),
        h("tr", {}, [h("th", {}, [tr("ui.sheet.loyalty")]), h("td", { class: "mono" }, [String(Math.round(sheet.loyalty.value))]), h("td", {}, [bar(sheet.loyalty.value, sheet.loyalty.max, sheet.loyalty.low)])]),
      ]),
    ]),
    sheet.loyalty.low ? h("p", { class: "error" }, [tr("ui.loyalty_danger")]) : null,
    h("p", {}, [h("strong", {}, [tr("ui.sheet.likes")]), " ", taskList(sheet.likes)]),
    h("p", {}, [h("strong", {}, [tr("ui.sheet.dislikes")]), " ", taskList(sheet.dislikes)]),
    h("p", {}, [h("strong", {}, [tr("ui.sheet.plan")]), " ", sheet.plan ? `${tr(`task.${sheet.plan.taskId}`)} · ${sheet.plan.zoneId ? zoneName(data, sheet.plan.zoneId) : tr("ui.pick_zone")}` : tr("ui.sheet.no_plan")]),
    h("div", { class: "row" }, [
      h("button", { class: "primary", onclick: () => set({ sheetMemberId: null }) }, [tr("ui.close")]),
      ui.view !== "club" ? h("button", { onclick: () => { set({ sheetMemberId: null }); actions.navigate("club"); } }, [tr("ui.inspector.to_club")]) : null,
    ]),
  ]);
}

function renderHqSheet(ctx: UiContext): HTMLElement | null {
  const { state, data, tr, set, actions } = ctx;
  const hq = hqSheet(state, data, state.playerFactionId);
  if (!hq) return null;
  return h("div", { class: "modal hq-sheet", role: "dialog", "aria-modal": "true", "aria-label": tr("ui.hq.title") }, [
    h("div", { class: "sheet-head" }, [
      illustration("club_hq", "large", tr("ui.hq.title"), "H"),
      h("div", {}, [
        h("span", { class: "node-kind" }, [tr("ui.hq.title")]),
        h("h2", { class: "club-id" }, [patchCanvas(data, hq.patchId, 2, hq.factionName), hq.factionName]),
        h("div", {}, [tr("ui.hq.district"), " ", h("strong", {}, [hq.zoneName]), h("span", { class: "muted" }, [` · ${tr(hq.zoneTypeKey)}`])]),
      ]),
    ]),
    h("dl", { class: "facts" }, [
      h("dt", {}, [tr("ui.hq.our_control")]),
      h("dd", { class: "mono" }, [String(hq.ourControl)]),
      h("dt", {}, [tr("ui.zone.owner")]),
      h("dd", {}, [hq.owner ? h("span", { style: `color:${hq.owner.color}` }, [hq.owner.name]) : tr("ui.zone.no_owner")]),
      h("dt", {}, [tr("ui.hq.members_label")]),
      h("dd", { class: "mono" }, [tr("ui.hq.members_value", { members: hq.members, cap: hq.memberCap })]),
      h("dt", {}, [tr("ui.hq.businesses")]),
      h("dd", { class: "mono" }, [String(hq.businesses)]),
    ]),
    h("p", { class: "muted" }, [tr("ui.hq.note")]),
    h("div", { class: "row" }, [
      h("button", { class: "primary", onclick: () => { set({ showHqSheet: false }); actions.enterZone(hq.zoneId); } }, [tr("ui.hq.to_map")]),
      h("button", { onclick: () => set({ showHqSheet: false }) }, [tr("ui.close")]),
    ]),
  ]);
}

function renderReview(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set, actions } = ctx;
  const r = weekReview(state, data, state.playerFactionId, ui);
  const money = (n: number) => `$${n}`;
  const confirm = h("button", { class: "primary", id: "confirm-resolve", disabled: ui.resolving || state.outcome !== null, onclick: () => actions.resolveWeek() }, [
    ui.resolving ? tr("ui.review.resolving") : tr("ui.review.confirm"),
  ]);
  const list = (items: Node[], empty: string) => (items.length === 0 ? h("p", { class: "muted" }, [empty]) : h("ul", { class: "plain review-list" }, items));
  return h("div", { class: "modal review", role: "dialog", "aria-modal": "true", "aria-labelledby": "review-title" }, [
    h("h2", { id: "review-title" }, [tr("ui.review.title", { week: state.week })]),
    h("p", { class: "muted" }, [tr("ui.review.intro")]),
    h("div", { class: "review-summary" }, [
      h("span", { class: r.errors > 0 ? "badge error-badge" : "badge" }, [tr("ui.review.errors", { count: r.errors })]),
      h("span", { class: r.warnings > 0 ? "badge warn-badge" : "badge" }, [tr("ui.review.warnings", { count: r.warnings })]),
    ]),
    h("section", {}, [
      h("h3", {}, [tr("ui.review.orders")]),
      list(
        r.assignments.map((a) =>
          h("li", { class: a.problem ? "has-error" : "" }, [
            h("strong", {}, [a.name]),
            `: ${tr(`task.${a.taskId}`)} · ${a.zoneId ? zoneName(data, a.zoneId) : "—"}`,
            a.problem ? h("span", { class: "error" }, [` ✕ ${tr(a.problem)}`]) : null,
            a.blocker ? h("span", { class: "warn-text" }, [` ▲ ${msg(data, a.blocker)}`]) : null,
          ]),
        ),
        tr("ui.review.no_orders"),
      ),
      r.idle.length > 0 ? h("p", { class: "warn-text" }, [h("span", { "aria-hidden": "true" }, ["▲ "]), tr("ui.review.idle", { names: r.idle.map((m) => m.name).join(", ") })]) : null,
      r.unavailable.length > 0 ? h("p", { class: "muted" }, [tr("ui.review.unavailable", { names: r.unavailable.map((m) => `${m.name} (${tr("ui.club.back_in", { status: tr(`status.${m.status}`), weeks: m.weeks })})`).join(", ") })]) : null,
    ]),
    h("section", {}, [
      h("h3", {}, [tr("ui.review.management")]),
      list(
        r.management.map((m) =>
          h("li", { class: m.problem ? "has-error" : "" }, [
            managementLabel(ctx, m.order),
            m.cost.clean > 0 ? h("span", { class: "mono" }, [` · ${tr("ui.review.clean", { amount: m.cost.clean })}`]) : null,
            m.cost.dirty > 0 ? h("span", { class: "mono" }, [` · ${tr("ui.review.dirty", { amount: m.cost.dirty })}`]) : null,
            m.problem ? h("span", { class: "error" }, [` ✕ ${tr(m.problem)}`]) : null,
          ]),
        ),
        tr("ui.council.none"),
      ),
      h("p", { class: "mono" }, [tr("ui.review.committed", { clean: money(r.committed.clean), dirty: money(r.committed.dirty), haveClean: money(r.money.clean), haveDirty: money(r.money.dirty) })]),
      r.overCommitted.clean || r.overCommitted.dirty ? h("p", { class: "warn-text" }, [h("span", { "aria-hidden": "true" }, ["▲ "]), tr("ui.review.over")]) : null,
      h("p", { class: "muted" }, [tr("ui.review.expenses", { wages: r.expenses.wages, upkeep: r.expenses.upkeep })]),
    ]),
    h("section", {}, [
      h("h3", {}, [tr("ui.review.proposals")]),
      list(
        r.proposals.map((p) =>
          h("li", { class: p.problem ? "has-error" : "" }, [
            proposalLabel(ctx, p.proposal),
            p.costIfApproved > 0 ? h("span", { class: "muted" }, [` · ${tr("ui.council.cost_if_approved", { cost: p.costIfApproved })}`]) : null,
            p.problem ? h("span", { class: "error" }, [` ✕ ${tr(p.problem)}`]) : null,
          ]),
        ),
        tr("ui.council.none"),
      ),
      r.proposals.length > 0 ? h("p", { class: "muted" }, [tr("ui.review.vote_uncertain")]) : null,
    ]),
    r.events.length > 0
      ? h("section", {}, [
          h("h3", {}, [tr("ui.review.events")]),
          list(
            r.events.map((e) => h("li", {}, [tr(`event.${e.eventId}.title`), ": ", tr(`event.${e.eventId}.option.${e.optionId}`), e.isDefault ? tr("ui.event.default") : ""])),
            "",
          ),
        ])
      : null,
    h("p", { class: "muted" }, [tr("ui.review.order_note")]),
    h("div", { class: "row" }, [confirm, h("button", { onclick: () => set({ showReview: false }) }, [tr("ui.review.back")])]),
  ]);
}

function renderOutcome(ctx: UiContext): HTMLElement | null {
  const { state, data, tr, set, actions } = ctx;
  if (!state.outcome) return null;
  const m = topBarModel(state, data, state.playerFactionId);
  return h("div", { class: `modal ${state.outcome.result}`, role: "dialog", "aria-modal": "true" }, [
    h("h2", {}, [tr(state.outcome.result === "victory" ? "ui.end.victory" : "ui.end.defeat")]),
    h("p", {}, [tr(state.outcome.reasonKey)]),
    h("p", { class: "muted" }, [tr("ui.end.summary", { week: state.outcome.week, owned: m.owned, clean: m.clean, dirty: m.dirty })]),
    h("div", { class: "row" }, [h("button", { class: "primary", onclick: actions.openNewGame }, [tr("ui.new_game")]), h("button", { onclick: () => set({ outcomeDismissed: true }) }, [tr("ui.end.look")])]),
  ]);
}

/** The window to show now, if any, in priority order. */
export function renderOverlay(ctx: UiContext): HTMLElement | null {
  const { ui, state } = ctx;
  if (ui.newGameForm) return renderNewGame(ctx, ui.newGameForm);
  if (ui.showReview) return renderReview(ctx);
  if (ui.sheetMemberId) return renderMemberSheet(ctx, ui.sheetMemberId);
  if (ui.showHqSheet) return renderHqSheet(ctx);
  if (ui.showHelp) return renderHelp(ctx);
  if (state.outcome && !ui.outcomeDismissed) return renderOutcome(ctx);
  return null;
}

/** Which flag closes the window on Escape (none for the first-time new game screen). */
export function closeOverlayPatch(ctx: UiContext): Partial<typeof ctx.ui> | null {
  const { ui, state } = ctx;
  if (ui.newGameForm) return ui.newGameForm.firstTime ? null : { newGameForm: null };
  if (ui.showReview) return ui.resolving ? null : { showReview: false };
  if (ui.sheetMemberId) return { sheetMemberId: null };
  if (ui.showHqSheet) return { showHqSheet: false };
  if (ui.showHelp) return { showHelp: false };
  if (state.outcome && !ui.outcomeDismissed) return { outcomeDismissed: true };
  return null;
}

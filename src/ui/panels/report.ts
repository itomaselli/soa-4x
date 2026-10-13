// Informe: last week's report grouped by resolution stage (every engine explanation kept), with a link to the
// district when an entry names one, and the pending event decisions with their costs, defaults and the options
// we can't afford.

import { h } from "../dom";
import type { UiContext } from "../context";
import { formatEntry } from "../report";
import { TURN_STAGES } from "../../sim/report";
import { pendingEventViews } from "../viewModel";

function renderEvents(ctx: UiContext): HTMLElement | null {
  const { state, data, ui, tr, set } = ctx;
  const events = pendingEventViews(state, data, state.playerFactionId);
  if (events.length === 0) return null;
  return h("section", { class: "events" }, [
    h("h2", {}, [tr("ui.report.decisions")]),
    ...events.map((ev) =>
      h("fieldset", { class: "event" }, [
        h("legend", {}, [tr(ev.titleKey)]),
        h("p", {}, [tr(ev.textKey, { subject: ev.subject, rival: ev.rival, zone: ev.zone })]),
        ...ev.options.map((o) =>
          h("label", { class: o.affordable ? "check" : "check muted" }, [
            h("input", {
              type: "radio",
              name: ev.instanceId,
              disabled: !o.affordable,
              checked: (ui.eventChoices[ev.instanceId] ?? ev.options.find((x) => x.isDefault)?.id) === o.id,
              onchange: () => set({ eventChoices: { ...ui.eventChoices, [ev.instanceId]: o.id } }),
            }),
            " ",
            tr(o.labelKey),
            o.isDefault ? tr("ui.event.default") : "",
            o.affordable ? "" : tr("ui.event.cant_afford"),
          ]),
        ),
      ]),
    ),
  ]);
}

export function renderReport(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, actions } = ctx;
  const viewer = state.playerFactionId;
  const visible = ui.report.filter((e) => e.factionId === null || e.factionId === viewer);
  const sections = TURN_STAGES.map((stage) => ({ stage, entries: visible.filter((e) => e.stage === stage) })).filter((s) => s.entries.length > 0);
  return h("div", { class: "report-view" }, [
    renderEvents(ctx),
    sections.length === 0
      ? h("p", { class: "hint" }, [tr("ui.report_empty")])
      : h("section", { class: "report" }, [
          h("h2", {}, [tr("play.report_title", { week: state.week - 1 })]),
          h("nav", { class: "chips report-index", "aria-label": tr("ui.report.index") }, sections.map((s) => h("a", { class: "chip", href: `#report-${s.stage}` }, [tr(`report.stage.${s.stage}`)]))),
          ...sections.map((s) =>
            h("section", { class: "report-section", id: `report-${s.stage}` }, [
              h("h3", {}, [tr(`report.stage.${s.stage}`)]),
              h(
                "ul",
                {},
                s.entries.map((e) => {
                  const zoneId = typeof e.params.zoneId === "string" ? e.params.zoneId : null;
                  return h("li", {}, [
                    formatEntry(e, data),
                    zoneId ? h("button", { class: "link small", onclick: () => actions.selectZone(zoneId) }, [` ${tr("ui.report.see_zone")}`]) : null,
                  ]);
                }),
              ),
            ]),
          ),
        ]),
  ]);
}

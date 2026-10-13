// Common header: the club's chosen name and patch, week, money, territory and victory progress, loyalty,
// sheriff and federals (hidden until the game reveals them), "Revisar semana" and the Options menu.
// Below it, the stable navigation: Condado · Club · Mesa · Negocios · Informe.

import { h } from "../dom";
import type { UiContext } from "../context";
import { patchCanvas } from "../patchCanvas";
import { VIEWS } from "../uiState";
import { topBarModel } from "../viewModel";

export function renderHeader(ctx: UiContext): HTMLElement {
  const { state, data, tr, ui, actions } = ctx;
  const m = topBarModel(state, data, state.playerFactionId);
  const progress = Math.min(100, Math.round((100 * m.owned) / m.target));
  const pendingEvents = state.pendingEvents.filter((e) => e.factionId === state.playerFactionId).length;
  const fileInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: true,
    onchange: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) actions.loadFromFile(file);
    },
  });
  const menuItem = (label: string, onclick: () => void, title = "") => h("button", { role: "menuitem", class: "menu-item", title, onclick }, [label]);
  const options = h("details", { class: "menu" }, [
    h("summary", { class: "button" }, [tr("ui.options")]),
    h("div", { class: "menu-list", role: "menu" }, [
      menuItem(tr("ui.save_file"), actions.saveToFile, tr("ui.save_file_hint")),
      menuItem(tr("ui.load_file"), () => fileInput.click(), tr("ui.load_file_hint")),
      menuItem(tr("ui.new_game"), actions.openNewGame),
      menuItem(tr(ui.renderMode === "tiles" ? "ui.legend.to_ascii" : "ui.legend.to_tiles"), actions.toggleRenderMode),
      menuItem(tr("ui.help"), () => ctx.set({ showHelp: true })),
    ]),
    fileInput,
  ]);
  // Close the menu after choosing.
  options.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("menu-item")) options.open = false;
  });

  const stat = (label: string, value: Node | string, cls = "") => h("div", { class: `stat ${cls}` }, [h("span", { class: "stat-label" }, [label]), h("span", { class: "stat-value" }, [value])]);

  return h("div", { class: "header" }, [
    h("div", { class: "identity" }, [
      h("span", { class: "brand" }, [tr("app.title")]),
      patchCanvas(data, m.patchId, 2, m.factionName),
      h("strong", { class: "club-name-label" }, [m.factionName]),
    ]),
    h("div", { class: "stats" }, [
      stat(tr("ui.h.week"), String(m.week)),
      stat(tr("ui.h.money"), h("span", { class: "mono" }, [tr("ui.h.money_value", { clean: m.clean, dirty: m.dirty })])),
      h("div", { class: "stat victory", title: tr("ui.h.victory_hint", { target: m.target, weeks: m.weeksHeld }) }, [
        h("span", { class: "stat-label" }, [tr("ui.h.zones")]),
        h("span", { class: "stat-value mono" }, [tr("ui.h.zones_value", { owned: m.owned, target: m.target, total: m.totalZones })]),
        h("span", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(m.target), "aria-valuenow": String(m.owned), "aria-label": tr("ui.h.victory_progress") }, [
          h("span", { class: "meter-fill", style: `width:${progress}%` }),
        ]),
        h("span", { class: "stat-note" }, [tr("ui.h.streak", { streak: m.streak, weeks: m.weeksHeld })]),
      ]),
      stat(
        tr("ui.h.loyalty"),
        m.averageLoyalty === null ? "—" : `${m.averageLoyalty}${m.unrestWeeks > 0 ? tr("ui.unrest", { weeks: m.unrestWeeks, limit: m.unrestLimit }) : ""}`,
        m.lowLoyalty ? "warn" : "",
      ),
      stat(tr("ui.h.sheriff"), String(m.sheriffRelation)),
      // Federals: "?" until the game reveals them; the hidden value never reaches the DOM.
      stat(tr("ui.h.federal"), m.federal === null ? "?" : `${m.federal}%`, m.federal === null ? "muted" : "warn"),
      ...m.relations.map((r) => stat(r.name, `${r.value} · ${tr(r.stateKey)}`, "relation")),
    ]),
    h("div", { class: "header-actions" }, [
      pendingEvents > 0 ? h("button", { class: "warn-chip", onclick: () => actions.navigate("report") }, [tr("ui.events_pending", { count: pendingEvents })]) : null,
      state.outcome
        ? h("div", { class: `outcome ${state.outcome.result}` }, [tr(state.outcome.reasonKey)])
        : h("button", { class: "primary", disabled: ui.resolving, onclick: actions.openReview, title: tr("ui.review.enter_hint") }, [tr("ui.review.open")]),
      options,
    ]),
  ]);
}

export function renderNav(ctx: UiContext): HTMLElement {
  const { ui, tr, actions } = ctx;
  const title = ui.view === "county" && ui.localZoneId ? tr("ui.view.district") : tr(`ui.view.${ui.view}`);
  return h("div", { class: "nav" }, [
    h("h1", { class: "view-title" }, [title]),
    h(
      "div",
      { class: "nav-tabs", role: "tablist", "aria-label": tr("ui.nav.label") },
      VIEWS.map((view) =>
        h("button", { role: "tab", "aria-selected": ui.view === view ? "true" : "false", class: ui.view === view ? "nav-tab active" : "nav-tab", onclick: () => actions.navigate(view) }, [
          tr(`ui.nav.${view}`),
        ]),
      ),
    ),
  ]);
}

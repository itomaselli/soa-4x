// Browser game controller. Holds the current GameState and the player's draft orders,
// builds the panels and calls resolveTurn. It never changes GameState directly (CLAUDE.md, rule 8).

import type { GameData } from "../data/schemas";
import { createMapView, type MapView } from "../render/map";
import { availableTasks, reachableZones } from "../sim/orders";
import type { ReportEntry } from "../sim/report";
import { createInitialState } from "../sim/setup";
import type { GameState, MemberState } from "../sim/state";
import { allAiOrders } from "../sim/systems/ai";
import { resolveTurn } from "../sim/turn";
import { h } from "./dom";
import { carryOverDraft, draftProblems, draftToOrders, type Draft } from "./draft";
import { reportSections } from "./report";
import { clearAutosave, loadAutosave, saveAutosave } from "./storage";
import { t } from "./strings";
import { mapViewModel, memberRows, topBarModel, zoneDetails } from "./viewModel";

type Tab = "club" | "zone" | "report";

const PLAYER_FACTION = "faction_iron_saints";
const TABS: Tab[] = ["club", "zone", "report"];

export interface AppElements {
  topBar: HTMLElement;
  mapHost: HTMLElement;
  sidebar: HTMLElement;
}

/** Random seed for a new game. UI code may use the browser's randomness; the sim never does. */
function newSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

export async function startApp(data: GameData, els: AppElements): Promise<void> {
  const s = data.strings;
  const tr = (key: string, params: Record<string, string | number> = {}) => t(s, key, params);

  let state: GameState = loadAutosave() ?? createInitialState(data, { seed: newSeed(), playerFactionId: PLAYER_FACTION });
  let report: ReportEntry[] = [];
  let draft: Draft = {};
  let tab: Tab = "club";
  let selectedZoneId: string | null = data.factions.find((f) => f.id === state.playerFactionId)?.hqZoneId ?? null;
  let focusedMemberId: string | null = null;

  const map: MapView = await createMapView(els.mapHost, data, (zoneId) => {
    selectedZoneId = zoneId;
    const entry = focusedMemberId ? draft[focusedMemberId] : undefined;
    if (focusedMemberId && entry && reachableZones(state, data, state.playerFactionId).includes(zoneId)) {
      draft = { ...draft, [focusedMemberId]: { ...entry, zoneId } };
    } else if (tab !== "club") {
      tab = "zone";
    }
    render();
  });

  function advanceWeek(): void {
    if (state.outcome) return;
    const mine = draftToOrders(draft).assignments;
    const ai = allAiOrders(state, data, state.playerFactionId).assignments;
    const result = resolveTurn(state, { assignments: [...mine, ...ai] }, data);
    state = result.state;
    report = result.report;
    draft = carryOverDraft(draft, state, data);
    focusedMemberId = null;
    tab = "report";
    saveAutosave(state);
    render();
  }

  function newGame(): void {
    if (!window.confirm(tr("ui.confirm_new_game"))) return;
    clearAutosave();
    state = createInitialState(data, { seed: newSeed(), playerFactionId: PLAYER_FACTION });
    report = [];
    draft = {};
    tab = "club";
    saveAutosave(state);
    render();
  }

  // ---------- Top bar ----------

  function renderTopBar(): HTMLElement {
    const m = topBarModel(state, data, state.playerFactionId);
    const outcome = state.outcome;
    return h("div", { class: "topbar" }, [
      h("div", { class: "brand" }, [tr("app.title")]),
      h("div", { class: "stat" }, [tr("ui.week", { week: m.week })]),
      h("div", { class: "stat" }, [tr("ui.money", { clean: m.clean, dirty: m.dirty })]),
      h("div", { class: "stat" }, [tr("ui.territory", { owned: m.owned, total: m.totalZones, target: m.target, weeks: m.weeksHeld, streak: m.streak })]),
      ...m.relations.map((r) =>
        h("div", { class: "stat" }, [h("span", { style: `color:${r.color}` }, [r.name]), " ", tr("ui.relation", { value: r.value })]),
      ),
      h("div", { class: "spacer" }),
      outcome
        ? h("div", { class: `outcome ${outcome.result}` }, [tr(outcome.reasonKey)])
        : h("button", { class: "primary", onclick: advanceWeek }, [tr("ui.advance_week")]),
      h("button", { onclick: newGame }, [tr("ui.new_game")]),
    ]);
  }

  // ---------- Club tab ----------

  function taskOptions(selected: string | undefined): HTMLOptionElement[] {
    const options = [h("option", { value: "" }, [tr("ui.rest")])];
    for (const id of availableTasks(data)) {
      const task = data.tasks.find((x) => x.id === id);
      const label = task?.illegal ? tr("ui.task_illegal", { name: tr(`task.${id}`), heat: task.heat }) : tr(`task.${id}`);
      options.push(h("option", { value: id, selected: id === selected }, [label]));
    }
    return options;
  }

  function memberRow(member: MemberState, problems: Record<string, string>, zones: string[]): HTMLElement {
    const entry = draft[member.id];
    const active = member.status === "active";
    const status = tr(`status.${member.status}`);
    const statusText = member.statusWeeks > 0 ? tr("play.member_status_weeks", { status, weeks: member.statusWeeks }) : status;

    const taskSelect = h(
      "select",
      {
        disabled: !active,
        "aria-label": tr("ui.task_for", { member: member.nickname }),
        onchange: (e: Event) => {
          const taskId = (e.target as HTMLSelectElement).value;
          const next = { ...draft };
          if (taskId === "") delete next[member.id];
          else next[member.id] = { taskId, zoneId: entry?.zoneId ?? selectedZoneOrNull(zones) };
          draft = next;
          focusedMemberId = taskId === "" ? null : member.id;
          render();
        },
      },
      taskOptions(entry?.taskId),
    );

    const zoneSelect = h(
      "select",
      {
        disabled: !active || !entry,
        "aria-label": tr("ui.zone_for", { member: member.nickname }),
        onfocus: () => {
          focusedMemberId = member.id;
        },
        onchange: (e: Event) => {
          const zoneId = (e.target as HTMLSelectElement).value || null;
          if (entry) draft = { ...draft, [member.id]: { ...entry, zoneId } };
          if (zoneId) selectedZoneId = zoneId;
          render();
        },
      },
      [
        h("option", { value: "" }, [tr("ui.pick_zone")]),
        ...zones.map((id) =>
          h("option", { value: id, selected: entry?.zoneId === id }, [data.zones.find((z) => z.id === id)?.name ?? id]),
        ),
      ],
    );

    const problem = problems[member.id];
    return h(
      "tr",
      {
        class: [focusedMemberId === member.id ? "focused" : "", active ? "" : "inactive"].join(" "),
        onclick: () => {
          if (active && entry) {
            focusedMemberId = member.id;
            for (const row of els.sidebar.querySelectorAll("tr.focused")) row.classList.remove("focused");
            (taskSelect.closest("tr") as HTMLElement).classList.add("focused");
          }
        },
      },
      [
        h("td", {}, [
          h("strong", {}, [member.nickname || member.name]),
          " ",
          h("span", { class: "muted" }, [member.name]),
          h("div", { class: "muted" }, [tr(`rank.${member.rank}`), " · ", tr(`trait.${member.trait}`), " · ", statusText]),
        ]),
        h("td", { class: "mono" }, [
          tr("ui.stats", { strength: member.stats.strength, cunning: member.stats.cunning, hands: member.stats.hands, charm: member.stats.charm }),
          h("div", { class: "muted" }, [tr("ui.loyalty", { value: member.loyalty })]),
        ]),
        h("td", { class: "orders" }, [taskSelect, zoneSelect, problem && entry ? h("div", { class: "error" }, [tr(problem)]) : null]),
      ],
    );
  }

  function selectedZoneOrNull(reachable: string[]): string | null {
    return selectedZoneId && reachable.includes(selectedZoneId) ? selectedZoneId : null;
  }

  function renderClub(): HTMLElement {
    const zones = reachableZones(state, data, state.playerFactionId);
    const problems = draftProblems(draft, state, data);
    const members = memberRows(state, state.playerFactionId);
    const active = members.filter((m) => m.status === "active").length;
    const ready = draftToOrders(draft).assignments.length;
    return h("div", {}, [
      h("p", { class: "hint" }, [tr("ui.club_hint")]),
      h("p", {}, [tr("ui.orders_ready", { ready, active })]),
      h("table", { class: "members" }, [
        h("thead", {}, [
          h("tr", {}, ["ui.col.member", "ui.col.stats", "ui.col.orders"].map((k) => h("th", {}, [tr(k)]))),
        ]),
        h("tbody", {}, members.map((m) => memberRow(m, problems, zones))),
      ]),
    ]);
  }

  // ---------- Zone tab ----------

  function renderZone(): HTMLElement {
    const d = selectedZoneId ? zoneDetails(state, data, selectedZoneId, state.playerFactionId) : null;
    if (!d) return h("p", { class: "hint" }, [tr("ui.zone_none")]);
    const planned = Object.entries(draft)
      .filter(([, e]) => e.zoneId === d.id)
      .map(([memberId, e]) => `${state.members[memberId]?.nickname ?? memberId}: ${tr(`task.${e.taskId}`)}`);
    return h("div", { class: "zone" }, [
      h("h2", {}, [d.name]),
      h("p", { class: "muted" }, [tr(d.typeKey), " · ", d.reachable ? tr("ui.zone_reachable") : tr("ui.zone_unreachable")]),
      h("dl", {}, [
        h("dt", {}, [tr("ui.zone.wealth")]), h("dd", {}, [String(d.wealth)]),
        h("dt", {}, [tr("ui.zone.police")]), h("dd", {}, [String(d.policePresence)]),
        h("dt", {}, [tr("ui.zone.heat")]), h("dd", {}, [String(d.heat), d.patrols ? h("span", { class: "warn" }, [" ", tr("ui.zone.patrols")]) : null]),
        h("dt", {}, [tr("ui.zone.slots")]), h("dd", {}, [String(d.businessSlots)]),
        h("dt", {}, [tr("ui.zone.owner")]), h("dd", {}, [d.owner ? h("span", { style: `color:${d.owner.color}` }, [d.owner.name]) : tr("ui.zone.no_owner")]),
      ]),
      h("h3", {}, [tr("ui.zone.control")]),
      ...d.control.map((c) =>
        h("div", { class: "bar-row" }, [
          h("span", { class: "bar-label" }, [c.name]),
          h("span", { class: "bar" }, [h("span", { class: "bar-fill", style: `width:${c.value}%;background:${c.color}` })]),
          h("span", { class: "mono" }, [String(c.value)]),
        ]),
      ),
      h("p", { class: "muted" }, [tr("ui.zone.free_control", { value: d.freeControl })]),
      h("h3", {}, [tr("ui.zone.neighbors")]),
      h(
        "div",
        { class: "chips" },
        d.neighbors.map((n) =>
          h("button", { class: "chip", onclick: () => { selectedZoneId = n.id; render(); } }, [n.name]),
        ),
      ),
      h("h3", {}, [tr("ui.zone.planned")]),
      planned.length > 0 ? h("ul", {}, planned.map((p) => h("li", {}, [p]))) : h("p", { class: "muted" }, [tr("ui.zone.nobody")]),
    ]);
  }

  // ---------- Report tab ----------

  function renderReport(): HTMLElement {
    const sections = reportSections(report, data, state.playerFactionId);
    if (sections.length === 0) return h("p", { class: "hint" }, [tr("ui.report_empty")]);
    return h("div", { class: "report" }, [
      h("h2", {}, [tr("play.report_title", { week: state.week - 1 })]),
      ...sections.flatMap((sec) => [h("h3", {}, [sec.title]), h("ul", {}, sec.lines.map((l) => h("li", {}, [l])))]),
    ]);
  }

  // ---------- Layout ----------

  function render(): void {
    els.topBar.replaceChildren(renderTopBar());
    const tabs = h(
      "nav",
      { class: "tabs" },
      TABS.map((id) =>
        h("button", { class: id === tab ? "tab active" : "tab", onclick: () => { tab = id; render(); } }, [tr(`ui.tab.${id}`)]),
      ),
    );
    const body = tab === "club" ? renderClub() : tab === "zone" ? renderZone() : renderReport();
    els.sidebar.replaceChildren(tabs, h("div", { class: "tab-body" }, [body]));
    map.update(mapViewModel(state, data, state.playerFactionId, selectedZoneId));
  }

  render();
}

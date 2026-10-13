// Browser game controller. Holds the current GameState and the player's draft orders,
// builds the panels and calls resolveTurn. It never changes GameState directly (CLAUDE.md, rule 8).

import type { GameData } from "../data/schemas";
import { createMapView, type MapView } from "../render/map";
import { availableTasks, reachableZones } from "../sim/orders";
import type { ReportEntry } from "../sim/report";
import { createInitialState } from "../sim/setup";
import { promotionOptions, validateProposal, type Proposal } from "../sim/council";
import { PROPOSAL_TYPES, type GameState, type MemberState, type ProposalType, type Rank } from "../sim/state";
import { allAiOrders } from "../sim/systems/ai";
import { resolveTurn } from "../sim/turn";
import { h } from "./dom";
import { carryOverDraft, draftProblems, draftToOrders, type Draft } from "./draft";
import { reportSections } from "./report";
import { clearAutosave, loadAutosave, saveAutosave } from "./storage";
import { t } from "./strings";
import { diplomacyRows, mapViewModel, memberRows, topBarModel, votePreview, zoneDetails } from "./viewModel";

type Tab = "club" | "council" | "zone" | "report";

const PLAYER_FACTION = "faction_iron_saints";
const TABS: Tab[] = ["club", "council", "zone", "report"];

interface ProposalForm {
  type: ProposalType;
  targetMemberId: string;
  targetFactionId: string;
  newRank: string;
  force: boolean;
}

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
  let proposals: Proposal[] = [];
  let form: ProposalForm = { type: "promote", targetMemberId: "", targetFactionId: "", newRank: "", force: false };

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
    const result = resolveTurn(state, { assignments: [...mine, ...ai], proposals }, data);
    proposals = [];
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
    proposals = [];
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
        h("div", { class: "stat" }, [h("span", { style: `color:${r.color}` }, [r.name]), " ", tr("ui.relation", { value: r.value, state: tr(r.stateKey) })]),
      ),
      h("div", { class: m.lowLoyalty ? "stat warn" : "stat" }, [
        m.averageLoyalty === null ? "" : tr("ui.average_loyalty", { value: m.averageLoyalty }),
        m.unrestWeeks > 0 ? tr("ui.unrest", { weeks: m.unrestWeeks, limit: m.unrestLimit }) : "",
      ]),
      h("div", { class: "stat" }, [tr("ui.sheriff", { value: m.sheriffRelation })]),
      h("div", { class: m.federal === null ? "stat muted" : "stat warn" }, [
        m.federal === null ? tr("ui.federal_hidden") : tr("ui.federal", { value: m.federal }),
      ]),
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
          h("div", { class: member.loyalty < data.balance.club.lowLoyaltyThreshold ? "error" : "muted" }, [
            tr("ui.loyalty", { value: member.loyalty }),
            member.loyalty < data.balance.club.lowLoyaltyThreshold ? tr("ui.loyalty_danger") : "",
          ]),
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

  // ---------- Council tab ----------

  function formToProposal(): Proposal {
    return {
      factionId: state.playerFactionId,
      type: form.type,
      targetMemberId: form.targetMemberId || undefined,
      targetFactionId: form.targetFactionId || undefined,
      newRank: (form.newRank || undefined) as Rank | undefined,
      force: form.force,
    };
  }

  function renderCouncil(): HTMLElement {
    const viewer = state.playerFactionId;
    const members = memberRows(state, viewer).filter((m) => m.rank !== "president");
    const clubs = diplomacyRows(state, data, viewer);
    const needsMember = form.type === "promote" || form.type === "expel";
    const rankOptions = form.type === "promote" && form.targetMemberId ? promotionOptions(state, form.targetMemberId) : [];
    const pending = formToProposal();
    const problem = validateProposal(state, data, pending, proposals.length);
    const set = (patch: Partial<ProposalForm>) => {
      form = { ...form, ...patch };
      render();
    };

    const field = (label: string, control: HTMLElement) => h("label", { class: "field" }, [h("span", {}, [label]), control]);
    const typeSelect = h(
      "select",
      { onchange: (e: Event) => set({ type: (e.target as HTMLSelectElement).value as ProposalType, newRank: "" }) },
      PROPOSAL_TYPES.map((type) => h("option", { value: type, selected: type === form.type }, [tr(`proposal.${type}`)])),
    );
    const targetSelect = needsMember
      ? h(
          "select",
          { onchange: (e: Event) => set({ targetMemberId: (e.target as HTMLSelectElement).value, newRank: "" }) },
          [
            h("option", { value: "" }, [tr("ui.council.pick_member")]),
            ...members.map((m) =>
              h("option", { value: m.id, selected: m.id === form.targetMemberId }, [`${m.nickname || m.name} (${tr(`rank.${m.rank}`)})`]),
            ),
          ],
        )
      : h(
          "select",
          { onchange: (e: Event) => set({ targetFactionId: (e.target as HTMLSelectElement).value }) },
          [
            h("option", { value: "" }, [tr("ui.council.pick_club")]),
            ...clubs.map((c) => h("option", { value: c.id, selected: c.id === form.targetFactionId }, [c.name])),
          ],
        );
    const rankSelect =
      form.type === "promote"
        ? field(
            tr("ui.council.new_rank"),
            h(
              "select",
              { disabled: rankOptions.length === 0, onchange: (e: Event) => set({ newRank: (e.target as HTMLSelectElement).value }) },
              [
                h("option", { value: "" }, [rankOptions.length === 0 ? tr("ui.council.no_rank") : tr("ui.council.pick_rank")]),
                ...rankOptions.map((r) => h("option", { value: r, selected: r === form.newRank }, [tr(`rank.${r}`)])),
              ],
            ),
          )
        : null;

    const preview = votePreview(state, data, viewer, form.type, form.targetMemberId || undefined);
    return h("div", { class: "council" }, [
      h("p", { class: "hint" }, [tr("ui.council.hint")]),
      h("h3", {}, [tr("ui.council.diplomacy")]),
      h(
        "ul",
        {},
        clubs.map((c) =>
          h("li", {}, [
            h("span", { style: `color:${c.color}` }, [c.name]),
            ": ",
            tr(c.stateKey),
            c.truceWeeksLeft !== null ? tr("ui.council.truce_left", { weeks: c.truceWeeksLeft }) : "",
            c.warWeeks !== null ? tr("ui.council.war_weeks", { weeks: c.warWeeks }) : "",
          ]),
        ),
      ),
      h("h3", {}, [tr("ui.council.new_proposal")]),
      h("div", { class: "form" }, [
        field(tr("ui.council.type"), typeSelect),
        field(needsMember ? tr("ui.council.member") : tr("ui.council.club"), targetSelect),
        rankSelect,
        h("label", { class: "check" }, [
          h("input", { type: "checkbox", checked: form.force, onchange: (e: Event) => set({ force: (e.target as HTMLInputElement).checked }) }),
          " ",
          tr("ui.council.force"),
        ]),
        problem ? h("div", { class: "error" }, [tr(problem)]) : null,
        h(
          "button",
          {
            class: "primary",
            disabled: problem !== null,
            onclick: () => {
              proposals = [...proposals, pending];
              form = { ...form, targetMemberId: "", targetFactionId: "", newRank: "", force: false };
              render();
            },
          },
          [tr("ui.council.add")],
        ),
      ]),
      h("h3", {}, [tr("ui.council.preview")]),
      h(
        "ul",
        { class: "votes" },
        preview.map((v) =>
          h("li", {}, [
            h("span", {}, [v.name]),
            h("span", { class: "mono" }, [v.fixed === "yes" ? tr("ui.council.votes_yes") : v.fixed === "no" ? tr("ui.council.votes_no") : `${v.chance}%`]),
          ]),
        ),
      ),
      h("p", { class: "muted" }, [tr("ui.council.preview_note")]),
      h("h3", {}, [tr("ui.council.pending")]),
      proposals.length === 0
        ? h("p", { class: "muted" }, [tr("ui.council.none")])
        : h(
            "ul",
            {},
            proposals.map((p, i) =>
              h("li", {}, [
                proposalLabel(p),
                " ",
                h("button", { class: "chip", onclick: () => { proposals = proposals.filter((_, j) => j !== i); render(); } }, [tr("ui.council.remove")]),
              ]),
            ),
          ),
    ]);
  }

  function proposalLabel(p: Proposal): string {
    const member = p.targetMemberId ? state.members[p.targetMemberId] : undefined;
    const target = member ? member.nickname || member.name : data.factions.find((f) => f.id === p.targetFactionId)?.name ?? "";
    const rank = p.newRank ? ` → ${tr(`rank.${p.newRank}`)}` : "";
    return `${tr(`proposal.${p.type}`)}: ${target}${rank}${p.force ? tr("ui.council.forced") : ""}`;
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
    const body = tab === "club" ? renderClub() : tab === "council" ? renderCouncil() : tab === "zone" ? renderZone() : renderReport();
    els.sidebar.replaceChildren(tabs, h("div", { class: "tab-body" }, [body]));
    map.update(mapViewModel(state, data, state.playerFactionId, selectedZoneId));
  }

  render();
}

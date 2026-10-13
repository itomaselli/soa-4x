// Browser game controller. Holds the current GameState and the player's draft orders,
// builds the panels and calls resolveTurn. It never changes GameState directly (CLAUDE.md, rule 8).

import type { GameData } from "../data/schemas";
import { createMapView, type HoverTarget, type MapView } from "../render/map";
import { availableTasks, reachableZones } from "../sim/orders";
import type { ReportEntry } from "../sim/report";
import { createInitialState } from "../sim/setup";
import { promotionOptions, validateProposal, type Proposal } from "../sim/council";
import { PROPOSAL_TYPES, type GameState, type MemberState, type ProposalType, type Rank } from "../sim/state";
import { allAiOrders } from "../sim/systems/ai";
import { resolveTurn } from "../sim/turn";
import { h } from "./dom";
import { patchCanvas } from "./patchCanvas";
import { portraitCanvas } from "./portraitCanvas";
import { patchNameParts } from "../render/patch";
import { CLUB_NAME_MAX_LENGTH, withIdentities } from "../sim/identity";
import { carryOverDraft, draftProblems, draftToOrders, type Draft } from "./draft";
import { reportSections } from "./report";
import { clearAutosave, exportSave, importSave, loadAutosave, loadRenderMode, saveAutosave, saveRenderMode } from "./storage";
import { t } from "./strings";
import {
  buildableZones,
  businessRows,
  cartelInfo,
  diplomacyRows,
  goodRows,
  launderingInfo,
  mapViewModel,
  memberRows,
  pendingEventViews,
  topBarModel,
  votePreview,
  zoneBusinesses,
  zoneDetails,
  zoneTooltip,
  localViewModel,
  lotDetails,
  memberSheet,
} from "./viewModel";
import { validateManagement, type ManagementOrder } from "../sim/management";

type Tab = "club" | "council" | "business" | "zone" | "report";

const PLAYER_FACTION = "faction_iron_saints";
const TABS: Tab[] = ["club", "council", "business", "zone", "report"];

interface ProposalForm {
  type: ProposalType;
  targetMemberId: string;
  targetFactionId: string;
  newRank: string;
  businessTypeId: string;
  zoneId: string;
  force: boolean;
}

export interface AppElements {
  mapBar: HTMLElement;
  topBar: HTMLElement;
  mapHost: HTMLElement;
  sidebar: HTMLElement;
  legend: HTMLElement;
  tooltip: HTMLElement;
  overlay: HTMLElement;
}

/** Random seed for a new game. UI code may use the browser's randomness; the sim never does. */
function newSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

export async function startApp(content: GameData, els: AppElements): Promise<void> {
  // `data` is the content with this game's club names and patches applied (phase 11); refreshed in render().
  let data = content;
  const s = data.strings;
  const tr = (key: string, params: Record<string, string | number> = {}) => t(s, key, params);

  const saved = loadAutosave(content);
  let state: GameState = saved ?? createInitialState(content, { seed: newSeed(), playerFactionId: PLAYER_FACTION });
  data = withIdentities(content, state);
  const defaultPatch = content.factions.find((f) => f.id === PLAYER_FACTION)?.patchId ?? content.patches.patches[0]?.id ?? "";
  /** New game screen (phase 11): open on first launch and from "Nueva partida". */
  let newGameForm: { name: string; patchId: string; firstTime: boolean } | null = saved
    ? null
    : { name: content.factions.find((f) => f.id === PLAYER_FACTION)?.name ?? "", patchId: defaultPatch, firstTime: true };
  let report: ReportEntry[] = [];
  let draft: Draft = {};
  let tab: Tab = "club";
  let selectedZoneId: string | null = data.factions.find((f) => f.id === state.playerFactionId)?.hqZoneId ?? null;
  let focusedMemberId: string | null = null;
  let proposals: Proposal[] = [];
  let form: ProposalForm = { type: "promote", targetMemberId: "", targetFactionId: "", newRank: "", businessTypeId: "", zoneId: "", force: false };
  let management: ManagementOrder[] = [];
  let eventChoices: Record<string, string> = {};
  let buildForm = { typeId: "", zoneId: "" };
  let launderAmount = 0;
  const buyQuantities: Record<string, number> = {};
  const sellAmounts: Record<string, number> = {};
  let notice: { text: string; error: boolean } | null = null;
  let showHelp = false;
  let renderMode = loadRenderMode();
  let outcomeDismissed = false;
  /** District shown zoomed in on the map (phase 10), or null for the county view. */
  let localZoneId: string | null = null;
  let selectedLot: number | null = null;
  /** Member whose sheet is open (window over the game), or null. */
  let sheetMemberId: string | null = null;

  const enterZone = (zoneId: string) => {
    localZoneId = zoneId;
    selectedZoneId = zoneId;
    selectedLot = null;
    tab = "zone";
    els.tooltip.hidden = true;
    render();
  };

  const map: MapView = await createMapView(els.mapHost, data, {
    onZoneClick: (zoneId) => {
      selectedZoneId = zoneId;
      const entry = focusedMemberId ? draft[focusedMemberId] : undefined;
      if (focusedMemberId && entry && reachableZones(state, data, state.playerFactionId).includes(zoneId)) {
        draft = { ...draft, [focusedMemberId]: { ...entry, zoneId } };
      } else if (tab !== "club") {
        tab = "zone";
      }
      render();
    },
    onZoneEnter: enterZone,
    onExitClick: enterZone,
    onLotClick: (lot) => {
      selectedLot = lot;
      tab = "zone";
      render();
    },
    onHover: (target, x, y) => showTooltip(target, x, y),
  });

  function showTooltip(target: HoverTarget | null, x: number, y: number): void {
    if (target?.kind === "lot" && localZoneId) {
      const lot = lotDetails(state, data, state.playerFactionId, localZoneId, target.index);
      els.tooltip.replaceChildren(
        h("strong", {}, [tr("ui.lot.title", { index: target.index + 1 })]),
        lot.business
          ? h("div", {}, [tr(lot.business.typeKey), " · ", h("span", { style: `color:${lot.business.color}` }, [lot.business.owner])])
          : h("div", { class: "muted" }, [tr("ui.lot.empty")]),
      );
    } else if (target?.kind === "exit") {
      els.tooltip.replaceChildren(h("div", {}, [tr("ui.lot.exit", { zone: data.zones.find((z) => z.id === target.zoneId)?.name ?? "" })]));
    }
    if (target && target.kind !== "zone") {
      els.tooltip.style.left = `${x + 14}px`;
      els.tooltip.style.top = `${y + 14}px`;
      els.tooltip.hidden = false;
      return;
    }
    const zoneId = target?.kind === "zone" ? target.zoneId : null;
    const tip = zoneId ? zoneTooltip(state, data, zoneId, state.playerFactionId) : null;
    if (!tip) {
      els.tooltip.hidden = true;
      return;
    }
    els.tooltip.replaceChildren(
      h("strong", {}, [tip.name]),
      h("div", { class: "muted" }, [tr(tip.typeKey)]),
      h("div", {}, [tr("ui.tip.owner"), " ", tip.owner ? h("span", { style: `color:${tip.owner.color}` }, [tip.owner.name]) : tr("ui.zone.no_owner")]),
      h("div", {}, [tr("ui.tip.control", { value: tip.ourControl })]),
      h("div", { class: tip.patrols ? "warn" : "" }, [tr("ui.tip.heat", { value: tip.heat })]),
      tip.businesses > 0 ? h("div", {}, [tr("ui.tip.businesses", { count: tip.businesses })]) : "",
    );
    els.tooltip.style.left = `${x + 14}px`;
    els.tooltip.style.top = `${y + 14}px`;
    els.tooltip.hidden = false;
  }

  function saveToFile(): void {
    exportSave(state, `biker4x-semana-${state.week}.json`);
    notice = { text: tr("ui.saved_file"), error: false };
    render();
  }

  async function loadFromFile(file: File): Promise<void> {
    try {
      state = await importSave(file, data);
      report = [];
      draft = {};
      proposals = [];
      management = [];
      eventChoices = {};
      outcomeDismissed = false;
      saveAutosave(state);
      notice = { text: tr("ui.loaded_file", { week: state.week }), error: false };
    } catch (error) {
      notice = { text: `${tr("ui.load_failed")}\n${(error as Error).message}`, error: true };
    }
    render();
  }

  // Clicking outside the member sheet closes it.
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay && sheetMemberId) {
      sheetMemberId = null;
      render();
    }
  });

  // Enter advances the week when the focus isn't on a form control.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetMemberId) {
      sheetMemberId = null;
      render();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (e.key !== "Enter" || !target || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
    advanceWeek();
  });

  function advanceWeek(): void {
    if (state.outcome) return;
    const mine = draftToOrders(draft).assignments;
    const aiOrders = allAiOrders(state, data, state.playerFactionId);
    const ai = aiOrders.assignments;
    const result = resolveTurn(
      state,
      {
        assignments: [...mine, ...ai],
        proposals: [...proposals, ...(aiOrders.proposals ?? [])],
        management: [...management, ...(aiOrders.management ?? [])],
        eventChoices: Object.entries(eventChoices).map(([instanceId, optionId]) => ({ instanceId, optionId })),
      },
      data,
    );
    proposals = [];
    management = [];
    eventChoices = {};
    state = result.state;
    report = result.report;
    draft = carryOverDraft(draft, state, data);
    focusedMemberId = null;
    tab = "report";
    notice = null;
    saveAutosave(state);
    render();
  }

  function newGame(): void {
    const current = state.identities[state.playerFactionId];
    newGameForm = { name: current?.name ?? "", patchId: current?.patchId ?? defaultPatch, firstTime: false };
    render();
  }

  function startNewGame(name: string, patchId: string): void {
    clearAutosave();
    state = createInitialState(content, { seed: newSeed(), playerFactionId: PLAYER_FACTION, clubName: name, patchId });
    newGameForm = null;
    localZoneId = null;
    selectedLot = null;
    report = [];
    draft = {};
    proposals = [];
    management = [];
    eventChoices = {};
    tab = "club";
    outcomeDismissed = false;
    notice = null;
    saveAutosave(state);
    render();
  }

  // ---------- Top bar ----------

  function renderTopBar(): HTMLElement {
    const m = topBarModel(state, data, state.playerFactionId);
    const outcome = state.outcome;
    return h("div", { class: "topbar" }, [
      h("div", { class: "brand" }, [tr("app.title")]),
      h("div", { class: "club-id" }, [patchCanvas(data, m.patchId, 2), h("strong", {}, [m.factionName])]),
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
      (() => {
        const mine = state.pendingEvents.filter((e) => e.factionId === state.playerFactionId).length;
        return mine > 0
          ? h("button", { class: "warn-chip", onclick: () => { tab = "report"; render(); } }, [tr("ui.events_pending", { count: mine })])
          : null;
      })(),
      h("div", { class: "spacer" }),
      outcome
        ? h("div", { class: `outcome ${outcome.result}` }, [tr(outcome.reasonKey)])
        : h("button", { class: "primary", onclick: advanceWeek }, [tr("ui.advance_week")]),
      h("button", { onclick: saveToFile, title: tr("ui.save_file_hint") }, [tr("ui.save_file")]),
      h("label", { class: "button", title: tr("ui.load_file_hint") }, [
        tr("ui.load_file"),
        h("input", {
          type: "file",
          accept: "application/json,.json",
          hidden: true,
          onchange: (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void loadFromFile(file);
          },
        }),
      ]),
      h("button", { onclick: newGame }, [tr("ui.new_game")]),
      h("button", { onclick: () => { showHelp = true; render(); }, title: tr("ui.help") }, ["?"]),
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
        h(
          "td",
          {
            class: "member-cell",
            title: tr("ui.sheet.open"),
            onclick: (e: Event) => {
              e.stopPropagation();
              sheetMemberId = member.id;
              render();
            },
          },
          [
            portraitCanvas(data, member, data.factions.find((f) => f.id === member.factionId)?.patchId ?? null, 2),
            h("div", {}, [
              h("strong", {}, [member.nickname || member.name]),
              " ",
              h("span", { class: "muted" }, [member.name]),
              h("div", { class: "muted" }, [tr(`rank.${member.rank}`), " · ", tr(`trait.${member.trait}`), " · ", statusText]),
            ]),
          ],
        ),
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
    const me = topBarModel(state, data, state.playerFactionId);
    return h("div", {}, [
      h("div", { class: "club-id club-header" }, [patchCanvas(data, me.patchId, 4), h("h2", {}, [me.factionName])]),
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
      targetFactionId: form.type === "cartel_deal" ? (cartelInfo(state, data, state.playerFactionId).cartelId ?? undefined) : form.targetFactionId || undefined,
      businessTypeId: form.businessTypeId || undefined,
      zoneId: form.zoneId || undefined,
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
    const illegalTypes = data.businesses.filter((b) => !b.legal);
    const buildZones = buildableZones(state, data, viewer);
    const targetSelect =
      form.type === "cartel_deal"
        ? h("span", {}, [data.factions.find((f) => f.kind === "cartel")?.name ?? ""])
        : form.type === "open_illegal_business"
          ? h("span", { class: "row" }, [
              h(
                "select",
                { onchange: (e: Event) => set({ businessTypeId: (e.target as HTMLSelectElement).value }) },
                [h("option", { value: "" }, [tr("ui.biz.pick_type")]), ...illegalTypes.map((b) => h("option", { value: b.id, selected: b.id === form.businessTypeId }, [`${tr(`business.${b.id}`)} ($${b.buildCost})`]))],
              ),
              h(
                "select",
                { onchange: (e: Event) => set({ zoneId: (e.target as HTMLSelectElement).value }) },
                [h("option", { value: "" }, [tr("ui.biz.pick_zone")]), ...buildZones.map((z) => h("option", { value: z, selected: z === form.zoneId }, [data.zones.find((d) => d.id === z)?.name ?? z]))],
              ),
            ])
          : needsMember
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
        field(needsMember ? tr("ui.council.member") : form.type === "open_illegal_business" ? tr("ui.council.business") : tr("ui.council.club"), targetSelect),
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
              form = { ...form, targetMemberId: "", targetFactionId: "", newRank: "", businessTypeId: "", zoneId: "", force: false };
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
    const target = member
      ? member.nickname || member.name
      : p.businessTypeId && p.zoneId
        ? `${tr(`business.${p.businessTypeId}`)} (${data.zones.find((z) => z.id === p.zoneId)?.name ?? p.zoneId})`
        : data.factions.find((f) => f.id === p.targetFactionId)?.name ?? "";
    const rank = p.newRank ? ` → ${tr(`rank.${p.newRank}`)}` : "";
    return `${tr(`proposal.${p.type}`)}: ${target}${rank}${p.force ? tr("ui.council.forced") : ""}`;
  }

  // ---------- Business tab ----------

  function renderBusiness(): HTMLElement {
    const viewer = state.playerFactionId;
    const addOrder = (order: ManagementOrder) => {
      management = [...management, order];
      render();
    };
    const problemOf = (order: ManagementOrder) => validateManagement(state, data, order);
    const zoneLabel = (id: string) => data.zones.find((z) => z.id === id)?.name ?? id;

    const legalTypes = data.businesses.filter((b) => b.legal);
    const zones = buildableZones(state, data, viewer);
    const buildOrder: ManagementOrder | null =
      buildForm.typeId && buildForm.zoneId ? { kind: "build", factionId: viewer, typeId: buildForm.typeId, zoneId: buildForm.zoneId } : null;
    const buildProblemKey = buildOrder ? problemOf(buildOrder) : null;

    const laundering = launderingInfo(state, data, viewer);
    const launderOrder: ManagementOrder | null = launderAmount > 0 ? { kind: "launder", factionId: viewer, amount: launderAmount } : null;
    const cartel = cartelInfo(state, data, viewer);

    const numberInput = (value: number, onChange: (n: number) => void, max?: number) =>
      h("input", {
        type: "number",
        min: "0",
        max: max !== undefined ? String(max) : false,
        value: String(value),
        class: "num",
        onchange: (e: Event) => {
          onChange(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)));
          render();
        },
      });

    return h("div", { class: "business" }, [
      h("p", { class: "hint" }, [tr("ui.biz.hint")]),
      h("h3", {}, [tr("ui.biz.ours")]),
      (() => {
        const rows = businessRows(state, data, viewer);
        return rows.length === 0
          ? h("p", { class: "muted" }, [tr("ui.biz.none")])
          : h("ul", {}, rows.map((b) => h("li", {}, [tr(b.typeKey), ` · ${b.zone} · `, tr(b.statusKey), b.legal ? "" : tr("ui.biz.illegal")])));
      })(),

      h("h3", {}, [tr("ui.biz.stock")]),
      h(
        "table",
        { class: "goods" },
        goodRows(state, data, viewer).map((g) => {
          const qty = Math.min(sellAmounts[g.id] ?? g.stock, g.stock);
          const order: ManagementOrder = { kind: "sell", factionId: viewer, goodId: g.id, quantity: qty };
          return h("tr", {}, [
            h("td", {}, [tr(g.nameKey)]),
            h("td", { class: "mono" }, [String(g.stock)]),
            h("td", { class: "mono" }, [g.price === null ? tr("ui.biz.not_sold") : `$${g.price} ${tr(g.currencyKey ?? "")}`]),
            h("td", {}, [
              g.price !== null && g.id !== data.balance.tasks.gunRun.goodId && !g.streetOnly
                ? h("span", { class: "row" }, [
                    numberInput(qty, (n) => (sellAmounts[g.id] = n), g.stock),
                    h("button", { disabled: qty <= 0 || problemOf(order) !== null, onclick: () => addOrder(order) }, [tr("ui.biz.sell")]),
                  ])
                : g.id === data.balance.tasks.gunRun.goodId
                  ? h("span", { class: "muted" }, [tr("ui.biz.guns_by_run")])
                  : g.streetOnly
                    ? h("span", { class: "muted" }, [tr("ui.biz.street_only")])
                    : null,
            ]),
          ]);
        }),
      ),

      h("h3", {}, [tr("ui.biz.build")]),
      h("div", { class: "form" }, [
        h(
          "select",
          { onchange: (e: Event) => { buildForm = { ...buildForm, typeId: (e.target as HTMLSelectElement).value }; render(); } },
          [h("option", { value: "" }, [tr("ui.biz.pick_type")]), ...legalTypes.map((b) => h("option", { value: b.id, selected: b.id === buildForm.typeId }, [`${tr(`business.${b.id}`)} ($${b.buildCost}, ${tr("ui.biz.upkeep", { cost: b.maintenance })})`]))],
        ),
        h(
          "select",
          { onchange: (e: Event) => { buildForm = { ...buildForm, zoneId: (e.target as HTMLSelectElement).value }; render(); } },
          [h("option", { value: "" }, [zones.length === 0 ? tr("ui.biz.no_zone") : tr("ui.biz.pick_zone")]), ...zones.map((z) => h("option", { value: z, selected: z === buildForm.zoneId }, [zoneLabel(z)]))],
        ),
        buildProblemKey ? h("div", { class: "error" }, [tr(buildProblemKey)]) : null,
        h("button", { disabled: !buildOrder || buildProblemKey !== null, onclick: () => { if (buildOrder) addOrder(buildOrder); buildForm = { typeId: "", zoneId: "" }; render(); } }, [tr("ui.biz.add_build")]),
        h("p", { class: "muted" }, [tr("ui.biz.illegal_hint")]),
      ]),

      h("h3", {}, [tr("ui.biz.launder")]),
      laundering.capacity === 0
        ? h("p", { class: "muted" }, [tr("ui.biz.no_laundering")])
        : h("div", { class: "form" }, [
            h("p", { class: "muted" }, [tr("ui.biz.launder_info", { capacity: laundering.capacity, safe: laundering.safe })]),
            h("span", { class: "row" }, [
              numberInput(launderAmount, (n) => (launderAmount = n), laundering.capacity),
              h("button", { disabled: !launderOrder, onclick: () => { if (launderOrder) addOrder(launderOrder); launderAmount = 0; render(); } }, [tr("ui.biz.add_launder")]),
            ]),
            launderAmount > laundering.safe ? h("div", { class: "error" }, [tr("ui.biz.launder_warning")]) : null,
          ]),

      h("h3", {}, [tr("ui.biz.cartel")]),
      !cartel.dealing
        ? h("p", { class: "muted" }, [tr("ui.biz.no_deal")])
        : h("div", { class: "form" }, [
            h("p", { class: "muted" }, [tr("ui.biz.deal_info", { weeks: cartel.weeksLeft ?? 0 })]),
            ...cartel.catalog.map((item) => {
              const quantity = Math.max(1, buyQuantities[item.goodId] ?? 1);
              const order: ManagementOrder = { kind: "buy", factionId: viewer, goodId: item.goodId, quantity };
              const problem = problemOf(order);
              return h("div", {}, [
                h("span", { class: "row" }, [
                  `${tr(item.nameKey)} · $${item.price} · ${tr("ui.biz.space", { space: item.space })}`,
                  numberInput(quantity, (n) => (buyQuantities[item.goodId] = Math.max(1, n)), Math.max(1, item.space)),
                  h("button", { disabled: problem !== null, onclick: () => addOrder(order) }, [tr("ui.biz.buy")]),
                ]),
                problem ? h("div", { class: "error" }, [tr(problem)]) : null,
              ]);
            }),
          ]),

      h("h3", {}, [tr("ui.biz.pending")]),
      management.length === 0
        ? h("p", { class: "muted" }, [tr("ui.council.none")])
        : h(
            "ul",
            {},
            management.map((o, i) =>
              h("li", {}, [
                managementLabel(o),
                " ",
                h("button", { class: "chip", onclick: () => { management = management.filter((_, j) => j !== i); render(); } }, [tr("ui.council.remove")]),
              ]),
            ),
          ),
    ]);
  }

  function managementLabel(o: ManagementOrder): string {
    switch (o.kind) {
      case "build":
        return `${tr("management.build")}: ${tr(`business.${o.typeId}`)} (${data.zones.find((z) => z.id === o.zoneId)?.name ?? o.zoneId})`;
      case "sell":
        return `${tr("management.sell")}: ${o.quantity} × ${tr(`good.${o.goodId}`)}`;
      case "launder":
        return `${tr("management.launder")}: $${o.amount}`;
      case "buy":
        return `${tr("management.buy")}: ${o.quantity} × ${tr(`good.${o.goodId}`)}`;
    }
  }

  // ---------- Zone tab ----------

  function renderLot(zoneId: string, lot: number): HTMLElement {
    const d = lotDetails(state, data, state.playerFactionId, zoneId, lot);
    const viewer = state.playerFactionId;
    return h("div", { class: "lot" }, [
      h("h3", {}, [tr("ui.lot.title", { index: lot + 1 })]),
      d.business
        ? h("p", {}, [tr(d.business.typeKey), " · ", h("span", { style: `color:${d.business.color}` }, [d.business.owner]), " · ", tr(d.business.statusKey)])
        : h("p", { class: "muted" }, [tr("ui.lot.empty")]),
      d.business && !d.business.ours ? h("p", { class: "hint" }, [tr("ui.lot.attack_hint")]) : null,
      ...(d.business
        ? []
        : d.options.map((o) => {
            const blocked = o.problem !== null && o.problem !== "build_error.no_money";
            const order = (): void => {
              if (o.legal) management = [...management, { kind: "build", factionId: viewer, typeId: o.typeId, zoneId, lot }];
              else proposals = [...proposals, { factionId: viewer, type: "open_illegal_business", businessTypeId: o.typeId, zoneId, lot }];
              render();
            };
            return h("div", { class: "row lot-option" }, [
              h("button", { disabled: o.problem !== null, onclick: order }, [
                o.legal ? tr("ui.lot.build", { name: tr(o.nameKey), cost: o.cost }) : tr("ui.lot.propose", { name: tr(o.nameKey), cost: o.cost }),
              ]),
              o.problem && !blocked ? h("span", { class: "error" }, [tr(o.problem)]) : null,
              blocked ? h("span", { class: "muted" }, [tr(o.problem!)]) : null,
            ]);
          })),
    ]);
  }

  function renderZone(): HTMLElement {
    const d = selectedZoneId ? zoneDetails(state, data, selectedZoneId, state.playerFactionId) : null;
    if (!d) return h("p", { class: "hint" }, [tr("ui.zone_none")]);
    const lotPanel = localZoneId === d.id && selectedLot !== null ? renderLot(d.id, selectedLot) : null;
    const planned = Object.entries(draft)
      .filter(([, e]) => e.zoneId === d.id)
      .map(([memberId, e]) => `${state.members[memberId]?.nickname ?? memberId}: ${tr(`task.${e.taskId}`)}`);
    return h("div", { class: "zone" }, [
      h("h2", {}, [d.name]),
      h("p", { class: "muted" }, [tr(d.typeKey), " · ", d.reachable ? tr("ui.zone_reachable") : tr("ui.zone_unreachable")]),
      localZoneId === d.id
        ? h("p", { class: "hint" }, [tr("ui.lot.hint")])
        : h("button", { class: "primary", onclick: () => enterZone(d.id) }, [tr("ui.zone.enter")]),
      lotPanel,
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
      h("h3", {}, [tr("ui.zone.businesses")]),
      (() => {
        const list = zoneBusinesses(state, data, d.id);
        return list.length === 0
          ? h("p", { class: "muted" }, [tr("ui.zone.nobody")])
          : h("ul", {}, list.map((b) => h("li", {}, [tr(b.typeKey), " · ", h("span", { style: `color:${b.color}` }, [b.owner])])));
      })(),
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

  function renderEvents(): HTMLElement | null {
    const events = pendingEventViews(state, data, state.playerFactionId);
    if (events.length === 0) return null;
    return h(
      "div",
      { class: "events" },
      events.map((ev) =>
        h("div", { class: "event" }, [
          h("h3", {}, [tr(ev.titleKey)]),
          h("p", {}, [tr(ev.textKey, { subject: ev.subject })]),
          ...ev.options.map((o) =>
            h("label", { class: o.affordable ? "check" : "check muted" }, [
              h("input", {
                type: "radio",
                name: ev.instanceId,
                disabled: !o.affordable,
                checked: (eventChoices[ev.instanceId] ?? ev.options.find((x) => x.isDefault)?.id) === o.id,
                onchange: () => { eventChoices = { ...eventChoices, [ev.instanceId]: o.id }; },
              }),
              " ",
              tr(o.labelKey),
              o.isDefault ? tr("ui.event.default") : "",
              o.affordable ? "" : tr("ui.event.cant_afford"),
            ]),
          ),
        ]),
      ),
    );
  }

  function renderReport(): HTMLElement {
    const sections = reportSections(report, data, state.playerFactionId);
    const events = renderEvents();
    if (sections.length === 0) return h("div", {}, [events, events ? null : h("p", { class: "hint" }, [tr("ui.report_empty")])]);
    return h("div", { class: "report" }, [
      events,
      h("h2", {}, [tr("play.report_title", { week: state.week - 1 })]),
      ...sections.flatMap((sec) => [h("h3", {}, [sec.title]), h("ul", {}, sec.lines.map((l) => h("li", {}, [l])))]),
    ]);
  }

  // ---------- Layout ----------

  function renderLegend(): HTMLElement {
    const { colors } = data.ui;
    const sw = (color: string, ch: string) => h("span", { class: "mono", style: `color:${color}` }, [ch]);
    const toggle = h(
      "button",
      {
        class: "chip",
        onclick: () => {
          renderMode = renderMode === "tiles" ? "ascii" : "tiles";
          saveRenderMode(renderMode);
          render();
        },
      },
      [tr(renderMode === "tiles" ? "ui.legend.to_ascii" : "ui.legend.to_tiles")],
    );
    if (localZoneId) {
      return h("div", { class: "legend" }, [
        h("span", {}, [sw(data.ui.localMap.colors.lot ?? colors.selected, "[+]"), " ", tr("ui.legend.lot_free")]),
        h("span", {}, [sw(colors.selected, "> v"), " ", tr("ui.legend.exits")]),
        h("span", {}, [sw(data.ui.localMap.colors.member ?? colors.glyph, "@"), " ", tr("ui.legend.members_here")]),
        toggle,
      ]);
    }
    return h("div", { class: "legend" }, [
      ...data.factions
        .filter((f) => f.kind === "club" || f.kind === "cartel")
        .map((f) => h("span", {}, [sw(f.color, "##"), " ", f.name])),
      h("span", {}, [sw(colors.border.open, "· ·"), " ", tr("ui.legend.border_open")]),
      h("span", {}, [sw(colors.border.closed, "==="), " ", tr("ui.legend.border_closed")]),
      h("span", {}, [sw(colors.planned, "*"), " ", tr("ui.legend.planned")]),
      h("span", {}, [sw(colors.heat, "!"), " ", tr("ui.legend.patrols")]),
      toggle,
    ]);
  }

  function renderNewGame(form: { name: string; patchId: string; firstTime: boolean }): HTMLElement {
    const startButton = h(
      "button",
      { class: "primary", disabled: form.name.trim().length === 0, onclick: () => startNewGame(form.name.trim(), form.patchId) },
      [tr("ui.new.start")],
    );
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
    return h("div", { class: "modal new-game" }, [
      h("h2", {}, [tr(form.firstTime ? "ui.new.title_first" : "ui.new.title")]),
      h("label", { class: "field" }, [h("span", {}, [tr("ui.new.name")]), nameInput]),
      h("p", { class: "muted" }, [tr("ui.new.patch_hint"), " ", h("strong", {}, [parts(form.patchId)])]),
      h(
        "div",
        { class: "patch-grid" },
        content.patches.patches.map((p) =>
          h(
            "button",
            {
              class: p.id === form.patchId ? "patch-choice selected" : "patch-choice",
              title: parts(p.id),
              onclick: () => {
                form.patchId = p.id;
                render();
              },
            },
            [patchCanvas(content, p.id, 3)],
          ),
        ),
      ),
      h("div", { class: "row" }, [
        startButton,
        form.firstTime ? null : h("button", { onclick: () => { newGameForm = null; render(); } }, [tr("ui.new.cancel")]),
        form.firstTime ? null : h("span", { class: "muted" }, [tr("ui.new.warning")]),
      ]),
    ]);
  }

  function renderMemberSheet(memberId: string): HTMLElement | null {
    const entry = draft[memberId];
    const sheet = memberSheet(state, data, memberId, entry ? { taskId: entry.taskId, zoneId: entry.zoneId } : null);
    if (!sheet) return null;
    const { member } = sheet;
    const close = () => {
      sheetMemberId = null;
      render();
    };
    const status = tr(`status.${member.status}`);
    const bar = (value: number, max: number, low = false) =>
      h("div", { class: low ? "bar low" : "bar" }, [h("div", { class: "fill", style: `width: ${Math.round((100 * value) / max)}%` })]);
    const taskList = (ids: string[]) => (ids.length > 0 ? ids.map((id) => tr(`task.${id}`)).join(", ") : tr("ui.sheet.nothing"));
    const zoneName = (id: string | null) => (id ? (data.zones.find((z) => z.id === id)?.name ?? id) : tr("ui.pick_zone"));
    return h("div", { class: "modal member-sheet", role: "dialog", "aria-label": tr("ui.sheet.title") }, [
      h("div", { class: "sheet-head" }, [
        portraitCanvas(data, member, sheet.patchId, 6),
        h("div", {}, [
          h("h2", {}, [member.nickname || member.name]),
          h("div", {}, [member.name]),
          h("div", { class: "muted" }, [tr(`rank.${member.rank}`), " · ", tr(`trait.${member.trait}`)]),
          h("div", { class: member.status === "active" ? "muted" : "error" }, [
            member.statusWeeks > 0 ? tr("play.member_status_weeks", { status, weeks: member.statusWeeks }) : status,
          ]),
        ]),
      ]),
      h("table", { class: "sheet-stats" }, [
        h("tbody", {}, [
          ...sheet.stats.map((st) => h("tr", {}, [h("th", {}, [tr(`stat.${st.key}`)]), h("td", { class: "mono" }, [String(st.value)]), h("td", {}, [bar(st.value, st.max)])])),
          h("tr", {}, [
            h("th", {}, [tr("ui.sheet.loyalty")]),
            h("td", { class: "mono" }, [String(Math.round(sheet.loyalty.value))]),
            h("td", {}, [bar(sheet.loyalty.value, sheet.loyalty.max, sheet.loyalty.low)]),
          ]),
        ]),
      ]),
      sheet.loyalty.low ? h("p", { class: "error" }, [tr("ui.loyalty_danger")]) : null,
      h("p", {}, [h("strong", {}, [tr("ui.sheet.likes")]), " ", taskList(sheet.likes)]),
      h("p", {}, [h("strong", {}, [tr("ui.sheet.dislikes")]), " ", taskList(sheet.dislikes)]),
      h("p", {}, [
        h("strong", {}, [tr("ui.sheet.plan")]),
        " ",
        sheet.plan ? `${tr(`task.${sheet.plan.taskId}`)} · ${zoneName(sheet.plan.zoneId)}` : tr("ui.sheet.no_plan"),
      ]),
      h("button", { class: "primary", onclick: close }, [tr("ui.close")]),
    ]);
  }

  function renderOverlay(): HTMLElement | null {
    if (newGameForm) return renderNewGame(newGameForm);
    if (sheetMemberId) {
      const sheet = renderMemberSheet(sheetMemberId);
      if (sheet) return sheet;
      sheetMemberId = null;
    }
    if (showHelp) {
      return h("div", { class: "modal" }, [
        h("h2", {}, [tr("ui.help.title")]),
        ...["ui.help.goal", "ui.help.week", "ui.help.tasks", "ui.help.money", "ui.help.law", "ui.help.council", "ui.help.lose"].map((k) => h("p", {}, [tr(k)])),
        h("p", { class: "muted" }, [tr("ui.help.credits", { credit: data.ui.tileset.credit })]),
        h("button", { class: "primary", onclick: () => { showHelp = false; render(); } }, [tr("ui.close")]),
      ]);
    }
    if (state.outcome && !outcomeDismissed) {
      const m = topBarModel(state, data, state.playerFactionId);
      return h("div", { class: `modal ${state.outcome.result}` }, [
        h("h2", {}, [tr(state.outcome.result === "victory" ? "ui.end.victory" : "ui.end.defeat")]),
        h("p", {}, [tr(state.outcome.reasonKey)]),
        h("p", { class: "muted" }, [tr("ui.end.summary", { week: state.outcome.week, owned: m.owned, clean: m.clean, dirty: m.dirty })]),
        h("div", { class: "row" }, [
          h("button", { class: "primary", onclick: newGame }, [tr("ui.new_game")]),
          h("button", { onclick: () => { outcomeDismissed = true; render(); } }, [tr("ui.end.look")]),
        ]),
      ]);
    }
    return null;
  }

  function render(): void {
    data = withIdentities(content, state);
    els.topBar.replaceChildren(
      renderTopBar(),
      notice ? h("div", { class: notice.error ? "notice error" : "notice" }, [notice.text]) : "",
    );
    els.legend.replaceChildren(renderLegend());
    const overlay = renderOverlay();
    els.overlay.replaceChildren(...(overlay ? [overlay] : []));
    els.overlay.hidden = overlay === null;
    const tabs = h(
      "nav",
      { class: "tabs" },
      TABS.map((id) =>
        h("button", { class: id === tab ? "tab active" : "tab", onclick: () => { tab = id; render(); } }, [tr(`ui.tab.${id}`)]),
      ),
    );
    const body =
      tab === "club"
        ? renderClub()
        : tab === "council"
          ? renderCouncil()
          : tab === "business"
            ? renderBusiness()
            : tab === "zone"
              ? renderZone()
              : renderReport();
    els.sidebar.replaceChildren(tabs, h("div", { class: "tab-body" }, [body]));
    const planned = Object.values(draft).map((e) => e.zoneId).filter((z): z is string => z !== null);
    const local = localZoneId ? localViewModel(state, data, state.playerFactionId, localZoneId, selectedLot, planned) : null;
    const plannedTasks = Object.values(draft).flatMap((e) => (e.zoneId ? [{ taskId: e.taskId, zoneId: e.zoneId }] : []));
    map.update(mapViewModel(state, data, state.playerFactionId, selectedZoneId, planned, renderMode, local, { plannedTasks, lastReport: report }));
    els.mapBar.replaceChildren(
      localZoneId
        ? h("div", { class: "map-bar" }, [
            h("button", { onclick: () => { localZoneId = null; selectedLot = null; render(); } }, [tr("ui.map.back")]),
            h("strong", {}, [data.zones.find((z) => z.id === localZoneId)?.name ?? ""]),
            h("span", { class: "muted" }, [tr("ui.map.local_hint")]),
          ])
        : h("div", { class: "map-bar" }, [h("span", { class: "muted" }, [tr("ui.map.county_hint")])]),
    );
  }

  render();
}

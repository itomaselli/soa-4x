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
  let form: ProposalForm = { type: "promote", targetMemberId: "", targetFactionId: "", newRank: "", businessTypeId: "", zoneId: "", force: false };
  let management: ManagementOrder[] = [];
  let eventChoices: Record<string, string> = {};
  let buildForm = { typeId: "", zoneId: "" };
  let launderAmount = 0;
  let gunQuantity = 1;
  const sellAmounts: Record<string, number> = {};

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
    management = [];
    eventChoices = {};
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
      state.pendingEvents.length > 0
        ? h("button", { class: "warn-chip", onclick: () => { tab = "report"; render(); } }, [tr("ui.events_pending", { count: state.pendingEvents.length })])
        : null,
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
    const gunsOrder: ManagementOrder = { kind: "buy_guns", factionId: viewer, quantity: gunQuantity };
    const gunsProblem = problemOf(gunsOrder);

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
              g.price !== null && g.id !== data.balance.tasks.gunRun.goodId
                ? h("span", { class: "row" }, [
                    numberInput(qty, (n) => (sellAmounts[g.id] = n), g.stock),
                    h("button", { disabled: qty <= 0 || problemOf(order) !== null, onclick: () => addOrder(order) }, [tr("ui.biz.sell")]),
                  ])
                : g.id === data.balance.tasks.gunRun.goodId
                  ? h("span", { class: "muted" }, [tr("ui.biz.guns_by_run")])
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
            h("p", { class: "muted" }, [tr("ui.biz.deal_info", { price: cartel.price, space: cartel.space, weeks: cartel.weeksLeft ?? 0 })]),
            h("span", { class: "row" }, [
              numberInput(gunQuantity, (n) => (gunQuantity = Math.max(1, n)), Math.max(1, cartel.space)),
              h("button", { disabled: gunsProblem !== null, onclick: () => addOrder(gunsOrder) }, [tr("ui.biz.buy_guns")]),
            ]),
            gunsProblem ? h("div", { class: "error" }, [tr(gunsProblem)]) : null,
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
      case "buy_guns":
        return `${tr("management.buy_guns")}: ${o.quantity}`;
    }
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

  function render(): void {
    els.topBar.replaceChildren(renderTopBar());
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
    map.update(mapViewModel(state, data, state.playerFactionId, selectedZoneId));
  }

  render();
}

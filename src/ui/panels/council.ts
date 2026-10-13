// Mesa del club: proposals in the queue, the form with the selected proposal's detail, and each voter's chance of
// backing the president (before the vote: not votes already cast, not a guaranteed result). Proposals are voted at
// the start of the weekly resolution. Every proposal type, the "force" option and diplomacy stay as they were.

import { h } from "../dom";
import { illustration } from "../assets";
import { zoneName, type UiContext } from "../context";
import { portraitCanvas } from "../portraitCanvas";
import { promotionOptions, validateProposal, type Proposal } from "../../sim/council";
import { PROPOSAL_TYPES, type ProposalType, type Rank } from "../../sim/state";
import { businessDef } from "../../sim/systems/businesses";
import { EMPTY_FORM, type ProposalForm } from "../uiState";
import { buildableZones, cartelInfo, diplomacyRows, memberRows, votePreview } from "../viewModel";

export function proposalLabel(ctx: UiContext, p: Proposal): string {
  const { state, data, tr } = ctx;
  const member = p.targetMemberId ? state.members[p.targetMemberId] : undefined;
  const target = member
    ? member.nickname || member.name
    : p.businessTypeId && p.zoneId
      ? `${tr(`business.${p.businessTypeId}`)} (${zoneName(data, p.zoneId)}${p.lot !== undefined ? ` · ${tr("ui.lot.title", { index: p.lot + 1 })}` : ""})`
      : (data.factions.find((f) => f.id === p.targetFactionId)?.name ?? "");
  const rank = p.newRank ? ` → ${tr(`rank.${p.newRank}`)}` : "";
  return `${tr(`proposal.${p.type}`)}: ${target}${rank}${p.force ? tr("ui.council.forced") : ""}`;
}

function formToProposal(ctx: UiContext, form: ProposalForm): Proposal {
  const { state, data } = ctx;
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

function proposalCost(ctx: UiContext, p: Proposal): number {
  return p.type === "open_illegal_business" && p.businessTypeId ? (businessDef(ctx.data, p.businessTypeId)?.buildCost ?? 0) : 0;
}

export function renderCouncil(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const viewer = state.playerFactionId;
  const form = ui.form;
  const members = memberRows(state, viewer).filter((m) => m.rank !== "president");
  const clubs = diplomacyRows(state, data, viewer);
  const needsMember = form.type === "promote" || form.type === "expel";
  const rankOptions = form.type === "promote" && form.targetMemberId ? promotionOptions(state, form.targetMemberId) : [];
  const pending = formToProposal(ctx, form);
  const problem = validateProposal(state, data, pending, ui.proposals.length);
  const update = (patch: Partial<ProposalForm>) => set({ form: { ...form, ...patch } });
  const field = (label: string, control: HTMLElement) => h("label", { class: "field" }, [h("span", {}, [label]), control]);

  const typeSelect = h(
    "select",
    { onchange: (e: Event) => update({ type: (e.target as HTMLSelectElement).value as ProposalType, newRank: "" }) },
    PROPOSAL_TYPES.map((type) => h("option", { value: type, selected: type === form.type }, [tr(`proposal.${type}`)])),
  );
  const illegalTypes = data.businesses.filter((b) => !b.legal);
  const buildZones = buildableZones(state, data, viewer);
  const target =
    form.type === "cartel_deal"
      ? h("span", {}, [data.factions.find((f) => f.kind === "cartel")?.name ?? ""])
      : form.type === "open_illegal_business"
        ? h("span", { class: "stack" }, [
            h(
              "select",
              { "aria-label": tr("ui.council.business"), onchange: (e: Event) => update({ businessTypeId: (e.target as HTMLSelectElement).value }) },
              [h("option", { value: "" }, [tr("ui.biz.pick_type")]), ...illegalTypes.map((b) => h("option", { value: b.id, selected: b.id === form.businessTypeId }, [`${tr(`business.${b.id}`)} ($${b.buildCost})`]))],
            ),
            h(
              "select",
              { "aria-label": tr("ui.biz.pick_zone"), onchange: (e: Event) => update({ zoneId: (e.target as HTMLSelectElement).value }) },
              [h("option", { value: "" }, [buildZones.length === 0 ? tr("ui.biz.no_zone") : tr("ui.biz.pick_zone")]), ...buildZones.map((z) => h("option", { value: z, selected: z === form.zoneId }, [zoneName(data, z)]))],
            ),
          ])
        : needsMember
          ? h(
              "select",
              { onchange: (e: Event) => update({ targetMemberId: (e.target as HTMLSelectElement).value, newRank: "" }) },
              [h("option", { value: "" }, [tr("ui.council.pick_member")]), ...members.map((m) => h("option", { value: m.id, selected: m.id === form.targetMemberId }, [`${m.nickname || m.name} (${tr(`rank.${m.rank}`)})`]))],
            )
          : h(
              "select",
              { onchange: (e: Event) => update({ targetFactionId: (e.target as HTMLSelectElement).value }) },
              [h("option", { value: "" }, [tr("ui.council.pick_club")]), ...clubs.map((c) => h("option", { value: c.id, selected: c.id === form.targetFactionId }, [c.name]))],
            );
  const rankSelect =
    form.type === "promote"
      ? field(
          tr("ui.council.new_rank"),
          h(
            "select",
            { disabled: rankOptions.length === 0, onchange: (e: Event) => update({ newRank: (e.target as HTMLSelectElement).value }) },
            [h("option", { value: "" }, [rankOptions.length === 0 ? tr("ui.council.no_rank") : tr("ui.council.pick_rank")]), ...rankOptions.map((r) => h("option", { value: r, selected: r === form.newRank }, [tr(`rank.${r}`)]))],
          ),
        )
      : null;

  const cost = proposalCost(ctx, pending);
  const preview = votePreview(state, data, viewer, form.type, form.targetMemberId || undefined);
  const patchId = data.factions.find((f) => f.id === viewer)?.patchId ?? null;

  // ---- Queue ----
  const queue = h("section", { class: "council-col" }, [
    h("h3", {}, [tr("ui.council.queue", { count: ui.proposals.length, max: data.balance.council.maxProposalsPerWeek })]),
    ui.proposals.length === 0
      ? h("p", { class: "muted" }, [tr("ui.council.none")])
      : h(
          "ul",
          { class: "proposal-list" },
          ui.proposals.map((p, i) => {
            const issue = validateProposal(state, data, p, i);
            return h("li", { class: issue ? "proposal blocked" : "proposal" }, [
              p.type === "open_illegal_business" && p.businessTypeId ? illustration(p.businessTypeId, "small", tr(`business.${p.businessTypeId}`), "?") : null,
              h("div", {}, [
                h("strong", {}, [proposalLabel(ctx, p)]),
                proposalCost(ctx, p) > 0 ? h("div", { class: "muted" }, [tr("ui.council.cost_if_approved", { cost: proposalCost(ctx, p) })]) : null,
                issue ? h("div", { class: "error" }, [tr(issue)]) : null,
              ]),
              h("button", { class: "chip", "aria-label": tr("ui.council.remove_label", { proposal: proposalLabel(ctx, p) }), onclick: () => set({ proposals: ui.proposals.filter((_, j) => j !== i) }) }, [tr("ui.council.remove")]),
            ]);
          }),
        ),
    h("h3", {}, [tr("ui.council.diplomacy")]),
    h(
      "ul",
      { class: "plain" },
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
  ]);

  // ---- Form and detail ----
  const detail = h("section", { class: "council-col" }, [
    h("h3", {}, [tr("ui.council.new_proposal")]),
    h("div", { class: "form" }, [
      field(tr("ui.council.type"), typeSelect),
      field(needsMember ? tr("ui.council.member") : form.type === "open_illegal_business" ? tr("ui.council.business") : tr("ui.council.club"), target),
      rankSelect,
    ]),
    h("div", { class: "proposal-detail" }, [
      form.type === "open_illegal_business" && form.businessTypeId ? illustration(form.businessTypeId, "medium", tr(`business.${form.businessTypeId}`), "?") : null,
      h("div", {}, [
        h("strong", {}, [tr(`proposal.${form.type}`)]),
        h("p", { class: "muted" }, [tr(`ui.council.about.${form.type}`)]),
        cost > 0 ? h("p", {}, [tr("ui.council.cost_if_approved", { cost })]) : null,
        h("p", { class: "muted" }, [tr("ui.council.voted_at_resolution")]),
      ]),
    ]),
    h("label", { class: "check" }, [
      h("input", { type: "checkbox", checked: form.force, onchange: (e: Event) => update({ force: (e.target as HTMLInputElement).checked }) }),
      " ",
      tr("ui.council.force"),
    ]),
    problem ? h("div", { class: "error" }, [tr(problem)]) : null,
    h(
      "button",
      {
        class: "primary-outline",
        disabled: problem !== null,
        onclick: () => set({ proposals: [...ui.proposals, pending], form: { ...EMPTY_FORM, type: form.type } }),
      },
      [tr("ui.council.add")],
    ),
  ]);

  // ---- Chances ----
  const chances = h("section", { class: "council-col" }, [
    h("h3", {}, [tr("ui.council.preview")]),
    preview.length === 0
      ? h("p", { class: "muted" }, [tr("ui.council.no_voters")])
      : h(
          "ul",
          { class: "votes" },
          preview.map((v) => {
            const member = state.members[v.memberId];
            const value = v.fixed === "yes" ? 100 : v.fixed === "no" ? 0 : v.chance;
            const label = v.fixed === "yes" ? tr("ui.council.votes_yes") : v.fixed === "no" ? tr("ui.council.votes_no") : `${v.chance}%`;
            return h("li", {}, [
              member ? portraitCanvas(data, member, patchId, 2) : null,
              h("div", { class: "vote-body" }, [
                h("div", { class: "vote-name" }, [h("strong", {}, [v.name]), member ? h("span", { class: "muted" }, [` ${tr(`rank.${member.rank}`)} · ${tr(`status.${member.status}`)}`]) : null]),
                h("div", { class: "vote-bar" }, [
                  h("div", { class: "bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(value), "aria-label": tr("ui.council.chance_of", { member: v.name }) }, [
                    h("div", { class: "fill", style: `width:${value}%` }),
                  ]),
                  h("span", { class: "mono" }, [label]),
                ]),
              ]),
            ]);
          }),
        ),
    h("p", { class: "muted" }, [tr("ui.council.preview_note")]),
    h("p", { class: "muted" }, [tr("ui.council.chances_note")]),
  ]);

  return h("div", { class: "council-view" }, [h("p", { class: "hint" }, [tr("ui.council.hint")]), h("div", { class: "council-grid" }, [queue, detail, chances])]);
}

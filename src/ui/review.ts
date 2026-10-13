// "Revisar semana": a summary of everything the player queued before resolving the week. It only reads:
// it uses the same validators as the simulation (assignments, management, proposals) and never predicts random
// results. Errors (orders the engine will reject) are kept apart from warnings (members resting is allowed).

import type { GameData } from "../data/schemas";
import { validateProposal, type Proposal } from "../sim/council";
import { cartelPrice, validateManagement, type ManagementOrder } from "../sim/management";
import type { GameState, MemberStatus } from "../sim/state";
import { businessDef } from "../sim/systems/businesses";
import { livingMembers } from "../sim/systems/members";
import { draftProblems, type Draft } from "./draft";
import { taskBlocker, type Msg } from "./productionChains";
import { memberRows } from "./viewModel";

export interface ReviewAssignment {
  memberId: string;
  name: string;
  taskId: string;
  zoneId: string | null;
  /** strings key; null if the engine will accept it. */
  problem: string | null;
  /** Valid, but it would do nothing right now (nothing to sell, nowhere to work): a warning. */
  blocker: Msg | null;
}

export interface ReviewManagement {
  order: ManagementOrder;
  problem: string | null;
  /** Money this order takes, by currency, if it goes through (deterministic). */
  cost: { clean: number; dirty: number };
}

export interface ReviewProposal {
  proposal: Proposal;
  problem: string | null;
  /** Clean money paid only if the council approves it (or it's forced). */
  costIfApproved: number;
}

export interface ReviewEvent {
  instanceId: string;
  eventId: string;
  optionId: string;
  isDefault: boolean;
}

export interface WeekReview {
  assignments: ReviewAssignment[];
  /** Active members without a task: they rest. A warning, not an error. */
  idle: { memberId: string; name: string }[];
  /** Members who can't take orders this week (wounded, jailed), with weeks left. */
  unavailable: { memberId: string; name: string; status: MemberStatus; weeks: number }[];
  management: ReviewManagement[];
  proposals: ReviewProposal[];
  events: ReviewEvent[];
  money: { clean: number; dirty: number };
  /** Sum of the queued management costs. */
  committed: { clean: number; dirty: number };
  /** Paid later in the week (expenses stage): wages and upkeep, from the content. */
  expenses: { wages: number; upkeep: number };
  /** Queued management costs exceed the money we have: later orders will be rejected. */
  overCommitted: { clean: boolean; dirty: boolean };
  errors: number;
  warnings: number;
}

function managementCost(state: GameState, data: GameData, order: ManagementOrder): { clean: number; dirty: number } {
  switch (order.kind) {
    case "build":
      return { clean: businessDef(data, order.typeId)?.buildCost ?? 0, dirty: 0 };
    case "buy":
      return { clean: 0, dirty: order.quantity * cartelPrice(state, data, order.factionId, order.goodId) };
    default:
      return { clean: 0, dirty: 0 };
  }
}

export function weekReview(
  state: GameState,
  data: GameData,
  viewer: string,
  queued: { draft: Draft; management: readonly ManagementOrder[]; proposals: readonly Proposal[]; eventChoices: Readonly<Record<string, string>> },
): WeekReview {
  const members = memberRows(state, viewer);
  // Same check the Club view uses (and that decides which orders reach the engine).
  const problems = draftProblems(queued.draft, state, data);
  const assignments: ReviewAssignment[] = members
    .filter((m) => m.id in queued.draft)
    .map((m) => {
      const entry = queued.draft[m.id]!;
      const problem = problems[m.id] ?? null;
      return { memberId: m.id, name: m.nickname || m.name, taskId: entry.taskId, zoneId: entry.zoneId, problem, blocker: problem ? null : taskBlocker(state, data, viewer, entry.taskId) };
    });
  const idle = members.filter((m) => m.status === "active" && !(m.id in queued.draft)).map((m) => ({ memberId: m.id, name: m.nickname || m.name }));
  const unavailable = members
    .filter((m) => m.status === "wounded" || m.status === "jailed")
    .map((m) => ({ memberId: m.id, name: m.nickname || m.name, status: m.status, weeks: m.statusWeeks }));

  const management = queued.management.map((order) => ({ order, problem: validateManagement(state, data, order), cost: managementCost(state, data, order) }));
  const committed = management.reduce((sum, m) => ({ clean: sum.clean + m.cost.clean, dirty: sum.dirty + m.cost.dirty }), { clean: 0, dirty: 0 });
  const proposals = queued.proposals.map((proposal, i) => ({
    proposal,
    problem: validateProposal(state, data, proposal, i),
    costIfApproved: proposal.type === "open_illegal_business" && proposal.businessTypeId ? (businessDef(data, proposal.businessTypeId)?.buildCost ?? 0) : 0,
  }));
  const events = state.pendingEvents
    .filter((e) => e.factionId === viewer)
    .map((e) => {
      const def = data.events.find((d) => d.id === e.eventId);
      const chosen = queued.eventChoices[e.instanceId];
      return { instanceId: e.instanceId, eventId: e.eventId, optionId: chosen ?? def?.defaultOption ?? "", isDefault: chosen === undefined };
    });

  const money = state.factions[viewer]?.money ?? { clean: 0, dirty: 0 };
  const wages = livingMembers(state, viewer).reduce((sum, m) => sum + (data.balance.wages[m.rank] ?? 0), 0);
  const upkeep = state.businesses.filter((b) => b.ownerFactionId === viewer).reduce((sum, b) => sum + (businessDef(data, b.typeId)?.maintenance ?? 0), 0);
  const errors = assignments.filter((a) => a.problem).length + management.filter((m) => m.problem).length + proposals.filter((p) => p.problem).length;
  const overCommitted = { clean: committed.clean > money.clean, dirty: committed.dirty > money.dirty };
  return {
    assignments,
    idle,
    unavailable,
    management,
    proposals,
    events,
    money,
    committed,
    expenses: { wages, upkeep },
    overCommitted,
    errors,
    warnings: idle.length + assignments.filter((a) => a.blocker).length + (overCommitted.clean ? 1 : 0) + (overCommitted.dirty ? 1 : 0),
  };
}

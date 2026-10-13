// resolveTurn: the single entry point that advances the game one week.
// Stages run in the fixed order of GDD §4. Stages not implemented yet are explicit no-ops.

import type { GameData } from "../data/schemas";
import { newScratch, type TurnContext } from "./context";
import type { Proposal } from "./council";
import { validateAssignment, type Assignment, type TurnOrders } from "./orders";
import { TURN_STAGES, type ReportEntry, type Reporter, type TurnStage } from "./report";
import { createRng } from "./rng";
import type { GameState } from "./state";
import type { ManagementOrder } from "./management";
import { resolveCartel } from "./systems/cartel";
import { resolveCombat } from "./systems/combat";
import { ownedZones } from "./systems/control";
import { resolveLaundering, resolveManagement, resolveProduction, resolveSales, resolveTransport } from "./systems/economy";
import { resolveEventChoices, triggerEvents } from "./systems/events";
import { resolveCouncil } from "./systems/council";
import { resolveEndOfTurn } from "./systems/endOfTurn";
import { payExpenses } from "./systems/expenses";
import { resolveHeat } from "./systems/heat";
import { resolveLoyalty } from "./systems/loyalty";
import { memberLabel } from "./systems/members";
import { resolveFactionTasks } from "./systems/tasks";

export interface TurnResult {
  state: GameState;
  report: ReportEntry[];
}

interface StageOrders {
  assignments: Assignment[];
  proposals: Proposal[];
  management: ManagementOrder[];
  eventChoices: { instanceId: string; optionId: string }[];
}

type StageHandler = (state: GameState, ctx: TurnContext, orders: StageOrders) => void;

const STAGE_HANDLERS: Record<Exclude<TurnStage, "orders">, StageHandler> = {
  event_choices: (state, ctx, orders) => resolveEventChoices(state, orders.eventChoices, ctx),
  council: (state, ctx, orders) => resolveCouncil(state, orders.proposals, ctx),
  management: (state, ctx, orders) => resolveManagement(state, orders.management, ctx),
  production: (state, ctx) => resolveProduction(state, ctx),
  transport: (state, ctx) => resolveTransport(state, ctx),
  sales: (state, ctx, orders) => resolveSales(state, orders.management, ctx),
  faction_tasks: (state, ctx, orders) => resolveFactionTasks(state, orders.assignments, ctx),
  combat: (state, ctx) => resolveCombat(state, ctx),
  laundering: (state, ctx, orders) => resolveLaundering(state, orders.management, ctx),
  expenses: (state, ctx) => payExpenses(state, ctx),
  heat_and_law: (state, ctx) => resolveHeat(state, ctx),
  loyalty: (state, ctx) => resolveLoyalty(state, ctx),
  events: (state, ctx) => {
    resolveCartel(state, ctx);
    triggerEvents(state, ctx);
  },
  end_of_turn: (state, ctx) => resolveEndOfTurn(state, ctx),
};

/** Pure: never mutates `state`. Same state + same orders + same data → same result. */
export function resolveTurn(state: GameState, orders: TurnOrders, data: GameData): TurnResult {
  const report: ReportEntry[] = [];
  if (state.outcome) {
    report.push({ stage: "orders", key: "report.game_over", params: {}, factionId: null });
    return { state, report };
  }

  const next = structuredClone(state);
  const rng = createRng(next.rngState);
  let stage: TurnStage = "orders";
  const reporter: Reporter = (key, params = {}, factionId = null) => report.push({ stage, key, params, factionId });
  const ctx: TurnContext = {
    data,
    rng,
    report: reporter,
    scratch: newScratch(),
  };

  // Orders: invalid assignments are dropped and explained.
  const valid: Assignment[] = [];
  const assigned = new Set<string>();
  for (const assignment of orders.assignments) {
    const error = validateAssignment(next, data, assignment, assigned);
    const member = next.members[assignment.memberId];
    if (error) {
      reporter(
        "report.order_rejected",
        { member: member ? memberLabel(member) : assignment.memberId, reasonKey: error },
        member?.factionId ?? null,
      );
      continue;
    }
    valid.push(assignment);
    assigned.add(assignment.memberId);
  }

  for (const def of data.factions) ctx.scratch.ownedBefore[def.id] = ownedZones(next, def.id, data.balance);

  for (const s of TURN_STAGES) {
    if (s === "orders") continue;
    stage = s;
    // Assignments are re-checked after the council: an expelled member's task is dropped.
    const assignments = s === "faction_tasks" ? valid.filter((a) => next.members[a.memberId]?.status === "active") : valid;
    STAGE_HANDLERS[s](next, ctx, {
      assignments,
      proposals: orders.proposals ?? [],
      management: orders.management ?? [],
      eventChoices: orders.eventChoices ?? [],
    });
  }

  next.rngState = rng.getState();
  return { state: next, report };
}

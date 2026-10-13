// resolveTurn: the single entry point that advances the game one week.
// Stages run in the fixed order of GDD §4. Stages not implemented yet are explicit no-ops.

import type { GameData } from "../data/schemas";
import type { TurnContext } from "./context";
import { validateAssignment, type Assignment, type TurnOrders } from "./orders";
import { TURN_STAGES, type ReportEntry, type Reporter, type TurnStage } from "./report";
import { createRng } from "./rng";
import type { GameState } from "./state";
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

type StageHandler = (state: GameState, ctx: TurnContext, assignments: Assignment[]) => void;

const notYetImplemented: StageHandler = () => {};

const STAGE_HANDLERS: Record<Exclude<TurnStage, "orders">, StageHandler> = {
  production: notYetImplemented, // phase 5
  transport: notYetImplemented, // phase 5: moving stock between businesses
  sales: notYetImplemented, // phase 5
  faction_tasks: (state, ctx, assignments) => resolveFactionTasks(state, assignments, ctx),
  combat: notYetImplemented, // phase 2
  laundering: notYetImplemented, // phase 5
  expenses: (state, ctx) => payExpenses(state, ctx),
  heat_and_law: (state, ctx) => resolveHeat(state, ctx),
  loyalty: (state, ctx) => resolveLoyalty(state, ctx),
  events: notYetImplemented, // phase 5
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
    scratch: { unpaidMemberIds: [], protectionCollected: new Set() },
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

  for (const s of TURN_STAGES) {
    if (s === "orders") continue;
    stage = s;
    STAGE_HANDLERS[s](next, ctx, valid);
  }

  next.rngState = rng.getState();
  return { state: next, report };
}

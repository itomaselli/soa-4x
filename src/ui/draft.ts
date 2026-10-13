// The player's orders while they're being edited: one optional (task, zone) per member.
// Pure functions; the DOM code only calls these.

import type { GameData } from "../data/schemas";
import { validateAssignment, type TurnOrders } from "../sim/orders";
import type { GameState } from "../sim/state";

export interface DraftEntry {
  taskId: string;
  zoneId: string | null;
}

/** memberId → planned task. Members without an entry rest this week. */
export type Draft = Record<string, DraftEntry>;

export function draftToOrders(draft: Draft): TurnOrders {
  return {
    assignments: Object.entries(draft)
      .filter((entry): entry is [string, DraftEntry & { zoneId: string }] => entry[1].zoneId !== null)
      .map(([memberId, { taskId, zoneId }]) => ({ memberId, taskId, zoneId })),
  };
}

/** strings.es.json key of the problem with each entry, if any. Entries without a zone yet are flagged too. */
export function draftProblems(draft: Draft, state: GameState, data: GameData): Record<string, string> {
  const problems: Record<string, string> = {};
  const assigned = new Set<string>();
  for (const [memberId, entry] of Object.entries(draft)) {
    if (entry.zoneId === null) {
      problems[memberId] = "ui.error.pick_zone";
      continue;
    }
    const error = validateAssignment(state, data, { memberId, ...entry, zoneId: entry.zoneId }, assigned);
    if (error) problems[memberId] = error;
    else assigned.add(memberId);
  }
  return problems;
}

/** After a week: keeps last week's orders that are still valid, so the player only changes what they want. */
export function carryOverDraft(draft: Draft, state: GameState, data: GameData): Draft {
  const problems = draftProblems(draft, state, data);
  return Object.fromEntries(Object.entries(draft).filter(([memberId]) => !(memberId in problems)));
}

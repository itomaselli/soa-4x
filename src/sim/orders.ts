// Orders: what each member does this week (GDD §4, step 3).
// Player, AI and UI all build the same TurnOrders and run the same validation.

import { z } from "zod";
import type { GameData } from "../data/schemas";
import { factionZonePresence } from "./systems/control";
import { ProposalSchema } from "./council";
import { IdSchema, type GameState } from "./state";

export const AssignmentSchema = z.object({
  memberId: IdSchema,
  taskId: IdSchema,
  zoneId: IdSchema,
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const TurnOrdersSchema = z.object({
  assignments: z.array(AssignmentSchema),
  /** Proposals for the council (GDD §6). Voted at the start of the week, before tasks. */
  proposals: z.array(ProposalSchema).optional(),
});
export type TurnOrders = z.infer<typeof TurnOrdersSchema>;

export const EMPTY_ORDERS: TurnOrders = { assignments: [] };

/**
 * Zones a faction can act in: where it has control > 0, plus their neighbours (GDD §5 adjacency graph).
 * Returned in data order, so the result is deterministic.
 */
export function reachableZones(state: GameState, data: GameData, factionId: string): string[] {
  const present = new Set(factionZonePresence(state, factionId));
  const reachable = new Set(present);
  for (const zone of data.zones) {
    if (present.has(zone.id)) for (const adj of zone.adjacent) reachable.add(adj);
  }
  return data.zones.map((z) => z.id).filter((id) => reachable.has(id));
}

/** Tasks that can be ordered right now (enabled in tasks.json). */
export function availableTasks(data: GameData): string[] {
  return data.tasks.filter((t) => t.enabled).map((t) => t.id);
}

/**
 * Checks a single assignment. Returns a strings.es.json key describing the problem, or null if valid.
 * `alreadyAssigned` holds member ids that already have a task this week.
 */
export function validateAssignment(
  state: GameState,
  data: GameData,
  assignment: Assignment,
  alreadyAssigned: ReadonlySet<string> = new Set(),
): string | null {
  const member = state.members[assignment.memberId];
  if (!member) return "order_error.unknown_member";
  if (member.status !== "active") return "order_error.member_not_active";
  if (alreadyAssigned.has(member.id)) return "order_error.member_already_assigned";
  const task = data.tasks.find((t) => t.id === assignment.taskId);
  if (!task) return "order_error.unknown_task";
  if (!task.enabled) return "order_error.task_not_available";
  if (!(assignment.zoneId in state.zones)) return "order_error.unknown_zone";
  if (!reachableZones(state, data, member.factionId).includes(assignment.zoneId)) return "order_error.zone_not_reachable";
  return null;
}

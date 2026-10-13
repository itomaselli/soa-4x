// Random policy: every active member gets a random valid task in a random reachable zone.
// Not an AI: used by property tests and as a baseline in the headless simulator until phase 2.
// It uses its own Rng, so it never consumes the game's random sequence.

import type { GameData } from "../../data/schemas";
import { availableTasks, reachableZones, type TurnOrders } from "../orders";
import type { Rng } from "../rng";
import type { GameState } from "../state";
import { activeMembers } from "../systems/members";

export function randomOrders(state: GameState, data: GameData, factionId: string, rng: Rng): TurnOrders {
  const tasks = availableTasks(data);
  const zones = reachableZones(state, data, factionId);
  if (tasks.length === 0 || zones.length === 0) return { assignments: [] };
  const members = activeMembers(state, factionId).sort((a, b) => a.id.localeCompare(b.id));
  return {
    assignments: members.map((m) => ({ memberId: m.id, taskId: rng.pick(tasks), zoneId: rng.pick(zones) })),
  };
}

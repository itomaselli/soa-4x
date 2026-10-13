// Diplomatic stances between factions (GDD §12): war and truce are explicit; tension and neutral
// come from the relation value.

import type { Balance } from "../../data/schemas";
import type { GameState, Stance } from "../state";

export type DiplomaticState = "war" | "tension" | "neutral" | "truce";

export function stanceKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function getStance(state: GameState, a: string, b: string): Stance | null {
  return state.stances[stanceKey(a, b)] ?? null;
}

export function atWar(state: GameState, a: string, b: string): boolean {
  return getStance(state, a, b)?.type === "war";
}

export function inTruce(state: GameState, a: string, b: string): boolean {
  return getStance(state, a, b)?.type === "truce";
}

/** How `from` stands with `to`: explicit stance first, then the relation `to` has towards `from`... symmetric in practice. */
export function diplomaticState(state: GameState, a: string, b: string, balance: Balance): DiplomaticState {
  const stance = getStance(state, a, b);
  if (stance) return stance.type;
  const worst = Math.min(state.factions[a]?.relations[b] ?? 0, state.factions[b]?.relations[a] ?? 0);
  return worst <= balance.relations.tensionAt ? "tension" : "neutral";
}

/** Factions at war with `factionId`. */
export function warEnemies(state: GameState, factionId: string): string[] {
  return Object.entries(state.stances)
    .filter(([, stance]) => stance.type === "war")
    .map(([key]) => key.split("|"))
    .filter((pair) => pair.includes(factionId))
    .map((pair) => (pair[0] === factionId ? pair[1] : pair[0]))
    .filter((id): id is string => id !== undefined)
    .sort();
}

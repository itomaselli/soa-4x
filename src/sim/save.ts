// Save/load = JSON.stringify / JSON.parse + schema validation (CLAUDE.md, golden rule 3).

import { GameStateSchema, type GameState } from "./state";

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

/** Parses and validates a saved game. Throws with readable messages if invalid. */
export function deserializeState(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Partida guardada ilegible: ${(error as Error).message}`, { cause: error });
  }
  const parsed = GameStateSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`);
    throw new Error(`Partida guardada inválida:\n- ${problems.join("\n- ")}`);
  }
  return parsed.data;
}

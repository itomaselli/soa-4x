// Save/load = JSON.stringify / JSON.parse + schema validation (CLAUDE.md, golden rule 3).
// A save is also checked against the current content: if /data changed (a zone or business type was
// removed, for example), the save is rejected with a readable list of problems instead of breaking later.

import type { GameData } from "../data/schemas";
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

/** Ids in the save that don't exist in the current /data. Empty list = compatible. */
export function saveDataProblems(state: GameState, data: GameData): string[] {
  const problems: string[] = [];
  const zones = new Set(data.zones.map((z) => z.id));
  const factions = new Set(data.factions.map((f) => f.id));
  const businesses = new Set(data.businesses.map((b) => b.id));
  const goods = new Set(data.goods.map((g) => g.id));
  const events = new Set(data.events.map((e) => e.id));

  if (!factions.has(state.playerFactionId)) problems.push(`facción del jugador desconocida: ${state.playerFactionId}`);
  for (const id of Object.keys(state.zones)) if (!zones.has(id)) problems.push(`zona desconocida: ${id}`);
  for (const id of zones) if (!(id in state.zones)) problems.push(`falta la zona ${id} en la partida`);
  for (const id of Object.keys(state.factions)) if (!factions.has(id)) problems.push(`facción desconocida: ${id}`);
  for (const m of Object.values(state.members)) if (!factions.has(m.factionId)) problems.push(`${m.id}: facción desconocida ${m.factionId}`);
  for (const b of state.businesses) {
    if (!businesses.has(b.typeId)) problems.push(`${b.id}: tipo de negocio desconocido ${b.typeId}`);
    if (!zones.has(b.zoneId)) problems.push(`${b.id}: zona desconocida ${b.zoneId}`);
  }
  for (const f of Object.values(state.factions)) {
    for (const good of Object.keys(f.stock)) if (!goods.has(good)) problems.push(`${f.id}: bien desconocido ${good}`);
  }
  for (const e of state.pendingEvents) if (!events.has(e.eventId)) problems.push(`evento desconocido: ${e.eventId}`);
  return problems;
}

/** Full load for the UI and the CLI: parse, validate shape, then check against the current content. */
export function loadSave(json: string, data: GameData): GameState {
  const state = deserializeState(json);
  const problems = saveDataProblems(state, data);
  if (problems.length > 0) {
    throw new Error(`La partida no coincide con los datos actuales del juego:\n- ${problems.join("\n- ")}`);
  }
  return state;
}

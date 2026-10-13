// Save/load = JSON.stringify / JSON.parse + schema validation (CLAUDE.md, golden rule 3).
// Old saves are migrated step by step (v1 → v2 → … → SAVE_SCHEMA_VERSION) before validation, so a save from
// an earlier version of the game keeps loading instead of being rejected.
// A save is also checked against the current content: if /data changed (a zone or business type was
// removed, for example), the save is rejected with a readable list of problems instead of breaking later.

import type { GameData } from "../data/schemas";
import { GameStateSchema, SAVE_SCHEMA_VERSION, type GameState } from "./state";

/** A save as parsed JSON, before validation. Migrations only touch plain objects. */
export type RawSave = Record<string, unknown>;

/** Converts a save from version N to N+1. Receives the current content for defaults (names, patches). */
export type SaveMigration = (save: RawSave, data: GameData) => RawSave;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * v1 → v2. Version 1 covers two formats: v0.1.0 saves and v0.2.0 saves (same number, more fields).
 * Fills what v0.1.0 didn't have, leaving v0.2.0 saves untouched:
 * - businesses get the lowest free lot of their zone (phase 10),
 * - each club gets its default name and patch (phase 11),
 * - event cooldowns keyed by event only become per club; back then events only happened to the player (phase 8).
 */
export function migrateV1toV2(save: RawSave, data: GameData): RawSave {
  const next: RawSave = { ...save };

  if (Array.isArray(save.businesses)) {
    const used = new Map<string, Set<number>>();
    for (const b of save.businesses) {
      if (isRecord(b) && typeof b.zoneId === "string" && typeof b.lot === "number") {
        used.set(b.zoneId, (used.get(b.zoneId) ?? new Set()).add(b.lot));
      }
    }
    next.businesses = save.businesses.map((b) => {
      if (!isRecord(b) || typeof b.lot === "number" || typeof b.zoneId !== "string") return b;
      const taken = used.get(b.zoneId) ?? new Set<number>();
      let lot = 0;
      while (taken.has(lot)) lot++;
      used.set(b.zoneId, taken.add(lot));
      return { ...b, lot };
    });
  }

  if (!isRecord(save.identities)) {
    next.identities = Object.fromEntries(data.factions.map((f) => [f.id, { name: f.name, patchId: f.patchId }]));
  }

  if (isRecord(save.eventHistory) && typeof save.playerFactionId === "string") {
    const player = save.playerFactionId;
    next.eventHistory = Object.fromEntries(
      Object.entries(save.eventHistory).map(([key, week]) => [key.includes("__") ? key : `${key}__${player}`, week]),
    );
  }

  return next;
}

/** Keyed by the version they upgrade from. */
export const SAVE_MIGRATIONS: Readonly<Record<number, SaveMigration>> = {
  1: migrateV1toV2,
};

/**
 * Brings a parsed save up to `target`, one version at a time. Throws with a readable message when the save
 * has no version, comes from a newer game, or a step is missing.
 */
export function migrateSave(
  raw: unknown,
  data: GameData,
  migrations: Readonly<Record<number, SaveMigration>> = SAVE_MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
): RawSave {
  if (!isRecord(raw)) throw new Error("Partida guardada inválida: no es un objeto");
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Partida guardada inválida: schemaVersion falta o no es un número de versión");
  }
  if (version > target) {
    throw new Error(`La partida es de una versión más nueva del juego (formato ${version}; este juego lee hasta el ${target})`);
  }
  let save = raw;
  for (let v = version; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No se puede actualizar la partida: falta la migración del formato ${v} al ${v + 1}`);
    save = { ...step(save, data), schemaVersion: v + 1 };
  }
  return save;
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Parses, migrates and validates a saved game. Throws with readable messages if invalid.
 * Without `data`, only saves already in the current format are accepted (migrations need the content).
 */
export function deserializeState(json: string, data?: GameData): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Partida guardada ilegible: ${(error as Error).message}`, { cause: error });
  }
  const migrated = data ? migrateSave(raw, data) : raw;
  const parsed = GameStateSchema.safeParse(migrated);
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
    const slots = data.zones.find((z) => z.id === b.zoneId)?.businessSlots ?? 0;
    if (b.lot >= slots) problems.push(`${b.id}: el lote ${b.lot} no existe en ${b.zoneId}`);
  }
  for (const f of Object.values(state.factions)) {
    for (const good of Object.keys(f.stock)) if (!goods.has(good)) problems.push(`${f.id}: bien desconocido ${good}`);
  }
  for (const e of state.pendingEvents) if (!events.has(e.eventId)) problems.push(`evento desconocido: ${e.eventId}`);
  const patches = new Set(data.patches.patches.map((p) => p.id));
  for (const [id, identity] of Object.entries(state.identities)) {
    if (identity.patchId !== null && !patches.has(identity.patchId)) problems.push(`${id}: parche desconocido ${identity.patchId}`);
  }
  return problems;
}

/** Full load for the UI and the CLI: parse, migrate old formats, validate shape, then check against the current content. */
export function loadSave(json: string, data: GameData): GameState {
  const state = deserializeState(json, data);
  const problems = saveDataProblems(state, data);
  if (problems.length > 0) {
    throw new Error(`La partida no coincide con los datos actuales del juego:\n- ${problems.join("\n- ")}`);
  }
  return state;
}

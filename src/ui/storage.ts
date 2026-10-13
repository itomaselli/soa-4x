// Autosave in the browser (GDD §4: "guardado automático"). Storage can be missing or blocked,
// so every access is wrapped: the game must work without it.

import type { GameData } from "../data/schemas";
import type { GameState } from "../sim/state";
import { loadSave, serializeState } from "../sim/save";

const AUTOSAVE_KEY = "biker4x.autosave";

export function saveAutosave(state: GameState): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeState(state));
  } catch {
    // Storage unavailable: the game keeps running without autosave.
  }
}

export function loadAutosave(data: GameData): GameState | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? loadSave(json, data) : null;
  } catch {
    return null;
  }
}

/** Offers the current game as a .json file to keep (the browser asks where to save it). */
export function exportSave(state: GameState, fileName: string): void {
  const blob = new Blob([serializeState(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads a save file chosen by the player. Rejects with a readable message if it's not a valid game. */
export async function importSave(file: File, data: GameData): Promise<GameState> {
  return loadSave(await file.text(), data);
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

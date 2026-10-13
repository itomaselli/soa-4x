// Autosave in the browser (GDD §4: "guardado automático"). Storage can be missing or blocked,
// so every access is wrapped: the game must work without it.

import type { GameState } from "../sim/state";
import { deserializeState, serializeState } from "../sim/save";

const AUTOSAVE_KEY = "biker4x.autosave";

export function saveAutosave(state: GameState): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeState(state));
  } catch {
    // Storage unavailable: the game keeps running without autosave.
  }
}

export function loadAutosave(): GameState | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserializeState(json) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

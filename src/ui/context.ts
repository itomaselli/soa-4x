// What every panel receives: the game (read only), the interface state and the actions it may trigger.
// Panels never change GameState: they update the UI state (drafts, selections) or call an action that goes
// through the simulation (resolve the week, load a save, start a game).

import type { GameData } from "../data/schemas";
import type { GameState, MapSize } from "../sim/state";
import type { Msg } from "./productionChains";
import { t } from "./strings";
import type { NewGameForm, UiState, View } from "./uiState";

export interface UiActions {
  navigate(view: View): void;
  selectZone(zoneId: string): void;
  enterZone(zoneId: string): void;
  leaveDistrict(): void;
  /** Pick a member's destination by clicking the map (opens the county). */
  pickOnMap(memberId: string): void;
  openReview(): void;
  resolveWeek(): void;
  saveToFile(): void;
  loadFromFile(file: File): void;
  openNewGame(): void;
  startNewGame(name: string, patchId: string, size: MapSize): void;
  toggleRenderMode(): void;
}

export interface UiContext {
  state: GameState;
  /** Content with this game's club names and patches applied. */
  data: GameData;
  /** Content as shipped (new game screen). */
  content: GameData;
  ui: UiState;
  tr: (key: string, params?: Record<string, string | number>) => string;
  /** Changes the UI state and redraws. */
  set: (patch: Partial<UiState>) => void;
  actions: UiActions;
}

export type { NewGameForm };

/** Translates a Msg: params ending in "Key" are strings keys, in "Keys" several keys joined by "|". */
export function msg(data: GameData, m: Msg): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(m.params ?? {})) {
    if (typeof value === "string" && name.endsWith("Keys")) params[name] = value.split("|").filter(Boolean).map((k) => t(data.strings, k)).join(", ");
    else if (typeof value === "string" && name.endsWith("Key")) params[name] = value ? t(data.strings, value) : "";
    else params[name] = value;
  }
  return t(data.strings, m.key, params);
}

export function zoneName(data: GameData, zoneId: string | null): string {
  return zoneId ? (data.zones.find((z) => z.id === zoneId)?.name ?? zoneId) : "";
}

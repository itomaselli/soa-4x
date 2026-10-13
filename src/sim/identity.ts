// Club identities (phase 11): the names and patches live in GameState, but most code reads faction names
// from the content. withIdentities returns a copy of the content with each faction's current name, so
// reports and the interface show the name the player chose without threading the state everywhere.

import type { GameData } from "../data/schemas";
import type { GameState } from "./state";

export function withIdentities(data: GameData, state: GameState): GameData {
  if (Object.keys(state.identities).length === 0) return data;
  return {
    ...data,
    factions: data.factions.map((f) => {
      const id = state.identities[f.id];
      return id ? { ...f, name: id.name, patchId: id.patchId } : f;
    }),
  };
}

export const CLUB_NAME_MAX_LENGTH = 40;

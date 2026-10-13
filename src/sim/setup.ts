// Builds the week-1 GameState from validated content. No game rules here:
// it only copies starting values from /data into the state shape.

import type { GameData } from "../data/schemas";
import { seedToState } from "./rng";
import { SAVE_SCHEMA_VERSION, type FactionState, type GameState, type MemberState, type ZoneState } from "./state";

export interface NewGameOptions {
  seed: number;
  playerFactionId: string;
}

export function createInitialState(data: GameData, options: NewGameOptions): GameState {
  if (!data.factions.some((f) => f.id === options.playerFactionId)) {
    throw new Error(`Unknown player faction: ${options.playerFactionId}`);
  }

  const factions: Record<string, FactionState> = {};
  for (const def of data.factions) {
    factions[def.id] = {
      id: def.id,
      money: { ...def.startingMoney },
      relations: { ...def.initialRelations },
      stock: {},
    };
  }

  const zones: Record<string, ZoneState> = {};
  for (const def of data.zones) {
    zones[def.id] = {
      id: def.id,
      control: { ...def.initialControl },
      heat: def.initialHeat,
      policePresence: def.policePresence,
    };
  }

  const members: Record<string, MemberState> = {};
  for (const def of data.members) {
    members[def.id] = {
      id: def.id,
      factionId: def.factionId,
      name: def.name,
      nickname: def.nickname,
      rank: def.rank,
      trait: def.trait,
      stats: { ...def.stats },
      loyalty: def.loyalty,
      status: "active",
      statusWeeks: 0,
    };
  }

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    week: 1,
    rngState: seedToState(options.seed),
    playerFactionId: options.playerFactionId,
    factions,
    zones,
    members,
    businesses: [],
    federalInvestigation: data.balance.ranges.federalInvestigation.min,
  };
}

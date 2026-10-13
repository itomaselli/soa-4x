// Builds the week-1 GameState from validated content. No game rules here:
// it only copies starting values from /data into the state shape.

import type { GameData } from "../data/schemas";
import { seedToState } from "./rng";
import { SAVE_SCHEMA_VERSION, type FactionState, type GameState, type MemberState, type ZoneState } from "./state";

export interface NewGameOptions {
  seed: number;
  playerFactionId: string;
  /** Phase 11: the player's club name and patch (defaults from factions.json). */
  clubName?: string;
  patchId?: string;
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
      federal: data.balance.ranges.federalInvestigation.min,
      lowLoyaltyWeeks: 0,
      ownedHistory: [],
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
      informant: false,
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
    stances: {},
    market: {},
    shipments: [],
    pendingEvents: [],
    eventHistory: {},
    businessSerial: 0,
    identities: Object.fromEntries(
      data.factions.map((f) => [
        f.id,
        f.id === options.playerFactionId
          ? { name: options.clubName?.trim() || f.name, patchId: options.patchId ?? f.patchId }
          : { name: f.name, patchId: f.patchId },
      ]),
    ),
    controlStreaks: {},
    outcome: null,
  };
}

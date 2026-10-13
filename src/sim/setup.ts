// Builds the week-1 GameState from validated content. No game rules here:
// it only copies starting values from /data into the state shape.

import type { GameData, MemberDef } from "../data/schemas";
import { generateScenario } from "./mapgen";
import { seedToState } from "./rng";
import { NO_PERKS } from "./systems/perks";
import { classicScenario, gameData } from "./scenario";
import { SAVE_SCHEMA_VERSION, type FactionState, type GameState, type MapSize, type MemberState, type ZoneState } from "./state";

export interface NewGameOptions {
  seed: number;
  playerFactionId: string;
  /** Phase 11: the player's club name and patch (defaults from factions.json). */
  clubName?: string;
  patchId?: string;
  /** A random county of this size (phase 12). Without it, the classic county from /data. */
  size?: MapSize;
}

export function createInitialState(content: GameData, options: NewGameOptions): GameState {
  if (!content.factions.some((f) => f.id === options.playerFactionId)) {
    throw new Error(`Unknown player faction: ${options.playerFactionId}`);
  }

  const generated = options.size
    ? generateScenario(content, { size: options.size, seed: options.seed, playerFactionId: options.playerFactionId, playerPatchId: options.patchId ?? null })
    : null;
  const scenario = generated?.scenario ?? classicScenario(content);
  const memberDefs: MemberDef[] = generated?.members ?? content.members;
  const data = gameData(content, { scenario, identities: {} });

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
  for (const def of memberDefs) {
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
      ...structuredClone(NO_PERKS),
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
    scenario,
    outcome: null,
  };
}

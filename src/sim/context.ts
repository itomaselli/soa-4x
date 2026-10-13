import type { GameData } from "../data/schemas";
import type { Reporter } from "./report";
import type { Rng } from "./rng";

/** Per-turn scratch data shared between stages. Never stored in GameState. */
export interface TurnScratch {
  /** Members whose wage couldn't be paid this week (expenses → loyalty). */
  unpaidMemberIds: string[];
  /** `${factionId}|${zoneId}` pairs where protection was already collected this week. */
  protectionCollected: Set<string>;
}

export interface TurnContext {
  data: GameData;
  rng: Rng;
  report: Reporter;
  scratch: TurnScratch;
}

export function zoneName(data: GameData, zoneId: string): string {
  return data.zones.find((z) => z.id === zoneId)?.name ?? zoneId;
}

export function factionName(data: GameData, factionId: string): string {
  return data.factions.find((f) => f.id === factionId)?.name ?? factionId;
}

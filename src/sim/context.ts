import type { GameData } from "../data/schemas";
import type { Reporter } from "./report";
import type { Rng } from "./rng";

/** Per-turn scratch data shared between stages. Never stored in GameState. */
export interface TurnScratch {
  /** Members whose wage couldn't be paid this week (expenses → loyalty). */
  unpaidMemberIds: string[];
  /** `${factionId}|${zoneId}` pairs where protection was already collected this week. */
  protectionCollected: Set<string>;
  /** Members arrested this week, per faction. */
  arrests: Record<string, number>;
  /** Where each member acted this week (valid assignments). Used by crackdowns and trait loyalty. */
  memberTasks: Record<string, { taskId: string; zoneId: string }>;
  /** Factions that performed at least one illegal task this week. */
  illegalFactions: Set<string>;
  /** Owned zones per faction at the start of the week. */
  ownedBefore: Record<string, string[]>;
  /** Members who set out to attack a business, keyed `${factionId}|${zoneId}` (resolved in the combat stage). */
  attacks: Record<string, string[]>;
  /** Members killed this week, per faction. */
  deaths: Record<string, number>;
}

export function newScratch(): TurnScratch {
  return {
    unpaidMemberIds: [],
    protectionCollected: new Set(),
    arrests: {},
    memberTasks: {},
    illegalFactions: new Set(),
    ownedBefore: {},
    attacks: {},
    deaths: {},
  };
}

export function sheriffId(data: GameData): string | null {
  return data.factions.find((f) => f.kind === "sheriff")?.id ?? null;
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

// Member helpers (GDD §6).

import type { Balance } from "../../data/schemas";
import type { GameState, MemberState, StatKey } from "../state";
import { clamp } from "../util";

/** Stat used for resolution: prospects get a penalty on everything (GDD §6), never below the stat min. */
export function effectiveStat(member: MemberState, stat: StatKey, balance: Balance): number {
  const penalty = member.rank === "prospect" ? balance.club.prospectStatPenalty : 0;
  return clamp(member.stats[stat] - penalty, balance.ranges.stat);
}

export function factionMembers(state: GameState, factionId: string): MemberState[] {
  return Object.values(state.members).filter((m) => m.factionId === factionId);
}

export function activeMembers(state: GameState, factionId: string): MemberState[] {
  return factionMembers(state, factionId).filter((m) => m.status === "active");
}

/** Members that count towards the member cap: everyone not dead. */
export function livingMembers(state: GameState, factionId: string): MemberState[] {
  return factionMembers(state, factionId).filter((m) => m.status !== "dead");
}

export function memberLabel(member: MemberState): string {
  return member.nickname ? `${member.nickname} (${member.name})` : member.name;
}

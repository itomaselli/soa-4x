// Experience, levels, specialties and scars (phase 13, the owner's proposal B; data in perks.json).
// - Every task a member carries out gives experience. Each level reached is one specialty to choose.
// - At a level-up the member is offered `choices` specialties, drawn with weights: the specialty's stat
//   plus `traitBonus` if it suits the member's trait. The club chooses with a perk order (the AI too).
// - The rank caps how many specialties a member holds: a promotion opens room for the next one.
// - A combat wound may leave a scar: −penalty to one stat, for good.
// Effects are read through the helpers below, so tasks, the AI and the interface's forecast agree.

import type { GameData, PerkEffect } from "../../data/schemas";
import type { TurnContext } from "../context";
import type { Rng } from "../rng";
import { STAT_KEYS, type GameState, type MemberState } from "../state";
import { clamp } from "../util";
import { activeMembers, memberLabel } from "./members";

type EffectOf<T extends PerkEffect["type"]> = Extract<PerkEffect, { type: T }>;

export function memberEffects<T extends PerkEffect["type"]>(data: GameData, member: MemberState, type: T): EffectOf<T>[] {
  const out: EffectOf<T>[] = [];
  for (const id of member.perks) {
    const def = data.perks.perks.find((p) => p.id === id);
    for (const fx of def?.effects ?? []) if (fx.type === type) out.push(fx as EffectOf<T>);
  }
  return out;
}

/** Effects that work for the whole club while their member is active (no seizures, cartel discount). */
export function clubEffects<T extends PerkEffect["type"]>(state: GameState, data: GameData, factionId: string, type: T): EffectOf<T>[] {
  return activeMembers(state, factionId).flatMap((m) => memberEffects(data, m, type));
}

/** Levels reached with this much experience. */
export function levelFor(data: GameData, xp: number): number {
  return data.perks.xp.levels.filter((needed) => xp >= needed).length;
}

/** Experience still needed for the next level, or null at the top. */
export function nextLevelXp(data: GameData, xp: number): number | null {
  return data.perks.xp.levels.find((needed) => xp < needed) ?? null;
}

export function maxPerks(data: GameData, member: MemberState): number {
  return data.perks.maxPerksByRank[member.rank] ?? 0;
}

/** A level earned and not yet turned into a specialty, with room for one more at this rank. */
export function canEarnPerk(data: GameData, member: MemberState): boolean {
  return levelFor(data, member.xp) > member.perks.length && member.perks.length < maxPerks(data, member);
}

function perkWeight(data: GameData, member: MemberState, perkId: string): number {
  const def = data.perks.perks.find((p) => p.id === perkId);
  if (!def) return 0;
  const suits = data.perks.traitAffinity[member.trait]?.includes(perkId) ?? false;
  return member.stats[def.stat] + (suits ? data.perks.traitBonus : 0);
}

/** `choices` different specialties the member doesn't have, drawn by weight. */
export function rollPerkOptions(data: GameData, member: MemberState, rng: Rng): string[] {
  let pool = data.perks.perks.map((p) => p.id).filter((id) => !member.perks.includes(id));
  const options: string[] = [];
  while (options.length < data.perks.choices && pool.length > 0) {
    const weights = pool.map((id) => perkWeight(data, member, id));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    let index = 0;
    while (index < pool.length - 1 && roll >= weights[index]!) roll -= weights[index++]!;
    options.push(pool[index]!);
    pool = pool.filter((_, i) => i !== index);
  }
  return options;
}

/** The AI picks the option that weighs the most for this member (its strongest stat, its trait). */
export function bestPerk(data: GameData, member: MemberState, options: readonly string[]): string | null {
  return [...options].sort((a, b) => perkWeight(data, member, b) - perkWeight(data, member, a) || a.localeCompare(b))[0] ?? null;
}

/** Experience for everyone who carried out a task this week (end of the tasks stage). */
export function awardExperience(state: GameState, ctx: TurnContext): void {
  for (const memberId of Object.keys(ctx.scratch.memberTasks).sort()) {
    const member = state.members[memberId];
    if (!member) continue;
    const before = levelFor(ctx.data, member.xp);
    member.xp += ctx.data.perks.xp.perTask;
    const after = levelFor(ctx.data, member.xp);
    if (after > before) ctx.report("report.perk.level_up", { member: memberLabel(member), level: after }, member.factionId);
  }
}

/** End of turn: members with a level to spend get their options (one choice at a time). */
export function offerPerks(state: GameState, ctx: TurnContext): void {
  for (const member of Object.values(state.members).sort((a, b) => a.id.localeCompare(b.id))) {
    if (member.status === "dead" || member.perkOptions.length > 0 || !canEarnPerk(ctx.data, member)) continue;
    member.perkOptions = rollPerkOptions(ctx.data, member, ctx.rng);
    if (member.perkOptions.length > 0) {
      ctx.report(
        "report.perk.options",
        { member: memberLabel(member), optionsKeys: member.perkOptions.map((id) => `perk.${id}.name`).join("|") },
        member.factionId,
      );
    }
  }
}

/** A perk order: the member takes one of the specialties on offer. Invalid choices are explained and ignored. */
export function choosePerk(state: GameState, ctx: TurnContext, factionId: string, memberId: string, perkId: string): void {
  const member = state.members[memberId];
  if (!member || member.factionId !== factionId || !member.perkOptions.includes(perkId) || member.perks.length >= maxPerks(ctx.data, member)) {
    ctx.report("report.perk.rejected", { member: member ? memberLabel(member) : memberId }, factionId);
    return;
  }
  member.perks = [...member.perks, perkId];
  member.perkOptions = [];
  ctx.report("report.perk.chosen", { member: memberLabel(member), perkKey: `perk.${perkId}.name` }, factionId);
}

/** A combat wound may leave a scar: one stat goes down for good. */
export function maybeScar(member: MemberState, ctx: TurnContext): void {
  const { scars } = ctx.data.perks;
  if (!ctx.rng.chance(scars.chanceOnCombatWound)) return;
  const available = scars.list.filter((s) => !member.scars.includes(s.id));
  if (available.length === 0) return;
  const scar = ctx.rng.pick(available);
  member.scars = [...member.scars, scar.id];
  member.stats[scar.stat] = clamp(member.stats[scar.stat] - scars.penalty, ctx.data.balance.ranges.stat);
  ctx.report("report.perk.scar", { member: memberLabel(member), scarKey: `scar.${scar.id}.name`, statKey: `stat.${scar.stat}`, penalty: scars.penalty }, member.factionId);
}

/** Starting values for the phase 13 fields (new members, old saves). */
export const NO_PERKS = { xp: 0, perks: [] as string[], scars: [] as string[], perkOptions: [] as string[] };

/** Stat bonus for recruits brought by this member. */
export function recruitBonus(data: GameData, member: MemberState): number {
  return memberEffects(data, member, "recruit_stat_bonus").reduce((sum, fx) => sum + fx.value, 0);
}

export { STAT_KEYS };

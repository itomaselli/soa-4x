// Combat (GDD §11): auto-resolved, with a text report.
// Attackers are the members who chose "attack rival business" in a zone; defenders are the owner's members
// who guarded that zone this week.
//   side strength = Σ effective Strength + gun crates (1 per fighter, if in stock) + HQ bonus (defender) + rng(0..randomMax)
// The attacker wins on a strictly higher total: the business is destroyed and control swings.
// Each fighter on the losing side may die, be jailed or be wounded; winners may be wounded.

import type { GameData } from "../../data/schemas";
import { factionName, zoneName, type TurnContext } from "../context";
import type { BusinessState, GameState, MemberState } from "../state";
import { clamp } from "../util";
import { businessDef } from "./businesses";
import { gainControl, loseControl } from "./control";
import { inTruce } from "./diplomacy";
import { effectiveStat, memberLabel } from "./members";
import { jail } from "./tasks";

/** The rival business an attack in this zone goes after: the most expensive one, not ours, not a truce partner's. */
export function attackTarget(state: GameState, data: GameData, factionId: string, zoneId: string): BusinessState | null {
  const candidates = state.businesses
    .filter((b) => b.zoneId === zoneId && b.ownerFactionId !== factionId && !inTruce(state, factionId, b.ownerFactionId))
    .sort((a, b) => (businessDef(data, b.typeId)?.buildCost ?? 0) - (businessDef(data, a.typeId)?.buildCost ?? 0) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** Strength of a side before the dice: Strength + guns (+ HQ bonus for defenders). */
export function sideStrength(state: GameState, data: GameData, factionId: string, fighters: readonly MemberState[], defendingHq: boolean): number {
  const { combat, tasks } = data.balance;
  const crates = Math.min(state.factions[factionId]?.stock[tasks.gunRun.goodId] ?? 0, fighters.length * combat.cratesPerFighter);
  const strength = fighters.reduce((sum, m) => sum + effectiveStat(m, "strength", data.balance), 0);
  return strength + crates * combat.gunBonusPerCrate + (defendingHq ? combat.hqDefenseBonus : 0);
}

export function resolveCombat(state: GameState, ctx: TurnContext): void {
  const { data } = ctx;
  const { combat, ranges, federal } = data.balance;
  for (const [key, memberIds] of Object.entries(ctx.scratch.attacks).sort((a, b) => a[0].localeCompare(b[0]))) {
    const [attackerId, zoneId] = key.split("|") as [string, string];
    const zone = state.zones[zoneId];
    const attackers = memberIds.map((id) => state.members[id]).filter((m): m is MemberState => m?.status === "active");
    if (!zone || attackers.length === 0) continue;

    const target = attackTarget(state, data, attackerId, zoneId);
    const zoneLabel = zoneName(data, zoneId);
    if (!target) {
      ctx.report("report.combat.no_target", { zone: zoneLabel }, attackerId);
      continue;
    }
    const defenderId = target.ownerFactionId;
    const defenders = Object.entries(ctx.scratch.memberTasks)
      .filter(([, t]) => t.zoneId === zoneId && t.taskId === "task_guard_zone")
      .map(([id]) => state.members[id])
      .filter((m): m is MemberState => m !== undefined && m.factionId === defenderId && m.status === "active");
    const isHq = data.factions.find((f) => f.id === defenderId)?.hqZoneId === zoneId;

    const attack = sideStrength(state, data, attackerId, attackers, false) + ctx.rng.int(0, combat.randomMax);
    const defense = sideStrength(state, data, defenderId, defenders, isHq) + ctx.rng.int(0, combat.randomMax);
    const attackerWins = attack > defense;
    const [winners, losers] = attackerWins ? [attackers, defenders] : [defenders, attackers];
    const [winnerId, loserId] = attackerWins ? [attackerId, defenderId] : [defenderId, attackerId];

    const casualties: string[] = [];
    let deaths = 0;
    for (const m of losers) {
      const roll = ctx.rng.next();
      if (roll < combat.loserDeathChance) {
        m.status = "dead";
        m.statusWeeks = 0;
        ctx.scratch.deaths[m.factionId] = (ctx.scratch.deaths[m.factionId] ?? 0) + 1;
        deaths++;
        casualties.push(`${memberLabel(m)} ✝`);
      } else if (roll < combat.loserDeathChance + combat.loserJailChance) {
        jail(m, ctx);
        casualties.push(`${memberLabel(m)} (preso)`);
      } else if (roll < combat.loserDeathChance + combat.loserJailChance + combat.loserWoundChance) {
        wound(m, ctx);
        casualties.push(`${memberLabel(m)} (herido)`);
      }
    }
    for (const m of winners) {
      if (ctx.rng.chance(combat.winnerWoundChance)) {
        wound(m, ctx);
        casualties.push(`${memberLabel(m)} (herido)`);
      }
    }

    const swing = loseControl(zone, loserId, combat.controlSwing, data.balance);
    gainControl(zone, winnerId, swing, data.balance);
    if (attackerWins) state.businesses = state.businesses.filter((b) => b.id !== target.id);
    zone.heat = clamp(zone.heat + combat.extraHeat, ranges.heat);
    for (const id of [attackerId, defenderId]) {
      const f = state.factions[id];
      if (f) f.federal = clamp(f.federal + federal.perCombat + deaths * federal.perDeath, ranges.federalInvestigation);
    }
    const victim = state.factions[defenderId];
    if (victim) {
      victim.relations[attackerId] = clamp(
        (victim.relations[attackerId] ?? 0) - 2 * data.balance.relations.intimidatedPenalty,
        ranges.relation,
      );
    }
    ctx.report(attackerWins ? "report.combat.attacker_won" : "report.combat.defender_won", {
      attacker: factionName(data, attackerId),
      defender: factionName(data, defenderId),
      zone: zoneLabel,
      businessKey: `business.${target.typeId}`,
      attack,
      defense,
      casualties: casualties.join(", ") || "—",
    });
  }
}

function wound(m: MemberState, ctx: TurnContext): void {
  const { combat } = ctx.data.balance;
  m.status = "wounded";
  m.statusWeeks = ctx.rng.int(combat.woundWeeksMin, combat.woundWeeksMax);
}

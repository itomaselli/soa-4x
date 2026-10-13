// Faction tasks (GDD §7): one task per active member, resolved by initiative across all factions.

import type { Balance, GameData, TaskDef } from "../../data/schemas";
import { factionName, sheriffId, zoneName, type TurnContext } from "../context";
import type { Assignment } from "../orders";
import { STAT_KEYS, TRAITS, type GameState, type MemberState, type Stats, type ZoneState } from "../state";
import { clamp } from "../util";
import { controlOf, gainControl, loseControl, strongestRival } from "./control";
import { atWar, inTruce } from "./diplomacy";
import { businessDef } from "./businesses";
import { marketPrice, sellGoods } from "./economy";
import { arrestChance } from "./law";
import { effectiveStat, livingMembers, memberLabel } from "./members";
import { memberEffects, NO_PERKS, recruitBonus } from "./perks";

interface TaskRun {
  state: GameState;
  ctx: TurnContext;
  member: MemberState;
  task: TaskDef;
  zone: ZoneState;
  /** Common report params: member, zone, task name key. */
  params: Record<string, string | number>;
}

type TaskHandler = (run: TaskRun) => void;

/**
 * Initiative = effective task stat + rng.int(0, initiative.randomMax). Higher goes first; ties by member id.
 * Assignments are sorted by member id before rolling, so the input order never changes the outcome.
 */
export function orderByInitiative(state: GameState, assignments: readonly Assignment[], ctx: TurnContext): Assignment[] {
  const { data, rng } = ctx;
  const rolled = [...assignments]
    .sort((a, b) => a.memberId.localeCompare(b.memberId))
    .map((assignment) => {
      const member = state.members[assignment.memberId];
      const task = data.tasks.find((t) => t.id === assignment.taskId);
      const base = member && task?.stat ? effectiveStat(member, task.stat, data.balance) : 0;
      return { assignment, initiative: base + rng.int(0, data.balance.initiative.randomMax) };
    });
  rolled.sort((a, b) => b.initiative - a.initiative || a.assignment.memberId.localeCompare(b.assignment.memberId));
  return rolled.map((r) => r.assignment);
}

export function resolveFactionTasks(state: GameState, assignments: readonly Assignment[], ctx: TurnContext): void {
  const { data } = ctx;
  for (const assignment of orderByInitiative(state, assignments, ctx)) {
    const member = state.members[assignment.memberId];
    const task = data.tasks.find((t) => t.id === assignment.taskId);
    const zone = state.zones[assignment.zoneId];
    if (!member || !task || !zone || member.status !== "active") continue;

    const params = { member: memberLabel(member), zone: zoneName(data, zone.id), taskKey: `task.${task.id}` };
    const run: TaskRun = { state, ctx, member, task, zone, params };
    ctx.scratch.memberTasks[member.id] = { taskId: task.id, zoneId: zone.id };
    if (task.illegal) ctx.scratch.illegalFactions.add(member.factionId);

    if (task.illegal && rollArrest(run)) {
      applyTaskHeat(run);
      continue;
    }
    const handler = TASK_HANDLERS[task.id];
    if (handler) handler(run);
    else ctx.report("report.task.not_implemented", params, member.factionId);
    applyTaskHeat(run);
  }
}

function rollArrest(run: TaskRun): boolean {
  const { ctx, member, zone, params } = run;
  const { balance } = ctx.data;
  const chance = memberArrestChance(zone, member, ctx.data);
  if (!ctx.rng.chance(chance)) return false;
  jail(member, ctx);
  ctx.report(
    "report.task.arrested",
    { ...params, chance: Math.round(chance * 100), weeks: member.statusWeeks },
    member.factionId,
  );
  return true;
}

/** Sends a member to jail for a random number of weeks and counts the arrest. */
export function jail(member: MemberState, ctx: TurnContext): void {
  const { arrest } = ctx.data.balance;
  member.status = "jailed";
  member.statusWeeks = ctx.rng.int(arrest.jailWeeksMin, arrest.jailWeeksMax);
  ctx.scratch.arrests[member.factionId] = (ctx.scratch.arrests[member.factionId] ?? 0) + 1;
}

/**
 * Heat a task adds to its zone. A sheriff who likes the faction looks the other way:
 * positive heat is reduced by up to `law.sheriffHeatReductionMax`, proportional to his relation (GDD §10).
 */
export function taskHeat(state: GameState, ctx: TurnContext, factionId: string, baseHeat: number): number {
  if (baseHeat <= 0) return baseHeat;
  const sheriff = sheriffId(ctx.data);
  const relation = sheriff ? (state.factions[sheriff]?.relations[factionId] ?? 0) : 0;
  const { max } = ctx.data.balance.ranges.relation;
  const reduction = relation > 0 ? (relation / max) * ctx.data.balance.law.sheriffHeatReductionMax : 0;
  return Math.round(baseHeat * (1 - reduction));
}

function applyTaskHeat(run: TaskRun): void {
  const { state, ctx, task, zone, member } = run;
  if (task.heat === 0) return;
  if (memberEffects(ctx.data, member, "no_task_heat").some((fx) => fx.taskId === task.id)) return;
  zone.heat = clamp(zone.heat + taskHeat(state, ctx, member.factionId, task.heat), ctx.data.balance.ranges.heat);
}

// ---------- Handlers, one per task id in tasks.json ----------

const guardZone: TaskHandler = ({ ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const amount = guardAmount(member, balance);
  const gained = gainControl(zone, member.factionId, amount, balance);
  ctx.report(
    gained > 0 ? "report.task.guard" : "report.task.guard_no_space",
    { ...params, gained, control: controlOf(zone, member.factionId) },
    member.factionId,
  );
};

const collectProtection: TaskHandler = ({ state, ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const key = `${member.factionId}|${zone.id}`;
  if (ctx.scratch.protectionCollected.has(key)) {
    ctx.report("report.task.protection_already_collected", params, member.factionId);
    return;
  }
  const zoneDef = ctx.data.zones.find((z) => z.id === zone.id);
  const control = controlOf(zone, member.factionId);
  const income = protectionIncome(member, zoneDef?.wealth ?? 0, control, balance);
  if (income <= 0) {
    ctx.report("report.task.protection_nothing", params, member.factionId);
    return;
  }
  ctx.scratch.protectionCollected.add(key);
  const faction = state.factions[member.factionId];
  if (faction) faction.money.dirty += income;
  ctx.report(
    "report.task.protection",
    { ...params, income, wealth: zoneDef?.wealth ?? 0, control },
    member.factionId,
  );
};

/**
 * Control an intimidation moves: 2 + Strength/2 (GDD §7), plus a bonus against a faction we're at war with.
 * Exported so the AI estimates with the same rule.
 */
export function intimidateAmount(member: MemberState, data: GameData, againstWarEnemy = false): number {
  const { balance } = data;
  const rule = balance.tasks.intimidate;
  const base = rule.baseGain + Math.floor(effectiveStat(member, "strength", balance) / rule.strengthDivisor);
  if (!againstWarEnemy) return base;
  // Phase 13: an enforcer hits a club we're at war with harder.
  const multiplier = memberEffects(data, member, "war_intimidate_multiplier").reduce((m, fx) => m * fx.value, 1);
  return Math.floor((base + rule.warBonus) * multiplier);
}

/** Arrest chance for this member doing an illegal task in this zone (GDD §7), with specialties (phase 13). */
export function memberArrestChance(zone: Pick<ZoneState, "heat" | "policePresence">, member: MemberState, data: GameData): number {
  const { balance } = data;
  const chance = arrestChance(zone.heat, zone.policePresence, effectiveStat(member, "cunning", balance), balance);
  return memberEffects(data, member, "arrest_multiplier").reduce((c, fx) => c * fx.value, chance);
}

/** Who an intimidation hits: the strongest rival that isn't in a truce with us. */
export function intimidationTarget(state: GameState, zone: ZoneState, factionId: string): string | null {
  const truces = Object.keys(state.factions).filter((id) => id !== factionId && inTruce(state, id, factionId));
  return strongestRival(zone, factionId, truces);
}

/** Control a guard adds: 1 + Strength/3 (GDD §7). */
export function guardAmount(member: MemberState, balance: Balance): number {
  const rule = balance.tasks.guard;
  return rule.baseGain + Math.floor(effectiveStat(member, "strength", balance) / rule.strengthDivisor);
}

/** Expected protection income before the arrest roll: wealth × control × rate × (charmBase + charm × perCharm). */
export function protectionIncome(member: MemberState, wealth: number, control: number, balance: Balance): number {
  const rule = balance.tasks.protection;
  const charmMultiplier = rule.charmBase + effectiveStat(member, "charm", balance) * rule.perCharm;
  return Math.floor(wealth * control * rule.rate * charmMultiplier);
}

const intimidate: TaskHandler = ({ state, ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const rival = intimidationTarget(state, zone, member.factionId);
  const amount = intimidateAmount(member, ctx.data, rival !== null && atWar(state, rival, member.factionId));
  const taken = rival ? loseControl(zone, rival, amount, balance) : 0;
  const gained = gainControl(zone, member.factionId, amount, balance);
  if (rival && taken > 0) {
    // The victim remembers: its relation towards the aggressor drops (GDD §12).
    const victim = state.factions[rival];
    if (victim) {
      victim.relations[member.factionId] = clamp(
        (victim.relations[member.factionId] ?? 0) - balance.relations.intimidatedPenalty,
        balance.ranges.relation,
      );
    }
    ctx.report(
      "report.task.intimidate",
      { ...params, gained, taken, rival: factionName(ctx.data, rival), control: controlOf(zone, member.factionId) },
      member.factionId,
    );
    ctx.report(
      "report.task.intimidated_by",
      { zone: params.zone ?? zone.id, taken, aggressor: factionName(ctx.data, member.factionId), control: controlOf(zone, rival) },
      rival,
    );
  } else {
    ctx.report(
      "report.task.intimidate_no_rival",
      { ...params, gained, control: controlOf(zone, member.factionId) },
      member.factionId,
    );
  }
};

const stealBikes: TaskHandler = ({ state, ctx, member, params }) => {
  const rule = ctx.data.balance.tasks.stealBikes;
  const count = ctx.rng.int(rule.min, rule.max);
  const faction = state.factions[member.factionId];
  if (faction) faction.stock[rule.goodId] = (faction.stock[rule.goodId] ?? 0) + count;
  ctx.report("report.task.steal_bikes", { ...params, count, goodKey: `good.${rule.goodId}` }, member.factionId);
};

const bribe: TaskHandler = ({ state, ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const rule = balance.tasks.bribe;
  const faction = state.factions[member.factionId];
  if (!faction || faction.money.dirty < rule.cost) {
    ctx.report("report.task.bribe_no_money", { ...params, cost: rule.cost }, member.factionId);
    return;
  }
  faction.money.dirty -= rule.cost;
  const before = zone.heat;
  zone.heat = clamp(zone.heat - rule.heatReduction, balance.ranges.heat);
  // The sheriff's goodwill is stored on the sheriff: how he treats this club.
  const sheriff = sheriffId(ctx.data);
  const sheriffState = sheriff ? state.factions[sheriff] : undefined;
  if (sheriffState) {
    sheriffState.relations[member.factionId] = clamp(
      (sheriffState.relations[member.factionId] ?? 0) + rule.sheriffRelationGain,
      balance.ranges.relation,
    );
  }
  ctx.report(
    "report.task.bribe",
    { ...params, cost: rule.cost, heatDrop: before - zone.heat, relation: sheriffState?.relations[member.factionId] ?? 0 },
    member.factionId,
  );
};

const recruit: TaskHandler = ({ state, ctx, member, params }) => {
  const { balance, names } = ctx.data;
  const rule = balance.tasks.recruit;
  if (livingMembers(state, member.factionId).length >= balance.club.memberCap) {
    ctx.report("report.task.recruit_full", { ...params, cap: balance.club.memberCap }, member.factionId);
    return;
  }
  const chance = rule.baseChance + effectiveStat(member, "charm", balance) * rule.perCharm;
  if (!ctx.rng.chance(chance)) {
    ctx.report("report.task.recruit_failed", { ...params, chance: Math.round(chance * 100) }, member.factionId);
    return;
  }
  const stats = {} as Stats;
  // Phase 13: a recruiter brings better people.
  const bonus = recruitBonus(ctx.data, member);
  for (const key of STAT_KEYS) stats[key] = clamp(ctx.rng.int(rule.statMin, rule.statMax) + bonus, balance.ranges.stat);
  const recruitId = `member_recruit_w${state.week}_${member.id.replace(/^member_/, "")}`;
  const newMember: MemberState = {
    id: recruitId,
    factionId: member.factionId,
    name: `${ctx.rng.pick(names.first)} ${ctx.rng.pick(names.last)}`,
    nickname: ctx.rng.pick(names.nicknames),
    rank: "prospect",
    trait: ctx.rng.pick(TRAITS),
    stats,
    loyalty: rule.startingLoyalty,
    status: "active",
    statusWeeks: 0,
    informant: false,
    ...structuredClone(NO_PERKS),
  };
  state.members[recruitId] = newMember;
  ctx.report("report.task.recruit", { ...params, recruit: memberLabel(newMember) }, member.factionId);
};

const lieLow: TaskHandler = ({ ctx, member, params }) => {
  ctx.report("report.task.lie_low", params, member.factionId);
};

/**
 * Working at one of our businesses whose workshop uses this task (garage for "work garage", plantation for
 * "cultivate") adds Hands/handsPerExtraUnit units to its next week's production.
 */
const workBusiness: TaskHandler = ({ state, ctx, member, zone, task, params }) => {
  const business = state.businesses.find(
    (b) =>
      b.ownerFactionId === member.factionId &&
      b.zoneId === zone.id &&
      !b.suspended &&
      businessDef(ctx.data, b.typeId)?.workshop?.workTaskId === task.id,
  );
  const rule = business ? businessDef(ctx.data, business.typeId)?.workshop : undefined;
  if (!business || !rule) {
    ctx.report("report.task.work_none", params, member.factionId);
    return;
  }
  const extra = workExtra(member, rule.handsPerExtraUnit, task.id, ctx.data);
  business.workCapacity += extra;
  ctx.report("report.task.work", { ...params, extra, businessKey: `business.${business.typeId}` }, member.factionId);
};

/** Street units a member can move in a zone: baseUnits + Charm/charmDivisor, at most wealth × unitsPerWealth. */
export function retailUnits(member: MemberState, wealth: number, balance: Balance): number {
  const rule = balance.tasks.retail;
  const byCharm = rule.baseUnits + Math.floor(effectiveStat(member, "charm", balance) / rule.charmDivisor);
  return Math.min(byCharm, wealth * rule.unitsPerWealth);
}

/** Street sales of drugs (GDD §9, phase 9): sells the most valuable street goods first, up to the member's limit. */
const retail: TaskHandler = ({ state, ctx, member, zone, params }) => {
  const faction = state.factions[member.factionId];
  const wealth = ctx.data.zones.find((z) => z.id === zone.id)?.wealth ?? 0;
  let left = retailUnits(member, wealth, ctx.data.balance);
  const goods = ctx.data.goods
    .filter((g) => g.streetOnly && (faction?.stock[g.id] ?? 0) > 0)
    .sort((a, b) => (marketPrice(state, ctx.data, b.id) ?? 0) - (marketPrice(state, ctx.data, a.id) ?? 0));
  if (!faction || goods.length === 0 || left <= 0) {
    ctx.report("report.task.retail_empty", params, member.factionId);
    return;
  }
  for (const good of goods) {
    const units = Math.min(left, faction.stock[good.id] ?? 0);
    if (units <= 0) continue;
    const price = marketPrice(state, ctx.data, good.id) ?? 0;
    const income = sellGoods(state, ctx.data, member.factionId, good.id, units);
    ctx.report("report.task.retail", { ...params, units, goodKey: `good.${good.id}`, price, income }, member.factionId);
    left -= units;
    if (left <= 0) break;
  }
};

/** Crates a gun run moves: baseCrates + Cunning / cunningDivisor (GDD §9, chain B). */
export function gunRunCrates(member: MemberState, data: GameData): number {
  const { balance } = data;
  const rule = balance.tasks.gunRun;
  const bonus = memberEffects(data, member, "gun_run_bonus").reduce((sum, fx) => sum + fx.crates, 0);
  return rule.baseCrates + Math.floor(effectiveStat(member, "cunning", balance) / rule.cunningDivisor) + bonus;
}

/** Extra units a member adds to a workshop by working there: Hands / handsPerExtraUnit, plus specialties. */
export function workExtra(member: MemberState, handsPerExtraUnit: number, taskId: string, data: GameData): number {
  const bonus = memberEffects(data, member, "work_bonus").filter((fx) => fx.taskId === taskId).reduce((sum, fx) => sum + fx.units, 0);
  return Math.floor(effectiveStat(member, "hands", data.balance) / handsPerExtraUnit) + bonus;
}

const gunRun: TaskHandler = ({ state, ctx, member, params }) => {
  const { balance } = ctx.data;
  const goodId = balance.tasks.gunRun.goodId;
  const faction = state.factions[member.factionId];
  const crates = Math.min(faction?.stock[goodId] ?? 0, gunRunCrates(member, ctx.data));
  if (!faction || crates <= 0) {
    ctx.report("report.task.gun_run_empty", params, member.factionId);
    return;
  }
  const price = marketPrice(state, ctx.data, goodId) ?? 0;
  const income = sellGoods(state, ctx.data, member.factionId, goodId, crates);
  faction.federal = clamp(faction.federal + balance.federal.perGunRun, balance.ranges.federalInvestigation);
  ctx.report("report.task.gun_run", { ...params, crates, price, income }, member.factionId);
};

/** Attacks are gathered here and fought together in the combat stage (GDD §4: tasks → combats). */
const attackBusiness: TaskHandler = ({ ctx, member, zone, params }) => {
  const key = `${member.factionId}|${zone.id}`;
  ctx.scratch.attacks[key] = [...(ctx.scratch.attacks[key] ?? []), member.id];
  ctx.report("report.task.attack_ready", params, member.factionId);
};

const TASK_HANDLERS: Record<string, TaskHandler> = {
  task_guard_zone: guardZone,
  task_collect_protection: collectProtection,
  task_intimidate: intimidate,
  task_steal_bikes: stealBikes,
  task_bribe: bribe,
  task_recruit: recruit,
  task_lie_low: lieLow,
  task_work_garage: workBusiness,
  task_cultivate: workBusiness,
  task_retail: retail,
  task_gun_run: gunRun,
  task_attack_business: attackBusiness,
};

/** Task ids with an implementation. Enabled tasks in tasks.json must be in this list (checked by a test). */
export const IMPLEMENTED_TASKS = Object.keys(TASK_HANDLERS);

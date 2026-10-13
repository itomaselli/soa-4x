// Faction tasks (GDD §7): one task per active member, resolved by initiative across all factions.

import type { TaskDef } from "../../data/schemas";
import { factionName, zoneName, type TurnContext } from "../context";
import type { Assignment } from "../orders";
import { STAT_KEYS, TRAITS, type GameState, type MemberState, type Stats, type ZoneState } from "../state";
import { clamp } from "../util";
import { controlOf, gainControl, loseControl, strongestRival } from "./control";
import { arrestChance } from "./law";
import { effectiveStat, livingMembers, memberLabel } from "./members";

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
  const chance = arrestChance(zone.heat, zone.policePresence, effectiveStat(member, "cunning", balance), balance);
  if (!ctx.rng.chance(chance)) return false;
  member.status = "jailed";
  member.statusWeeks = ctx.rng.int(balance.arrest.jailWeeksMin, balance.arrest.jailWeeksMax);
  ctx.report(
    "report.task.arrested",
    { ...params, chance: Math.round(chance * 100), weeks: member.statusWeeks },
    member.factionId,
  );
  return true;
}

function applyTaskHeat(run: TaskRun): void {
  const { ctx, task, zone } = run;
  if (task.heat === 0) return;
  zone.heat = clamp(zone.heat + task.heat, ctx.data.balance.ranges.heat);
}

// ---------- Handlers, one per task id in tasks.json ----------

const guardZone: TaskHandler = ({ ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const rule = balance.tasks.guard;
  const amount = rule.baseGain + Math.floor(effectiveStat(member, "strength", balance) / rule.strengthDivisor);
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
  const rule = balance.tasks.protection;
  const charmMultiplier = rule.charmBase + effectiveStat(member, "charm", balance) * rule.perCharm;
  const income = Math.floor((zoneDef?.wealth ?? 0) * control * rule.rate * charmMultiplier);
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

const intimidate: TaskHandler = ({ ctx, member, zone, params }) => {
  const { balance } = ctx.data;
  const rule = balance.tasks.intimidate;
  const amount = rule.baseGain + Math.floor(effectiveStat(member, "strength", balance) / rule.strengthDivisor);
  const rival = strongestRival(zone, member.factionId);
  const taken = rival ? loseControl(zone, rival, amount, balance) : 0;
  const gained = gainControl(zone, member.factionId, amount, balance);
  if (rival && taken > 0) {
    ctx.report(
      "report.task.intimidate",
      { ...params, gained, taken, rival: factionName(ctx.data, rival), control: controlOf(zone, member.factionId) },
      member.factionId,
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
  const sheriff = ctx.data.factions.find((f) => f.kind === "sheriff");
  if (sheriff) {
    faction.relations[sheriff.id] = clamp((faction.relations[sheriff.id] ?? 0) + rule.sheriffRelationGain, balance.ranges.relation);
  }
  ctx.report(
    "report.task.bribe",
    { ...params, cost: rule.cost, heatDrop: before - zone.heat, relation: sheriff ? (faction.relations[sheriff.id] ?? 0) : 0 },
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
  for (const key of STAT_KEYS) stats[key] = ctx.rng.int(rule.statMin, rule.statMax);
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
  };
  state.members[recruitId] = newMember;
  ctx.report("report.task.recruit", { ...params, recruit: memberLabel(newMember) }, member.factionId);
};

const lieLow: TaskHandler = ({ ctx, member, params }) => {
  ctx.report("report.task.lie_low", params, member.factionId);
};

const TASK_HANDLERS: Record<string, TaskHandler> = {
  task_guard_zone: guardZone,
  task_collect_protection: collectProtection,
  task_intimidate: intimidate,
  task_steal_bikes: stealBikes,
  task_bribe: bribe,
  task_recruit: recruit,
  task_lie_low: lieLow,
};

/** Task ids with an implementation. Enabled tasks in tasks.json must be in this list (checked by a test). */
export const IMPLEMENTED_TASKS = Object.keys(TASK_HANDLERS);

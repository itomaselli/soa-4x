// Faction AI (GDD §12). It plays with the same orders and rules as the player:
// it only builds TurnOrders, which resolveTurn validates like any other.
//
// How it decides: for every free member and every (task, reachable zone) it scores the expected
// value of the action, picks the best member/action pair, applies the expected effect to a
// projected copy of the state (so two members don't chase the same thing), and repeats.
// Weights come from data/ai.json; the "expansive" profile is the Grim Wolves.

import type { AiProfile, GameData } from "../../data/schemas";
import { availableTasks, reachableZones, type Assignment, type TurnOrders } from "../orders";
import { createRng } from "../rng";
import type { GameState, MemberState, ZoneState } from "../state";
import { controlOf, freeControl, gainControl, loseControl, strongestRival, zoneOwner } from "./control";
import { arrestChance } from "./law";
import { activeMembers, effectiveStat, livingMembers } from "./members";
import { guardAmount, intimidateAmount, protectionIncome } from "./tasks";

interface Plan {
  /** Projected state: starts as a copy and absorbs the expected effect of each chosen action. */
  state: GameState;
  collected: Set<string>;
  lowMoney: boolean;
  enemyId: string | null;
  /** Recruit attempts already planned this week (each counts as a likely new member). */
  plannedRecruits: number;
}

interface Candidate {
  member: MemberState;
  taskId: string;
  zoneId: string;
  score: number;
}

/** Salt mixed into the game's rng state so the AI's dice don't consume or mirror the game's own. */
const AI_SEED_SALT = 0x5bd1e995;

function hashString(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Orders for one faction, decided by its AI profile. Deterministic for a given state. */
export function aiOrders(state: GameState, data: GameData, factionId: string): TurnOrders {
  const faction = data.factions.find((f) => f.id === factionId);
  const profile = faction?.aiProfile ? data.ai.profiles[faction.aiProfile] : undefined;
  if (!profile) return { assignments: [] };

  const rng = createRng((state.rngState ^ AI_SEED_SALT ^ hashString(factionId)) >>> 0);
  const plan: Plan = {
    state: structuredClone(state),
    collected: new Set(),
    lowMoney: isLowMoney(state, data, factionId, profile),
    enemyId: findEnemy(state, factionId, profile),
    plannedRecruits: 0,
  };

  const tasks = availableTasks(data);
  const zones = reachableZones(state, data, factionId);
  const free = activeMembers(state, factionId).sort((a, b) => a.id.localeCompare(b.id));
  const assignments: Assignment[] = [];

  while (free.length > 0 && zones.length > 0) {
    let best: Candidate | null = null;
    for (const member of free) {
      for (const taskId of tasks) {
        for (const zoneId of zones) {
          const base = scoreAction(plan, data, profile, member, taskId, zoneId);
          if (base === null) continue;
          const score = base * (1 + profile.noise * (rng.next() * 2 - 1));
          if (!best || score > best.score) best = { member, taskId, zoneId, score };
        }
      }
    }
    if (!best) break;
    assignments.push({ memberId: best.member.id, taskId: best.taskId, zoneId: best.zoneId });
    applyExpected(plan, data, best);
    free.splice(free.indexOf(best.member), 1);
  }
  return { assignments };
}

/** Orders for every faction with an AI profile except `exclude` (usually the human player). */
export function allAiOrders(state: GameState, data: GameData, exclude: string | null): TurnOrders {
  const assignments = data.factions
    .filter((f) => f.aiProfile !== null && f.id !== exclude)
    .flatMap((f) => aiOrders(state, data, f.id).assignments);
  return { assignments };
}

function weeklyWages(state: GameState, data: GameData, factionId: string): number {
  return livingMembers(state, factionId).reduce((sum, m) => sum + (data.balance.wages[m.rank] ?? 0), 0);
}

function isLowMoney(state: GameState, data: GameData, factionId: string, profile: AiProfile): boolean {
  const money = state.factions[factionId]?.money;
  if (!money) return true;
  return money.clean + money.dirty < profile.moneyReserveWeeks * weeklyWages(state, data, factionId);
}

/** The faction that treats us worst, if it's at or below the enemy threshold ("responde a agresiones"). */
function findEnemy(state: GameState, factionId: string, profile: AiProfile): string | null {
  const relations = state.factions[factionId]?.relations ?? {};
  let enemy: string | null = null;
  let worst = profile.enemyRelationThreshold;
  for (const [otherId, value] of Object.entries(relations).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (value <= worst) {
      enemy = otherId;
      worst = value;
    }
  }
  return enemy;
}

/** Expected value of an action, or null if it makes no sense (e.g. bribing without money). */
function scoreAction(plan: Plan, data: GameData, p: AiProfile, member: MemberState, taskId: string, zoneId: string): number | null {
  const { balance } = data;
  const zone = plan.state.zones[zoneId];
  const zoneDef = data.zones.find((z) => z.id === zoneId);
  const task = data.tasks.find((t) => t.id === taskId);
  const faction = plan.state.factions[member.factionId];
  if (!zone || !zoneDef || !task || !faction) return null;

  const wealth = zoneDef.wealth;
  const incomeWeight = p.incomeWeight * (plan.lowMoney ? p.lowMoneyIncomeMultiplier : 1);
  const investment = plan.lowMoney ? p.lowMoneyInvestmentMultiplier : 1;
  const arrest = task.illegal
    ? arrestChance(zone.heat, zone.policePresence, effectiveStat(member, "cunning", balance), balance)
    : 0;
  const risk = arrest * p.arrestPenalty;
  const heatCost = Math.max(0, task.heat) * p.heatPenalty;
  const ownerBefore = zoneOwner(zone, balance);
  const ownControl = controlOf(zone, member.factionId);
  const consolidation = 1 - p.consolidationWeight / 2 + (p.consolidationWeight * ownControl) / balance.ranges.control.max;
  const isHome = ownerBefore === member.factionId || data.factions.some((f) => f.id === member.factionId && f.hqZoneId === zoneId);
  const controlValue = wealth * p.controlWeight * consolidation * investment;
  const takeValue = wealth * p.takeWeight * consolidation * investment * (isHome ? p.defenseMultiplier : 1);

  switch (taskId) {
    case "task_guard_zone": {
      const gain = Math.min(guardAmount(member, balance), freeControl(zone, balance));
      return gain * controlValue + investment * ownershipBonus(zone, member.factionId, gain, 0, null, ownerBefore, data, p);
    }
    case "task_collect_protection": {
      if (plan.collected.has(zoneId)) return null;
      const income = protectionIncome(member, wealth, ownControl, balance);
      if (income <= 0) return null;
      return income * (1 - arrest) * incomeWeight - risk - heatCost;
    }
    case "task_intimidate": {
      const amount = intimidateAmount(member, balance);
      const rival = strongestRival(zone, member.factionId);
      const taken = rival ? Math.min(amount, controlOf(zone, rival)) : 0;
      const gain = Math.min(amount, freeControl(zone, balance) + taken);
      const enemy = rival !== null && rival === plan.enemyId && taken > 0 ? p.enemyBonus : 0;
      return (
        gain * controlValue +
        taken * takeValue +
        enemy +
        investment * ownershipBonus(zone, member.factionId, gain, taken, rival, ownerBefore, data, p) -
        risk -
        heatCost
      );
    }
    case "task_lie_low": {
      const excess = zone.heat - p.lieLowHeatThreshold;
      return excess > 0 ? excess * p.lieLowWeight : 0;
    }
    case "task_bribe": {
      const cost = balance.tasks.bribe.cost;
      if (faction.money.dirty < cost || zone.heat < p.bribeHeatThreshold) return null;
      const drop = Math.min(zone.heat, balance.tasks.bribe.heatReduction);
      return drop * p.bribeWeightPerHeat - cost * incomeWeight;
    }
    case "task_recruit": {
      const living = livingMembers(plan.state, member.factionId).length + plan.plannedRecruits;
      if (plan.lowMoney || living >= p.recruitTargetMembers || living >= balance.club.memberCap) return null;
      const chance = balance.tasks.recruit.baseChance + effectiveStat(member, "charm", balance) * balance.tasks.recruit.perCharm;
      return chance * p.recruitWeight * investment;
    }
    default:
      // Tasks the AI doesn't value yet (e.g. stealing bikes before there's a market).
      return null;
  }
}

/** Bonus if, after the action, the faction would own a zone it didn't own before. */
function ownershipBonus(
  zone: ZoneState,
  factionId: string,
  gain: number,
  taken: number,
  rival: string | null,
  ownerBefore: string | null,
  data: GameData,
  p: AiProfile,
): number {
  if (ownerBefore === factionId || gain + taken <= 0) return 0;
  const after: ZoneState = { ...zone, control: { ...zone.control } };
  after.control[factionId] = controlOf(zone, factionId) + gain;
  if (rival) after.control[rival] = controlOf(zone, rival) - taken;
  return zoneOwner(after, data.balance) === factionId ? p.ownershipBonus : 0;
}

/** Applies the expected effect of the chosen action to the plan, so later choices see it. */
function applyExpected(plan: Plan, data: GameData, c: Candidate): void {
  const { balance } = data;
  const zone = plan.state.zones[c.zoneId];
  const faction = plan.state.factions[c.member.factionId];
  const task = data.tasks.find((t) => t.id === c.taskId);
  if (!zone || !faction || !task) return;
  switch (c.taskId) {
    case "task_guard_zone":
      gainControl(zone, c.member.factionId, guardAmount(c.member, balance), balance);
      break;
    case "task_intimidate": {
      const amount = intimidateAmount(c.member, balance);
      const rival = strongestRival(zone, c.member.factionId);
      if (rival) loseControl(zone, rival, amount, balance);
      gainControl(zone, c.member.factionId, amount, balance);
      break;
    }
    case "task_collect_protection":
      plan.collected.add(c.zoneId);
      break;
    case "task_recruit":
      plan.plannedRecruits++;
      break;
    case "task_bribe":
      faction.money.dirty -= balance.tasks.bribe.cost;
      zone.heat = Math.max(balance.ranges.heat.min, zone.heat - balance.tasks.bribe.heatReduction);
      break;
  }
  zone.heat = Math.min(balance.ranges.heat.max, Math.max(balance.ranges.heat.min, zone.heat + task.heat));
}

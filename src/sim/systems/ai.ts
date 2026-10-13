// Faction AI (GDD §12). It plays with the same orders and rules as the player:
// it only builds TurnOrders, which resolveTurn validates like any other.
//
// How it decides: for every free member and every (task, reachable zone) it scores the expected
// value of the action, picks the best member/action pair, applies the expected effect to a
// projected copy of the state (so two members don't chase the same thing), and repeats.
// Weights come from data/ai.json; the "expansive" profile is the Grim Wolves.

import type { AiProfile, BusinessDef, EventEffect, GameData } from "../../data/schemas";
import { aiProposals, limitProposals } from "./aiCouncil";
import { canAfford } from "./events";
import { loyaltyMembers } from "./loyalty";
import { cartelId } from "../management";
import { availableTasks, reachableZones, type Assignment, type TurnOrders } from "../orders";
import { createRng } from "../rng";
import type { GameState, MemberState, ZoneState } from "../state";
import { controlOf, freeControl, gainControl, loseControl, ownedZones, zoneOwner } from "./control";
import { activeMembers, effectiveStat, livingMembers } from "./members";
import { atWar, getStance, inTruce, warEnemies } from "./diplomacy";
import { bestPerk } from "./perks";
import { guardAmount, gunRunCrates, intimidateAmount, intimidationTarget, memberArrestChance, protectionIncome, retailUnits, taskHeat, workExtra } from "./tasks";
import type { Proposal } from "../council";
import type { ManagementOrder } from "../management";
import { buildLocationProblem, businessDef, factionBusinesses, launderCapacity, storageCapacity, workingBusinesses } from "./businesses";
import { attackTarget, sideStrength } from "./combat";
import { marketPrice } from "./economy";

interface Plan {
  /** Projected state: starts as a copy and absorbs the expected effect of each chosen action. */
  state: GameState;
  collected: Set<string>;
  lowMoney: boolean;
  enemyId: string | null;
  /** Recruit attempts already planned this week (each counts as a likely new member). */
  plannedRecruits: number;
  /** Gun crates not yet promised to a gun run this week. */
  gunsLeft: number;
  /** Strength already sent to attack each zone this week. */
  attackStrength: Record<string, number>;
  /** Zones that already have a guard planned this week. */
  guarded: Set<string>;
  /** Stolen bikes expected from thefts planned this week. */
  plannedBikes: number;
  /** Street goods (drugs) not yet promised to a retail run this week. */
  streetLeft: number;
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
    enemyId: warEnemies(state, factionId)[0] ?? findEnemy(state, factionId, profile),
    plannedRecruits: 0,
    gunsLeft: state.factions[factionId]?.stock[data.balance.tasks.gunRun.goodId] ?? 0,
    attackStrength: {},
    guarded: new Set(),
    plannedBikes: 0,
    streetLeft: data.goods.filter((g) => g.streetOnly).reduce((sum, g) => sum + (state.factions[factionId]?.stock[g.id] ?? 0), 0),
  };

  const tasks = availableTasks(data);
  const home = data.factions.find((f) => f.id === factionId)?.hqZoneId ?? null;
  const zones = reachableZones(state, data, factionId).filter((z) => !profile.homeOnly || z === home);
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
  const { management, proposals: businessProposals } = aiManagement(state, data, factionId, profile);
  const isClub = faction?.kind === "club";
  const proposals = isClub ? limitProposals([...aiProposals(state, data, factionId, profile), ...businessProposals], data) : [];
  // Specialties: each member on offer takes the one that suits him best (same choice a player would see).
  const perkChoices = livingMembers(state, factionId)
    .filter((m) => m.perkOptions.length > 0)
    .flatMap((m) => {
      const perkId = bestPerk(data, m, m.perkOptions);
      return perkId ? [{ memberId: m.id, perkId }] : [];
    });
  return { assignments, management, proposals, eventChoices: aiEventChoices(state, data, factionId), perkChoices };
}

/** Orders for every faction with an AI profile except `exclude` (usually the human player). */
export function allAiOrders(state: GameState, data: GameData, exclude: string | null): TurnOrders {
  const orders = data.factions.filter((f) => f.aiProfile !== null && f.id !== exclude).map((f) => aiOrders(state, data, f.id));
  return {
    assignments: orders.flatMap((o) => o.assignments),
    management: orders.flatMap((o) => o.management ?? []),
    proposals: orders.flatMap((o) => o.proposals ?? []),
    eventChoices: orders.flatMap((o) => o.eventChoices ?? []),
    perkChoices: orders.flatMap((o) => o.perkChoices ?? []),
  };
}

/**
 * Business decisions with simple rules (same orders as the player):
 * sell finished goods, launder up to the safe share of capacity, build along a wishlist (illegal businesses
 * through the council) and buy from the cartel under a deal. Only clubs manage businesses.
 */
function aiManagement(state: GameState, data: GameData, factionId: string, p: AiProfile): { management: ManagementOrder[]; proposals: Proposal[] } {
  const management: ManagementOrder[] = [];
  const proposals: Proposal[] = [];
  const faction = state.factions[factionId];
  if (!faction || data.factions.find((f) => f.id === factionId)?.kind !== "club") return { management, proposals };

  for (const good of data.goods) {
    const quantity = faction.stock[good.id] ?? 0;
    if (good.basePrice !== null && good.id !== data.balance.tasks.gunRun.goodId && quantity > 0) {
      management.push({ kind: "sell", factionId, goodId: good.id, quantity });
    }
  }

  const capacity = launderCapacity(state, data, factionId);
  const safe = Math.floor(capacity * data.balance.laundering.federalAttentionCapacityRatio);
  const launder = Math.min(safe, Math.floor(faction.money.dirty - p.cashReserve));
  if (launder > 0) management.push({ kind: "launder", factionId, amount: launder });

  // Build order: bar (clean income, laundering, loyalty) → chop shop → garage → plantation → warehouse → cut house.
  // Illegal ones go to the council. Each goes in the first owned zone where it's allowed and there's a slot.
  const has = (pred: (d: BusinessDef) => boolean) =>
    factionBusinesses(state, factionId).some((b) => {
      const d = businessDef(data, b.typeId);
      return d !== undefined && pred(d);
    });
  const stolenBike = data.balance.tasks.stealBikes.goodId;
  const cartelForWishlist = cartelId(data);
  const cartelWouldSell =
    cartelForWishlist !== null &&
    (state.factions[cartelForWishlist]?.relations[factionId] ?? 0) >= data.balance.cartel.dealMinRelation;
  const wishlist: Array<[boolean, BusinessDef | undefined]> = [
    [true, data.businesses.find((d) => d.bar)],
    [true, data.businesses.find((d) => d.processor?.inputGoodId === stolenBike)],
    [true, data.businesses.find((d) => d.workshop?.workTaskId === "task_work_garage")],
    [p.council.wantsDrugs, data.businesses.find((d) => d.workshop && d.workshop.inputGoodId === null)],
    [p.council.wantsGuns, data.businesses.find((d) => d.storage?.goodId === data.balance.tasks.gunRun.goodId)],
    // A cut house only makes sense if the cartel would sell us kilos.
    [p.council.wantsDrugs && cartelWouldSell, data.businesses.find((d) => d.processor && d.storage && d.storage.goodId === d.processor.inputGoodId)],
  ];
  const owned = ownedZones(state, factionId, data.balance);
  for (const [wanted, def] of wishlist) {
    if (!wanted || !def || has((d) => d.id === def.id)) continue;
    const zone = owned.find((z) => buildLocationProblem(state, data, factionId, def.id, z) === null);
    if (!zone) continue; // no place for it yet: try the next one on the list
    if (faction.money.clean >= def.buildCost + p.cashReserve) {
      if (def.legal) management.push({ kind: "build", factionId, typeId: def.id, zoneId: zone });
      else proposals.push({ factionId, type: "open_illegal_business", businessTypeId: def.id, zoneId: zone });
    }
    break; // one business at a time
  }

  // Under a cartel deal, fill storage with what we can afford (guns, kilos), most important first.
  const cartel = cartelId(data);
  if (cartel && getStance(state, factionId, cartel)?.type === "deal") {
    let budget = faction.money.dirty - p.cashReserve;
    for (const [goodId, price] of Object.entries(data.balance.cartel.catalog)) {
      const space = (storageCapacity(state, data, factionId, goodId) ?? 0) - (faction.stock[goodId] ?? 0);
      const quantity = Math.min(space, Math.floor(budget / price));
      if (quantity > 0) {
        management.push({ kind: "buy", factionId, goodId, quantity });
        budget -= quantity * price;
      }
    }
  }
  return { management, proposals };
}

/** Picks the option of each pending event with the best expected value (same choices as the player). */
export function aiEventChoices(state: GameState, data: GameData, factionId: string): { instanceId: string; optionId: string }[] {
  return state.pendingEvents
    .filter((e) => e.factionId === factionId)
    .flatMap((e) => {
      const def = data.events.find((d) => d.id === e.eventId);
      if (!def) return [];
      const members = loyaltyMembers(state, factionId).length;
      const options = def.options.filter((o) => canAfford(state, factionId, def, o.id));
      const best = options
        .map((o) => ({ id: o.id, value: effectsValue(o.effects, data.ai.eventValues, members) }))
        .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
      return best ? [{ instanceId: e.instanceId, optionId: best.id }] : [];
    });
}

function effectsValue(effects: readonly EventEffect[], v: GameData["ai"]["eventValues"], members: number): number {
  return effects.reduce((sum, fx) => {
    switch (fx.type) {
      case "money":
        return sum + fx.amount * v.money;
      case "loyalty":
        return sum + fx.amount * v.loyaltyPerMember * (fx.target === "subject" ? 1 : members);
      case "sheriff":
        return sum + fx.amount * v.sheriff;
      case "rival_relation":
        return sum + fx.amount * v.rivalRelation;
      case "heat":
        return sum + fx.amount * v.heat;
      case "promote_subject":
        return sum + v.promoteSubject;
      case "defect_subject":
        return sum + v.defectSubject;
      case "jail_random":
        return sum + v.jailRandom;
      case "expose_informant":
        return sum + v.exposeInformant;
      case "chance":
        return sum + fx.probability * effectsValue(fx.success, v, members) + (1 - fx.probability) * effectsValue(fx.failure, v, members);
    }
  }, 0);
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
    ? memberArrestChance(zone, member, data)
    : 0;
  const addedHeat = Math.max(0, taskHeatEstimate(plan, data, member.factionId, task.heat));
  const crackdownRisk = task.illegal && zone.heat + addedHeat >= balance.heat.crackdownThreshold ? p.crackdownPenalty : 0;
  // A club in unrest can't afford more arrests: they also cost loyalty.
  const caution = (plan.state.factions[member.factionId]?.lowLoyaltyWeeks ?? 0) > 0 ? p.council.unrestCaution : 1;
  const risk = arrest * p.arrestPenalty * caution + crackdownRisk;
  const heatCost = addedHeat * p.heatPenalty;
  const affinity = data.traits.tasks[member.trait];
  const traitValue =
    (affinity?.likes.includes(taskId) ? p.traitLikeWeight : 0) - (affinity?.dislikes.includes(taskId) ? p.traitDislikeWeight : 0);
  const ownerBefore = zoneOwner(zone, balance);
  const ownControl = controlOf(zone, member.factionId);
  const consolidation = 1 - p.consolidationWeight / 2 + (p.consolidationWeight * ownControl) / balance.ranges.control.max;
  const isHome = ownerBefore === member.factionId || data.factions.some((f) => f.id === member.factionId && f.hqZoneId === zoneId);
  const controlValue = wealth * p.controlWeight * consolidation * investment;
  const takeValue = wealth * p.takeWeight * consolidation * investment * (isHome ? p.defenseMultiplier : 1);

  const scoreTask = (): number | null => {
    switch (taskId) {
      case "task_guard_zone": {
        const gain = Math.min(guardAmount(member, balance), freeControl(zone, balance));
        return (
          gain * controlValue +
          investment * ownershipBonus(plan.state, zone, member.factionId, gain, 0, null, ownerBefore, data, p) +
          (plan.guarded.has(zoneId) ? 0 : businessesAtRisk(plan.state, data, member.factionId, zoneId) * p.defendWeight)
        );
      }
      case "task_collect_protection": {
        if (plan.collected.has(zoneId)) return null;
        const income = protectionIncome(member, wealth, ownControl, balance);
        if (income <= 0) return null;
        return income * (1 - arrest) * incomeWeight - risk - heatCost;
      }
      case "task_intimidate": {
        const rival = intimidationTarget(plan.state, zone, member.factionId);
        const amount = intimidateAmount(member, data, rival !== null && atWar(plan.state, rival, member.factionId));
        const taken = rival ? Math.min(amount, controlOf(zone, rival)) : 0;
        const gain = Math.min(amount, freeControl(zone, balance) + taken);
        const enemy = rival !== null && rival === plan.enemyId && taken > 0 ? p.enemyBonus : 0;
      // Don't anger the cartel while we want to buy from it.
      const cartel = cartelId(data);
      const wantsCartel = (p.council.wantsGuns || p.council.wantsDrugs) && rival === cartel && taken > 0;
      if (wantsCartel) return null;
        return (
          gain * controlValue +
          taken * takeValue +
          enemy +
          investment * ownershipBonus(plan.state, zone, member.factionId, gain, taken, rival, ownerBefore, data, p) -
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
      case "task_steal_bikes": {
      const rule = balance.tasks.stealBikes;
      const chop = data.businesses.find((d) => d.processor?.inputGoodId === rule.goodId)?.processor;
      const chopCapacity = workingBusinesses(plan.state, member.factionId).reduce(
        (sum, b) => sum + (businessDef(data, b.typeId)?.processor?.inputGoodId === rule.goodId ? (businessDef(data, b.typeId)?.processor?.inputPerWeek ?? 0) : 0),
        0,
      );
      const partsPrice = chop ? (marketPrice(plan.state, data, chop.outputGoodId) ?? 0) : 0;
      // Only steal what the chop shops can take: up to two weeks of their capacity in stock.
      const backlog = (faction.stock[rule.goodId] ?? 0) + plan.plannedBikes;
      if (!chop || chopCapacity === 0 || backlog >= 2 * chopCapacity) return null;
      const bikes = (rule.min + rule.max) / 2;
      return bikes * chop.outputPerInput * partsPrice * p.goodsWeight * incomeWeight - risk - heatCost;
    }
    case "task_work_garage":
    case "task_cultivate": {
      const business = plan.state.businesses.find(
        (b) =>
          b.ownerFactionId === member.factionId &&
          b.zoneId === zoneId &&
          !b.suspended &&
          businessDef(data, b.typeId)?.workshop?.workTaskId === taskId,
      );
      const rule = business ? businessDef(data, business.typeId)?.workshop : undefined;
      if (!business || !rule) return null;
      const byHands = workExtra(member, rule.handsPerExtraUnit, taskId, data);
      const spare =
        rule.inputGoodId && rule.inputPerUnit > 0
          ? Math.floor((faction.stock[rule.inputGoodId] ?? 0) / rule.inputPerUnit) - rule.baseOutput - business.workCapacity
          : byHands;
      const extra = Math.min(spare, byHands);
      if (extra <= 0) return null;
      return extra * (marketPrice(plan.state, data, rule.outputGoodId) ?? 0) * p.goodsWeight * incomeWeight - risk - heatCost;
    }
    case "task_retail": {
      const units = Math.min(plan.streetLeft, retailUnits(member, wealth, balance));
      if (units <= 0) return null;
      const best = Math.max(0, ...data.goods.filter((g) => g.streetOnly && (faction.stock[g.id] ?? 0) > 0).map((g) => marketPrice(plan.state, data, g.id) ?? 0));
      return units * best * incomeWeight - risk - heatCost;
    }
    case "task_gun_run": {
      const crates = Math.min(plan.gunsLeft, gunRunCrates(member, data));
      if (crates <= 0) return null;
      const price = marketPrice(plan.state, data, balance.tasks.gunRun.goodId) ?? 0;
      return crates * price * incomeWeight - risk - heatCost;
    }
    case "task_attack_business": {
      const target = attackTarget(plan.state, data, member.factionId, zoneId);
      if (!target || p.attackWeight === 0) return null;
      const ownStrength = sideStrength(plan.state, data, member.factionId, [member], false);
      const attack = (plan.attackStrength[zoneId] ?? 0) + ownStrength;
      const isHq = data.factions.find((f) => f.id === target.ownerFactionId)?.hqZoneId === zoneId;
      const defense = isHq ? balance.combat.hqDefenseBonus : 0;
      const spread = Math.max(1, 2 * balance.combat.randomMax);
      const winChance = Math.min(1, Math.max(0, (attack - defense + balance.combat.randomMax) / spread));
      const cost = businessDef(data, target.typeId)?.buildCost ?? 0;
      return cost * p.attackWeight * winChance * investment - risk - heatCost;
    }
    case "task_recruit": {
        const living = livingMembers(plan.state, member.factionId).length + plan.plannedRecruits;
        if (plan.lowMoney || living >= Math.round(p.recruitTargetShare * balance.club.memberCap) || living >= balance.club.memberCap) return null;
        const chance = balance.tasks.recruit.baseChance + effectiveStat(member, "charm", balance) * balance.tasks.recruit.perCharm;
        return chance * p.recruitWeight * investment;
      }
      default:
        // Tasks the AI doesn't value yet (e.g. stealing bikes before there's a market).
        return null;
    }
  };
  const value = scoreTask();
  return value === null ? null : value + traitValue;
}

/** Same heat rule as the sim (sheriff goodwill included), evaluated on the plan. */
function taskHeatEstimate(plan: Plan, data: GameData, factionId: string, heat: number): number {
  return taskHeat(plan.state, { data } as Parameters<typeof taskHeat>[1], factionId, heat);
}

/** Build cost of our businesses in a zone that another club could attack this week (it can reach the zone). */
function businessesAtRisk(state: GameState, data: GameData, factionId: string, zoneId: string): number {
  const ours = state.businesses.filter((b) => b.ownerFactionId === factionId && b.zoneId === zoneId);
  if (ours.length === 0) return 0;
  const threatened = data.factions.some(
    (f) => f.kind === "club" && f.id !== factionId && !inTruce(state, f.id, factionId) && reachableZones(state, data, f.id).includes(zoneId),
  );
  return threatened ? ours.reduce((sum, b) => sum + (businessDef(data, b.typeId)?.buildCost ?? 0), 0) : 0;
}

/**
 * Zones worth more to own because they unlock a business we want but can't place anywhere yet
 * (a rural zone for a plantation). Returns a multiplier for the ownership bonus.
 */
function strategicMultiplier(state: GameState, data: GameData, factionId: string, zoneId: string, p: AiProfile): number {
  if (!p.council.wantsDrugs) return 1;
  const zoneType = data.zones.find((z) => z.id === zoneId)?.type;
  const wanted = data.businesses.filter(
    (d) => d.allowedZoneTypes?.includes(zoneType!) && !factionBusinesses(state, factionId).some((b) => b.typeId === d.id),
  );
  const placeable = (id: string) => ownedZones(state, factionId, data.balance).some((z) => buildLocationProblem(state, data, factionId, id, z) === null);
  return wanted.some((d) => !placeable(d.id)) ? 2 : 1;
}

/** Bonus if, after the action, the faction would own a zone it didn't own before. */
function ownershipBonus(
  state: GameState,
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
  return zoneOwner(after, data.balance) === factionId ? p.ownershipBonus * strategicMultiplier(state, data, factionId, zone.id, p) : 0;
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
      plan.guarded.add(c.zoneId);
      break;
    case "task_intimidate": {
      const rival = intimidationTarget(plan.state, zone, c.member.factionId);
      const amount = intimidateAmount(c.member, data, rival !== null && atWar(plan.state, rival, c.member.factionId));
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
    case "task_steal_bikes":
      plan.plannedBikes += (balance.tasks.stealBikes.min + balance.tasks.stealBikes.max) / 2;
      break;
    case "task_retail": {
      const wealth = data.zones.find((z) => z.id === c.zoneId)?.wealth ?? 0;
      plan.streetLeft -= Math.min(plan.streetLeft, retailUnits(c.member, wealth, balance));
      break;
    }
    case "task_gun_run":
      plan.gunsLeft -= Math.min(plan.gunsLeft, gunRunCrates(c.member, data));
      break;
    case "task_attack_business":
      plan.attackStrength[c.zoneId] = (plan.attackStrength[c.zoneId] ?? 0) + sideStrength(plan.state, data, c.member.factionId, [c.member], false);
      break;
    case "task_bribe":
      faction.money.dirty -= balance.tasks.bribe.cost;
      zone.heat = Math.max(balance.ranges.heat.min, zone.heat - balance.tasks.bribe.heatReduction);
      break;
  }
  zone.heat = Math.min(balance.ranges.heat.max, Math.max(balance.ranges.heat.min, zone.heat + task.heat));
}

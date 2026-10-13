// Loyalty (GDD §6). Each week, for every club member except the president:
//   + paid wages, zones won, tasks the member's trait enjoys
//   − unpaid wages, zones lost, fellow members arrested, long wars, tasks the trait resents
// Then members under the low-loyalty threshold may desert or secretly turn informant (GDD §10),
// and if the club's average loyalty stays low for weeks, the council votes to remove the president.

import type { TurnContext } from "../context";
import type { GameState, MemberState } from "../state";
import { clamp } from "../util";
import { businessDef, workingBusinesses } from "./businesses";
import { ownedZones } from "./control";
import { holdVote } from "./council";
import { getStance, warEnemies } from "./diplomacy";
import { factionMembers, memberLabel } from "./members";

export function resolveLoyalty(state: GameState, ctx: TurnContext): void {
  for (const def of ctx.data.factions) {
    if (def.kind !== "club") continue;
    weeklyLoyalty(state, ctx, def.id);
    lowLoyaltyConsequences(state, ctx, def.id);
    impeachmentCheck(state, ctx, def.id);
  }
}

function change(member: MemberState, amount: number, ctx: TurnContext): void {
  member.loyalty = clamp(member.loyalty + amount, ctx.data.balance.ranges.loyalty);
}

/** Members whose loyalty matters: everyone alive except the president (that's you). */
export function loyaltyMembers(state: GameState, factionId: string): MemberState[] {
  return factionMembers(state, factionId)
    .filter((m) => m.status !== "dead" && m.rank !== "president")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function averageLoyalty(state: GameState, factionId: string): number | null {
  const members = loyaltyMembers(state, factionId);
  if (members.length === 0) return null;
  return members.reduce((sum, m) => sum + m.loyalty, 0) / members.length;
}

function weeklyLoyalty(state: GameState, ctx: TurnContext, factionId: string): void {
  const l = ctx.data.balance.loyalty;
  const members = loyaltyMembers(state, factionId);
  if (members.length === 0) return;
  const unpaid = new Set(ctx.scratch.unpaidMemberIds);

  const before = new Set(ctx.scratch.ownedBefore[factionId] ?? []);
  const after = new Set(ownedZones(state, factionId, ctx.data.balance));
  const gained = [...after].filter((z) => !before.has(z)).length;
  const lost = [...before].filter((z) => !after.has(z)).length;
  const arrests = ctx.scratch.arrests[factionId] ?? 0;
  const longWars = warEnemies(state, factionId).filter((enemy) => {
    const stance = getStance(state, factionId, enemy);
    return stance !== null && state.week - stance.sinceWeek >= l.warLongWeeks;
  }).length;

  const deaths = ctx.scratch.deaths[factionId] ?? 0;
  const barBonus = workingBusinesses(state, factionId).reduce(
    (best, b) => Math.max(best, businessDef(ctx.data, b.typeId)?.bar?.loyaltyBonus ?? 0),
    0,
  );
  const shared =
    gained * l.zoneGainedBonus -
    lost * l.zoneLostPenalty -
    arrests * l.arrestPenalty -
    deaths * l.deathPenalty -
    longWars * l.warWeeklyPenalty +
    barBonus;
  for (const m of members) {
    change(m, shared + (unpaid.has(m.id) ? -l.unpaidPenalty : l.paidBonus), ctx);
    const task = ctx.scratch.memberTasks[m.id];
    const affinity = ctx.data.traits.tasks[m.trait];
    if (task && affinity?.likes.includes(task.taskId)) change(m, l.traitLikeBonus, ctx);
    if (task && affinity?.dislikes.includes(task.taskId)) {
      change(m, -l.traitDislikePenalty, ctx);
      ctx.report("report.loyalty.trait_dislike", { member: memberLabel(m), traitKey: `trait.${m.trait}`, taskKey: `task.${task.taskId}`, penalty: l.traitDislikePenalty }, factionId);
    }
    if (unpaid.has(m.id)) {
      ctx.report("report.loyalty.unpaid", { member: memberLabel(m), penalty: l.unpaidPenalty, loyalty: m.loyalty }, factionId);
    }
  }
  if (gained > 0) ctx.report("report.loyalty.zones_gained", { count: gained, bonus: gained * l.zoneGainedBonus }, factionId);
  if (lost > 0) ctx.report("report.loyalty.zones_lost", { count: lost, penalty: lost * l.zoneLostPenalty }, factionId);
  if (arrests > 0) ctx.report("report.loyalty.arrests", { count: arrests, penalty: arrests * l.arrestPenalty }, factionId);
  if (longWars > 0) ctx.report("report.loyalty.long_war", { penalty: longWars * l.warWeeklyPenalty }, factionId);
  if (deaths > 0) ctx.report("report.loyalty.deaths", { count: deaths, penalty: deaths * l.deathPenalty }, factionId);
  if (barBonus > 0) ctx.report("report.loyalty.bar", { bonus: barBonus }, factionId);
}

function lowLoyaltyConsequences(state: GameState, ctx: TurnContext, factionId: string): void {
  const { club, loyalty } = ctx.data.balance;
  for (const m of loyaltyMembers(state, factionId)) {
    if (m.loyalty >= club.lowLoyaltyThreshold) continue;
    const roll = ctx.rng.next();
    if (roll < loyalty.desertChance) {
      delete state.members[m.id];
      ctx.report("report.loyalty.deserted", { member: memberLabel(m), loyalty: m.loyalty }, factionId);
    } else if (!m.informant && roll < loyalty.desertChance + loyalty.informantChance) {
      m.informant = true; // secret: no report
    }
  }
  const hasInformant = loyaltyMembers(state, factionId).some((m) => m.informant);
  if (hasInformant && ctx.rng.chance(loyalty.informantHintChance)) {
    ctx.report("report.loyalty.informant_rumor", {}, factionId);
  }
}

/** The motion is brought by the vice president, or else the most ambitious member, or else the least loyal. */
function motionProposer(state: GameState, factionId: string): MemberState | null {
  const candidates = loyaltyMembers(state, factionId).filter((m) => m.rank !== "prospect" && m.status !== "jailed");
  return (
    candidates.find((m) => m.rank === "vice_president") ??
    candidates.find((m) => m.trait === "ambitious") ??
    [...candidates].sort((a, b) => a.loyalty - b.loyalty)[0] ??
    null
  );
}

function impeachmentCheck(state: GameState, ctx: TurnContext, factionId: string): void {
  const { council } = ctx.data.balance;
  const faction = state.factions[factionId];
  const avg = averageLoyalty(state, factionId);
  if (!faction || avg === null) return;
  faction.lowLoyaltyWeeks = avg < council.impeachmentAverageLoyalty ? faction.lowLoyaltyWeeks + 1 : 0;
  if (faction.lowLoyaltyWeeks > 0 && faction.lowLoyaltyWeeks < council.impeachmentWeeks) {
    ctx.report("report.loyalty.unrest", { average: Math.round(avg), weeks: faction.lowLoyaltyWeeks, limit: council.impeachmentWeeks }, factionId);
  }
  if (faction.lowLoyaltyWeeks < council.impeachmentWeeks) return;

  faction.lowLoyaltyWeeks = 0;
  const proposer = motionProposer(state, factionId);
  if (!proposer) return;
  const vote = holdVote(state, factionId, "impeachment", ctx, { againstPresident: proposer.id });
  const params = {
    proposer: memberLabel(proposer),
    for: vote.no.length,
    against: vote.yes.length + 1,
  };
  if (vote.passed) {
    ctx.report("report.loyalty.impeachment_failed", params, factionId);
    return;
  }
  ctx.report("report.loyalty.impeachment_passed", params, factionId);
  if (factionId === state.playerFactionId) {
    state.outcome = { result: "defeat", reasonKey: "outcome.defeat.impeached", week: state.week };
  }
}

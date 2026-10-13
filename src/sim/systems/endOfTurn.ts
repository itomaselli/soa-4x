// End of turn (GDD §4 step 6, §14): status countdown, victory/defeat checks, next week.
// Status weeks count the week the status started: jailed for 3 weeks in week 1 → back to work in week 4.

import { factionName, type TurnContext } from "../context";
import type { GameState, Outcome } from "../state";
import { controlOf, loseControl, ownedZones, zoneOwner } from "./control";
import { decayMarket } from "./economy";
import { livingMembers, memberLabel } from "./members";

export function resolveEndOfTurn(state: GameState, ctx: TurnContext): void {
  erodeInfluence(state, ctx);
  advanceStatuses(state, ctx);
  updateControlStreaks(state, ctx);
  recordHistory(state, ctx);
  expireTruces(state, ctx);
  decayMarket(state, ctx.data);
  // An outcome may already be set earlier in the week (e.g. impeachment in the loyalty stage).
  state.outcome = state.outcome ?? checkOutcome(state, ctx);
  if (state.outcome) {
    ctx.report(`report.${state.outcome.reasonKey}`, {}, state.playerFactionId);
  }
  state.week += 1;
}

/**
 * Influence fades where a faction isn't present (GDD §5, phase 6): −erosionPerWeek in each zone it doesn't own,
 * that isn't its HQ, and where none of its members acted this week. Spreading thin stops paying off.
 */
function erodeInfluence(state: GameState, ctx: TurnContext): void {
  const { balance, factions } = ctx.data;
  const amount = balance.control.erosionPerWeek;
  if (amount <= 0) return;
  const present = new Set(
    Object.entries(ctx.scratch.memberTasks).map(([memberId, t]) => `${state.members[memberId]?.factionId}|${t.zoneId}`),
  );
  const lostBy: Record<string, number> = {};
  for (const zone of Object.values(state.zones)) {
    const owner = zoneOwner(zone, balance);
    for (const factionId of Object.keys(zone.control).sort()) {
      const hq = factions.find((f) => f.id === factionId)?.hqZoneId;
      if (factionId === owner || hq === zone.id || present.has(`${factionId}|${zone.id}`)) continue;
      const lost = loseControl(zone, factionId, amount, balance);
      if (lost > 0) lostBy[factionId] = (lostBy[factionId] ?? 0) + lost;
    }
  }
  for (const [factionId, total] of Object.entries(lostBy)) {
    ctx.report("report.control.erosion", { total, amount }, factionId);
  }
}

function recordHistory(state: GameState, ctx: TurnContext): void {
  const keep = ctx.data.balance.council.vote.momentumWeeks + 1;
  for (const def of ctx.data.factions) {
    const faction = state.factions[def.id];
    if (def.kind !== "club" || !faction) continue;
    faction.ownedHistory = [...faction.ownedHistory, ownedZones(state, def.id, ctx.data.balance).length].slice(-keep);
  }
}

function expireTruces(state: GameState, ctx: TurnContext): void {
  for (const [key, stance] of Object.entries(state.stances)) {
    if (stance.type === "truce" && state.week - stance.sinceWeek + 1 >= ctx.data.balance.council.truceWeeks) {
      delete state.stances[key];
      const names = key.split("|").map((id) => factionName(ctx.data, id));
      ctx.report("report.council.truce_over", { a: names[0] ?? "", b: names[1] ?? "" });
    }
  }
}

function advanceStatuses(state: GameState, ctx: TurnContext): void {
  for (const member of Object.values(state.members)) {
    if (member.status !== "jailed" && member.status !== "wounded") continue;
    member.statusWeeks = Math.max(0, member.statusWeeks - 1);
    if (member.statusWeeks === 0) {
      ctx.report(
        member.status === "jailed" ? "report.status.released" : "report.status.recovered",
        { member: memberLabel(member) },
        member.factionId,
      );
      member.status = "active";
    }
  }
}

function updateControlStreaks(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const faction of ctx.data.factions) {
    if (faction.kind !== "club") continue;
    const owned = ownedZones(state, faction.id, balance).length;
    const streak = owned >= balance.victory.zonesToControl ? (state.controlStreaks[faction.id] ?? 0) + 1 : 0;
    state.controlStreaks[faction.id] = streak;
  }
}

/** Player outcome (GDD §14). Defeat is checked first. Council impeachment arrives in phase 4. */
export function checkOutcome(state: GameState, ctx: TurnContext): Outcome | null {
  const { balance } = ctx.data;
  const player = state.playerFactionId;
  const week = state.week;

  if ((state.factions[player]?.federal ?? 0) >= balance.ranges.federalInvestigation.max) {
    return { result: "defeat", reasonKey: "outcome.defeat.federal_raid", week };
  }
  // "Activos" = still in the club: jailed and wounded members count, the dead and the deserters don't.
  if (livingMembers(state, player).length < balance.defeat.minActiveMembers) {
    return { result: "defeat", reasonKey: "outcome.defeat.too_few_members", week };
  }
  if (Object.values(state.zones).every((z) => controlOf(z, player) <= balance.ranges.control.min)) {
    return { result: "defeat", reasonKey: "outcome.defeat.expelled", week };
  }
  const rivalWinner = Object.entries(state.controlStreaks).find(
    ([factionId, streak]) => factionId !== player && streak >= balance.victory.weeksHeld,
  );
  if (rivalWinner) {
    return { result: "defeat", reasonKey: "outcome.defeat.rival_territory", week };
  }
  if ((state.controlStreaks[player] ?? 0) >= balance.victory.weeksHeld) {
    return { result: "victory", reasonKey: "outcome.victory.territory", week };
  }
  const rival = balance.victory.rivalToExpel;
  if (rival !== player && Object.values(state.zones).every((z) => controlOf(z, rival) <= balance.ranges.control.min)) {
    return { result: "victory", reasonKey: "outcome.victory.rival_expelled", week };
  }
  return null;
}

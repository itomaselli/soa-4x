// Weekly expenses (GDD §8): club wages and business upkeep.
// Wages are paid cash-in-hand: dirty money first, then clean. A member is paid in full or not at all.
// Upkeep is paid with clean money first, then dirty; a business that can't be paid is suspended
// (it doesn't produce or launder) until a later week when it can.

import { zoneName, type TurnContext } from "../context";
import { businessDef } from "./businesses";
import type { GameState } from "../state";
import { livingMembers, memberLabel } from "./members";

export function payExpenses(state: GameState, ctx: TurnContext): void {
  payWages(state, ctx);
  payUpkeep(state, ctx);
}

function payUpkeep(state: GameState, ctx: TurnContext): void {
  for (const business of [...state.businesses].sort((a, b) => a.id.localeCompare(b.id))) {
    const faction = state.factions[business.ownerFactionId];
    const cost = businessDef(ctx.data, business.typeId)?.maintenance ?? 0;
    if (!faction) continue;
    const params = { businessKey: `business.${business.typeId}`, zone: zoneName(ctx.data, business.zoneId), cost };
    if (faction.money.clean + faction.money.dirty < cost) {
      if (!business.suspended) ctx.report("report.expenses.suspended", params, business.ownerFactionId);
      business.suspended = true;
      continue;
    }
    const fromClean = Math.min(cost, faction.money.clean);
    faction.money.clean -= fromClean;
    faction.money.dirty -= cost - fromClean;
    if (business.suspended) ctx.report("report.expenses.reopened", params, business.ownerFactionId);
    business.suspended = false;
  }
}

/** Only clubs pay wages; the cartel's people are paid by the cartel's own business. */
function payWages(state: GameState, ctx: TurnContext): void {
  const { wages } = ctx.data.balance;
  const clubs = new Set(ctx.data.factions.filter((f) => f.kind === "club").map((f) => f.id));
  for (const faction of Object.values(state.factions)) {
    if (!clubs.has(faction.id)) continue;
    const members = livingMembers(state, faction.id).sort((a, b) => a.id.localeCompare(b.id));
    if (members.length === 0) continue;
    let paid = 0;
    let unpaid = 0;
    for (const member of members) {
      const wage = wages[member.rank] ?? 0;
      if (faction.money.dirty + faction.money.clean < wage) {
        ctx.scratch.unpaidMemberIds.push(member.id);
        unpaid++;
        ctx.report("report.expenses.unpaid", { member: memberLabel(member), wage }, faction.id);
        continue;
      }
      const fromDirty = Math.min(wage, faction.money.dirty);
      faction.money.dirty -= fromDirty;
      faction.money.clean -= wage - fromDirty;
      paid += wage;
    }
    ctx.report("report.expenses.wages", { paid, unpaid }, faction.id);
  }
}

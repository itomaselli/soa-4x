// Weekly expenses (GDD §8). Phase 1: wages only.
// Wages are paid cash-in-hand: dirty money first, then clean. A member is paid in full or not at all.

import type { TurnContext } from "../context";
import type { GameState } from "../state";
import { livingMembers, memberLabel } from "./members";

export function payExpenses(state: GameState, ctx: TurnContext): void {
  const { wages } = ctx.data.balance;
  for (const faction of Object.values(state.factions)) {
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

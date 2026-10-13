// Loyalty, phase 1 part (GDD §6, §8): unpaid members lose loyalty.
// Victories, deaths, the council and trait effects arrive in phase 4.

import type { TurnContext } from "../context";
import type { GameState } from "../state";
import { clamp } from "../util";
import { memberLabel } from "./members";

export function resolveLoyalty(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const memberId of ctx.scratch.unpaidMemberIds) {
    const member = state.members[memberId];
    if (!member) continue;
    member.loyalty = clamp(member.loyalty - balance.loyalty.unpaidPenalty, balance.ranges.loyalty);
    ctx.report(
      "report.loyalty.unpaid",
      { member: memberLabel(member), penalty: balance.loyalty.unpaidPenalty, loyalty: member.loyalty },
      member.factionId,
    );
  }
}

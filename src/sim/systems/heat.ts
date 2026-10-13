// Heat and law, phase 1 part (GDD §10): natural weekly decay and patrol warnings.
// Raids, crackdowns, sheriff and federals arrive in phase 4.

import { zoneName, type TurnContext } from "../context";
import type { GameState } from "../state";
import { clamp } from "../util";

export function resolveHeat(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const zone of Object.values(state.zones)) {
    zone.heat = clamp(zone.heat - balance.heat.weeklyDecay, balance.ranges.heat);
    if (zone.heat >= balance.heat.patrolThreshold) {
      ctx.report("report.heat.patrols", { zone: zoneName(ctx.data, zone.id), heat: zone.heat });
    }
  }
}

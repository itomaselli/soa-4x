// Arrest risk for illegal tasks (GDD §7, §10).
// chance = base + heat·perHeat + police·perPolicePresence − cunning·perCunning (+ patrolBonus if heat ≥ patrol threshold),
// clamped to [minChance, maxChance].

import type { Balance } from "../../data/schemas";

export function arrestChance(heat: number, policePresence: number, cunning: number, balance: Balance): number {
  const a = balance.arrest;
  const patrol = heat >= balance.heat.patrolThreshold ? a.patrolBonus : 0;
  const raw = a.base + heat * a.perHeat + policePresence * a.perPolicePresence - cunning * a.perCunning + patrol;
  return Math.min(a.maxChance, Math.max(a.minChance, raw));
}

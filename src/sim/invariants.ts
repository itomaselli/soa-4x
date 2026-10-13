// Invariants that must hold for any GameState, at any week.
// Used by tests (and later by the headless simulator) to catch broken rules early.

import type { Balance } from "../data/schemas";
import { STAT_KEYS, type GameState } from "./state";

type Range = { min: number; max: number };

function checkRange(errors: string[], label: string, value: number, range: Range): void {
  if (Number.isNaN(value)) errors.push(`${label} es NaN`);
  else if (value < range.min || value > range.max) errors.push(`${label} = ${value} fuera de [${range.min}, ${range.max}]`);
}

/** Returns a list of violated invariants. Empty list = state is sane. */
export function checkInvariants(state: GameState, balance: Balance): string[] {
  const errors: string[] = [];
  const { ranges } = balance;

  if (!(state.playerFactionId in state.factions)) errors.push(`facción del jugador desconocida: ${state.playerFactionId}`);
  checkRange(errors, "investigación federal", state.federalInvestigation, ranges.federalInvestigation);

  for (const faction of Object.values(state.factions)) {
    for (const [currency, amount] of Object.entries(faction.money)) {
      if (!Number.isFinite(amount)) errors.push(`${faction.id}: plata ${currency} no es un número válido (${amount})`);
    }
    for (const [otherId, value] of Object.entries(faction.relations)) {
      if (!(otherId in state.factions)) errors.push(`${faction.id}: relación con facción desconocida ${otherId}`);
      checkRange(errors, `${faction.id} → ${otherId} relación`, value, ranges.relation);
    }
  }

  for (const zone of Object.values(state.zones)) {
    checkRange(errors, `${zone.id} calor`, zone.heat, ranges.heat);
    checkRange(errors, `${zone.id} presencia policial`, zone.policePresence, ranges.policePresence);
    for (const [factionId, value] of Object.entries(zone.control)) {
      if (!(factionId in state.factions)) errors.push(`${zone.id}: control de facción desconocida ${factionId}`);
      checkRange(errors, `${zone.id} control ${factionId}`, value, ranges.control);
    }
  }

  for (const member of Object.values(state.members)) {
    if (!(member.factionId in state.factions)) errors.push(`${member.id}: facción desconocida ${member.factionId}`);
    checkRange(errors, `${member.id} lealtad`, member.loyalty, ranges.loyalty);
    for (const key of STAT_KEYS) checkRange(errors, `${member.id} ${key}`, member.stats[key], ranges.stat);
  }

  for (const business of state.businesses) {
    if (!(business.zoneId in state.zones)) errors.push(`${business.id}: zona desconocida ${business.zoneId}`);
    if (!(business.ownerFactionId in state.factions)) errors.push(`${business.id}: dueño desconocido ${business.ownerFactionId}`);
  }

  return errors;
}

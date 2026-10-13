// What the AI brings to its council (phase 8). Same proposals and votes as the player.
// Priorities, highest first: truce when losing → war when wronged and stronger → expel the disloyal →
// fill officer posts / promote loyal prospects → cartel deal when ready for guns.
// Illegal businesses are proposed by aiManagement, which knows the build order.

import type { AiProfile, GameData } from "../../data/schemas";
import { promotionOptions, type Proposal } from "../council";
import { cartelId } from "../management";
import type { GameState } from "../state";
import { businessDef, factionBusinesses } from "./businesses";
import { ownedZones } from "./control";
import { atWar, getStance, inTruce } from "./diplomacy";
import { averageLoyalty, loyaltyMembers } from "./loyalty";
import { activeMembers, effectiveStat } from "./members";

/** Total effective Strength of a club's active members: a rough measure of who'd win a fight. */
export function clubStrength(state: GameState, data: GameData, factionId: string): number {
  return activeMembers(state, factionId).reduce((sum, m) => sum + effectiveStat(m, "strength", data.balance), 0);
}

export function aiProposals(state: GameState, data: GameData, factionId: string, p: AiProfile): Proposal[] {
  const proposals: Proposal[] = [];
  const c = p.council;
  const rivals = data.factions.filter((f) => f.kind === "club" && f.id !== factionId).map((f) => f.id);
  const myZones = ownedZones(state, factionId, data.balance).length;
  const loyalty = averageLoyalty(state, factionId) ?? 100;

  for (const rival of rivals) {
    if (atWar(state, factionId, rival)) {
      const theirZones = ownedZones(state, rival, data.balance).length;
      const wantsTruce = loyalty < c.truceLoyaltyConcern || theirZones - myZones >= c.truceWhenBehindZones;
      // Same rule the rival uses to answer (council.truceAcceptRelation): don't ask for what will be refused.
      const theirRegard = state.factions[rival]?.relations[factionId] ?? 0;
      const wouldAccept = theirRegard >= data.balance.council.truceAcceptRelation || theirZones <= myZones;
      if (wantsTruce && wouldAccept) proposals.push({ factionId, type: "truce", targetFactionId: rival });
      continue;
    }
    if (inTruce(state, factionId, rival)) continue;
    const theirRegard = state.factions[rival]?.relations[factionId] ?? 0;
    const myRegard = state.factions[factionId]?.relations[rival] ?? 0;
    const wronged = Math.min(theirRegard, myRegard) <= c.warRelationTrigger;
    if (wronged && clubStrength(state, data, factionId) >= c.warStrengthRatio * clubStrength(state, data, rival)) {
      proposals.push({ factionId, type: "declare_war", targetFactionId: rival });
    }
  }

  const disloyal = loyaltyMembers(state, factionId)
    .filter((m) => m.loyalty < c.expelLoyalty)
    .sort((a, b) => a.loyalty - b.loyalty)[0];
  if (disloyal) proposals.push({ factionId, type: "expel", targetMemberId: disloyal.id });

  // Officer posts first (most loyal Member), else a loyal prospect becomes Member.
  const candidates = loyaltyMembers(state, factionId)
    .filter((m) => m.status === "active" && m.id !== disloyal?.id)
    .sort((a, b) => b.loyalty - a.loyalty || a.id.localeCompare(b.id));
  const officer = candidates.find((m) => m.rank === "member" && promotionOptions(state, m.id).length > 0);
  const prospect = candidates.find((m) => m.rank === "prospect" && m.loyalty >= c.promoteProspectLoyalty);
  if (officer) proposals.push({ factionId, type: "promote", targetMemberId: officer.id, newRank: promotionOptions(state, officer.id)[0]! });
  else if (prospect) proposals.push({ factionId, type: "promote", targetMemberId: prospect.id, newRank: "member" });

  const cartel = cartelId(data);
  const hasWarehouse = factionBusinesses(state, factionId).some((b) => businessDef(data, b.typeId)?.storage);
  const dirty = state.factions[factionId]?.money.dirty ?? 0;
  const cartelRegard = cartel ? (state.factions[cartel]?.relations[factionId] ?? 0) : 0;
  if (
    cartel &&
    c.wantsGuns &&
    hasWarehouse &&
    dirty >= c.cartelDealDirty &&
    getStance(state, factionId, cartel) === null &&
    cartelRegard >= data.balance.cartel.dealMinRelation
  ) {
    proposals.push({ factionId, type: "cartel_deal", targetFactionId: cartel });
  }
  return proposals;
}

/** Keeps the most important proposals within the council's weekly limit (list order = priority). */
export function limitProposals(proposals: Proposal[], data: GameData): Proposal[] {
  return proposals.slice(0, data.balance.council.maxProposalsPerWeek);
}

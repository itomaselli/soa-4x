// Proposals the president brings to the council (GDD §6 "La Mesa").
// Kept apart from systems/ so orders.ts and the UI can validate proposals without the vote logic.

import { z } from "zod";
import type { GameData } from "../data/schemas";
import { buildProblem } from "./systems/businesses";
import { atWar, getStance } from "./systems/diplomacy";
import { IdSchema, ProposalTypeSchema, RankSchema, type GameState, type Rank } from "./state";

export const ProposalSchema = z.object({
  /** Club that holds the vote. */
  factionId: IdSchema,
  type: ProposalTypeSchema,
  /** promote / expel */
  targetMemberId: IdSchema.optional(),
  /** declare_war / truce */
  targetFactionId: IdSchema.optional(),
  /** promote */
  newRank: RankSchema.optional(),
  /** open_illegal_business */
  businessTypeId: IdSchema.optional(),
  zoneId: IdSchema.optional(),
  /** If the vote is lost, do it anyway and pay the loyalty cost of ignoring the council. */
  force: z.boolean().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** Officer posts: one member each (GDD §6). */
export const UNIQUE_RANKS: readonly Rank[] = ["sergeant_at_arms", "treasurer", "vice_president", "president"];

/** Ranks a member can be promoted to: prospect → member → any vacant officer post → vice president. */
export function promotionOptions(state: GameState, memberId: string): Rank[] {
  const member = state.members[memberId];
  if (!member || member.status === "dead") return [];
  if (member.rank === "prospect") return ["member"];
  const taken = new Set(
    Object.values(state.members)
      .filter((m) => m.factionId === member.factionId && m.status !== "dead")
      .map((m) => m.rank),
  );
  const officerPosts: Rank[] = member.rank === "member" ? ["sergeant_at_arms", "treasurer", "vice_president"] : ["vice_president"];
  return officerPosts.filter((r) => r !== member.rank && !taken.has(r));
}

/** Returns a strings.es.json key describing why the proposal can't be voted, or null if it can. */
export function validateProposal(state: GameState, data: GameData, p: Proposal, alreadyThisWeek: number): string | null {
  const faction = data.factions.find((f) => f.id === p.factionId);
  if (!faction || faction.kind !== "club") return "proposal_error.not_a_club";
  if (alreadyThisWeek >= data.balance.council.maxProposalsPerWeek) return "proposal_error.too_many";

  switch (p.type) {
    case "declare_war":
    case "truce": {
      const target = data.factions.find((f) => f.id === p.targetFactionId);
      if (!target || target.id === p.factionId || target.kind !== "club") return "proposal_error.bad_faction";
      const war = atWar(state, p.factionId, target.id);
      if (p.type === "declare_war" && war) return "proposal_error.already_at_war";
      if (p.type === "truce" && !war) return "proposal_error.not_at_war";
      return null;
    }
    case "promote": {
      const member = p.targetMemberId ? state.members[p.targetMemberId] : undefined;
      if (!member || member.factionId !== p.factionId || member.status === "dead") return "proposal_error.bad_member";
      if (!p.newRank || !promotionOptions(state, member.id).includes(p.newRank)) return "proposal_error.bad_rank";
      return null;
    }
    case "expel": {
      const member = p.targetMemberId ? state.members[p.targetMemberId] : undefined;
      if (!member || member.factionId !== p.factionId || member.status === "dead") return "proposal_error.bad_member";
      if (member.rank === "president") return "proposal_error.cannot_expel_president";
      return null;
    }
    case "cartel_deal": {
      const cartel = data.factions.find((f) => f.kind === "cartel");
      if (!cartel || p.targetFactionId !== cartel.id) return "proposal_error.bad_faction";
      if (getStance(state, p.factionId, cartel.id)?.type === "deal") return "proposal_error.already_dealing";
      return null;
    }
    case "open_illegal_business": {
      const def = data.businesses.find((b) => b.id === p.businessTypeId);
      if (!def || def.legal) return "proposal_error.bad_business";
      if (!p.zoneId) return "proposal_error.bad_zone";
      return buildProblem(state, data, p.factionId, def.id, p.zoneId);
    }
  }
}

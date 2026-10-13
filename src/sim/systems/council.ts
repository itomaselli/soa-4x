// The council (GDD §6): members of rank Member or above vote on the president's proposals.
// The president always votes for his own proposals; a tie goes his way.

import type { GameData } from "../../data/schemas";
import { factionName, zoneName, type TurnContext } from "../context";
import { addBusiness, buildProblem } from "./businesses";
import { validateProposal, type Proposal } from "../council";
import type { GameState, MemberState, VoteType } from "../state";
import { clamp } from "../util";
import { ownedZones } from "./control";
import { stanceKey } from "./diplomacy";
import { factionMembers, memberLabel } from "./members";

export interface VoteResult {
  passed: boolean;
  yes: MemberState[];
  no: MemberState[];
}

/** Members who sit at the table: rank Member or above, not the president, present (active or wounded). */
export function voters(state: GameState, factionId: string): MemberState[] {
  return factionMembers(state, factionId)
    .filter((m) => m.rank !== "prospect" && m.rank !== "president" && (m.status === "active" || m.status === "wounded"))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Recent results: zones gained or lost over the last `momentumWeeks` weeks, × momentumPerZone. */
export function momentum(state: GameState, factionId: string, data: GameData): number {
  const { vote } = data.balance.council;
  const history = state.factions[factionId]?.ownedHistory ?? [];
  const now = ownedZones(state, factionId, data.balance).length;
  const past = history.length >= vote.momentumWeeks ? history[history.length - vote.momentumWeeks] : history[0];
  return past === undefined ? 0 : (now - past) * vote.momentumPerZone;
}

/** Chance that a member votes with the president (GDD §6): loyalty, trait vs proposal type, recent results. */
export function chanceWithPresident(member: MemberState, type: VoteType, state: GameState, data: GameData): number {
  const { vote } = data.balance.council;
  const traitModifier = data.council.traitModifiers[type]?.[member.trait] ?? 0;
  const raw = vote.base + (member.loyalty - 50) * vote.perLoyaltyAbove50 + traitModifier + momentum(state, member.factionId, data);
  return Math.min(vote.maxChance, Math.max(vote.minChance, raw));
}

/**
 * Runs a vote. `forcedNo` is a member who always votes against (the expelled member, the impeachment's proposer
 * votes with the motion); `forcedYes` always votes with the president (the promoted member).
 */
export function holdVote(
  state: GameState,
  factionId: string,
  type: VoteType,
  ctx: TurnContext,
  forced: { withPresident?: string; againstPresident?: string } = {},
): VoteResult {
  const yes: MemberState[] = [];
  const no: MemberState[] = [];
  for (const member of voters(state, factionId)) {
    const withPresident =
      member.id === forced.withPresident
        ? true
        : member.id === forced.againstPresident
          ? false
          : ctx.rng.chance(chanceWithPresident(member, type, state, ctx.data));
    (withPresident ? yes : no).push(member);
  }
  // The president's own vote: +1 on his side, which also settles ties in his favour.
  return { passed: yes.length + 1 >= no.length, yes, no };
}

function adjustLoyalty(members: MemberState[], amount: number, ctx: TurnContext): void {
  for (const m of members) m.loyalty = clamp(m.loyalty + amount, ctx.data.balance.ranges.loyalty);
}

export function resolveCouncil(state: GameState, proposals: readonly Proposal[], ctx: TurnContext): void {
  const { data } = ctx;
  const { council, ranges, federal } = data.balance;
  const counts: Record<string, number> = {};

  for (const p of proposals) {
    const error = validateProposal(state, data, p, counts[p.factionId] ?? 0);
    const params = proposalParams(state, ctx, p);
    if (error) {
      ctx.report("report.council.rejected", { ...params, reasonKey: error }, p.factionId);
      continue;
    }
    counts[p.factionId] = (counts[p.factionId] ?? 0) + 1;

    const vote = holdVote(state, p.factionId, p.type, ctx, {
      withPresident: p.type === "promote" ? p.targetMemberId : undefined,
      againstPresident: p.type === "expel" ? p.targetMemberId : undefined,
    });
    ctx.report(
      vote.passed ? "report.council.passed" : "report.council.failed",
      {
        ...params,
        yes: vote.yes.length + 1,
        no: vote.no.length,
        yesNames: vote.yes.map((m) => m.nickname || m.name).join(", ") || "—",
        noNames: vote.no.map((m) => m.nickname || m.name).join(", ") || "—",
      },
      p.factionId,
    );

    const everyone = [...vote.yes, ...vote.no];
    if (!vote.passed) {
      if (!p.force) {
        adjustLoyalty(everyone, council.respectBonus, ctx);
        ctx.report("report.council.respected", { bonus: council.respectBonus }, p.factionId);
        continue;
      }
      adjustLoyalty(everyone, -council.ignorePenalty, ctx);
      ctx.report("report.council.ignored", { penalty: council.ignorePenalty }, p.factionId);
    }
    applyProposal(state, ctx, p, params);
  }

  function applyProposal(s: GameState, c: TurnContext, p: Proposal, params: Record<string, string | number>): void {
    switch (p.type) {
      case "declare_war": {
        const target = p.targetFactionId!;
        s.stances[stanceKey(p.factionId, target)] = { type: "war", sinceWeek: s.week };
        for (const [a, b] of [[p.factionId, target], [target, p.factionId]] as const) {
          const f = s.factions[a];
          if (f) f.relations[b] = clamp(Math.min(f.relations[b] ?? 0, council.warRelation), ranges.relation);
        }
        c.report("report.council.war_declared", params, null);
        return;
      }
      case "truce": {
        const target = p.targetFactionId!;
        const theirRelation = s.factions[target]?.relations[p.factionId] ?? 0;
        const theyAreAhead =
          ownedZones(s, target, c.data.balance).length > ownedZones(s, p.factionId, c.data.balance).length;
        if (theirRelation < council.truceAcceptRelation && theyAreAhead) {
          c.report("report.council.truce_refused", params, p.factionId);
          return;
        }
        s.stances[stanceKey(p.factionId, target)] = { type: "truce", sinceWeek: s.week };
        c.report("report.council.truce_signed", { ...params, weeks: council.truceWeeks }, null);
        return;
      }
      case "promote": {
        const member = s.members[p.targetMemberId!];
        if (!member || !p.newRank) return;
        member.rank = p.newRank;
        member.loyalty = clamp(member.loyalty + council.promotionLoyalty, ranges.loyalty);
        c.report("report.council.promoted", params, p.factionId);
        return;
      }
      case "cartel_deal": {
        const cartel = p.targetFactionId!;
        const regard = s.factions[cartel]?.relations[p.factionId] ?? 0;
        if (regard < c.data.balance.cartel.dealMinRelation) {
          c.report("report.council.deal_refused", params, p.factionId);
          return;
        }
        s.stances[stanceKey(p.factionId, cartel)] = { type: "deal", sinceWeek: s.week, lastPurchaseWeek: s.week };
        c.report("report.council.deal_signed", { ...params, price: c.data.balance.cartel.catalog[c.data.balance.tasks.gunRun.goodId] ?? 0, weeks: c.data.balance.cartel.graceWeeks }, p.factionId);
        return;
      }
      case "open_illegal_business": {
        if (!p.businessTypeId || !p.zoneId) return;
        if (buildProblem(s, c.data, p.factionId, p.businessTypeId, p.zoneId, p.lot)) return;
        addBusiness(s, c.data, p.factionId, p.businessTypeId, p.zoneId, p.lot);
        c.report("report.management.built", { businessKey: `business.${p.businessTypeId}`, zone: zoneName(c.data, p.zoneId), cost: c.data.businesses.find((b) => b.id === p.businessTypeId)?.buildCost ?? 0 }, p.factionId);
        return;
      }
      case "expel": {
        const member = s.members[p.targetMemberId!];
        if (!member) return;
        delete s.members[member.id];
        c.report("report.council.expelled", params, p.factionId);
        if (member.informant) {
          const faction = s.factions[p.factionId];
          if (faction) faction.federal = clamp(faction.federal - federal.informantExpelledDrop, ranges.federalInvestigation);
          c.report("report.council.expelled_informant", { ...params, drop: federal.informantExpelledDrop }, p.factionId);
        }
        return;
      }
    }
  }
}

function proposalParams(state: GameState, ctx: TurnContext, p: Proposal): Record<string, string | number> {
  const member = p.targetMemberId ? state.members[p.targetMemberId] : undefined;
  return {
    faction: factionName(ctx.data, p.factionId),
    proposalKey: `proposal.${p.type}`,
    target: member
      ? memberLabel(member)
      : p.targetFactionId
        ? factionName(ctx.data, p.targetFactionId)
        : p.zoneId
          ? zoneName(ctx.data, p.zoneId)
          : "",
    rankKey: p.newRank ? `rank.${p.newRank}` : "rank.member",
  };
}

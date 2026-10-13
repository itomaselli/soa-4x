// Narrative events (GDD §13). For now only the human player's club gets them.
//   - At the "events" stage, with `events.weeklyChance`, one eligible event (conditions met, out of cooldown,
//     subject available) is picked by weight and left pending.
//   - Next week, at the start of resolution, the player's choice (or the default option) is applied.

import type { EventDef, EventEffect, GameData } from "../../data/schemas";
import type { TurnContext } from "../context";
import { factionName, sheriffId } from "../context";
import type { GameState, MemberState, PendingEvent } from "../state";
import { clamp } from "../util";
import { factionMembers, livingMembers, memberLabel } from "./members";
import { jail } from "./tasks";

function subjectCandidates(state: GameState, data: GameData, factionId: string, def: EventDef): MemberState[] {
  if (def.subject === "prospect") {
    return factionMembers(state, factionId).filter((m) => m.rank === "prospect" && m.status !== "dead");
  }
  if (def.subject === "rival_member") {
    const rival = data.balance.victory.rivalToExpel;
    return livingMembers(state, rival).filter((m) => m.rank !== "president" && m.status === "active");
  }
  return [];
}

export function eventEligible(state: GameState, data: GameData, factionId: string, def: EventDef): boolean {
  const c = def.conditions;
  const last = state.eventHistory[def.id];
  if (last !== undefined && state.week - last < data.balance.events.cooldownWeeks) return false;
  if (c.minWeek !== undefined && state.week < c.minWeek) return false;
  const members = livingMembers(state, factionId);
  if (c.hasProspect && !members.some((m) => m.rank === "prospect")) return false;
  if (c.hasInformant && !members.some((m) => m.informant)) return false;
  if (c.rivalMinMembers !== undefined && livingMembers(state, data.balance.victory.rivalToExpel).length < c.rivalMinMembers) return false;
  if (def.subject !== null && subjectCandidates(state, data, factionId, def).length === 0) return false;
  return true;
}

export function triggerEvents(state: GameState, ctx: TurnContext): void {
  const { data, rng } = ctx;
  const factionId = state.playerFactionId;
  if (!rng.chance(data.balance.events.weeklyChance)) return;
  const eligible = data.events.filter((e) => eventEligible(state, data, factionId, e));
  if (eligible.length === 0) return;
  let roll = rng.next() * eligible.reduce((sum, e) => sum + e.weight, 0);
  const def = eligible.find((e) => (roll -= e.weight) < 0) ?? eligible[eligible.length - 1]!;
  const candidates = subjectCandidates(state, data, factionId, def).sort((a, b) => a.id.localeCompare(b.id));
  const subject = candidates.length > 0 ? rng.pick(candidates) : null;
  state.pendingEvents.push({ instanceId: `${def.id}@${state.week}`, eventId: def.id, factionId, subjectMemberId: subject?.id ?? null, week: state.week });
  state.eventHistory[def.id] = state.week;
  ctx.report("report.event.new", { titleKey: `event.${def.id}.title` }, factionId);
}

/** Money an option needs up front (negative money effects outside of chance branches). */
export function optionCost(def: EventDef, optionId: string): { clean: number; dirty: number } {
  const cost = { clean: 0, dirty: 0 };
  for (const fx of def.options.find((o) => o.id === optionId)?.effects ?? []) {
    if (fx.type === "money" && fx.amount < 0) cost[fx.currency] -= fx.amount;
  }
  return cost;
}

export function canAfford(state: GameState, factionId: string, def: EventDef, optionId: string): boolean {
  const money = state.factions[factionId]?.money;
  const cost = optionCost(def, optionId);
  return !!money && money.clean >= cost.clean && money.dirty >= cost.dirty;
}

export function resolveEventChoices(state: GameState, choices: readonly { instanceId: string; optionId: string }[], ctx: TurnContext): void {
  const pending = state.pendingEvents;
  state.pendingEvents = [];
  for (const event of pending) {
    const def = ctx.data.events.find((e) => e.id === event.eventId);
    if (!def) continue;
    const chosen = choices.find((c) => c.instanceId === event.instanceId)?.optionId;
    const valid = chosen !== undefined && def.options.some((o) => o.id === chosen) && canAfford(state, event.factionId, def, chosen);
    const optionId = valid ? chosen! : def.defaultOption;
    const option = def.options.find((o) => o.id === optionId);
    ctx.report(
      "report.event.choice",
      { titleKey: `event.${def.id}.title`, optionKey: `event.${def.id}.option.${optionId}`, defaultKey: valid ? "report.event.chosen" : "report.event.default" },
      event.factionId,
    );
    for (const fx of option?.effects ?? []) applyEffect(state, ctx, event, fx);
  }
}

function applyEffect(state: GameState, ctx: TurnContext, event: PendingEvent, fx: EventEffect): void {
  const { data } = ctx;
  const { ranges } = data.balance;
  const faction = state.factions[event.factionId];
  const subject = event.subjectMemberId ? state.members[event.subjectMemberId] : undefined;
  const report = (key: string, params: Record<string, string | number> = {}) => ctx.report(key, params, event.factionId);
  if (!faction) return;
  switch (fx.type) {
    case "money":
      faction.money[fx.currency] = Math.max(0, faction.money[fx.currency] + fx.amount);
      report("report.event.money", { amount: fx.amount, currencyKey: `currency.${fx.currency}` });
      return;
    case "loyalty": {
      const targets = factionMembers(state, event.factionId).filter(
        (m) =>
          m.status !== "dead" &&
          m.rank !== "president" &&
          (fx.target === "all" || (fx.target === "subject" ? m.id === subject?.id : m.id !== subject?.id)),
      );
      for (const m of targets) m.loyalty = clamp(m.loyalty + fx.amount, ranges.loyalty);
      report("report.event.loyalty", { amount: fx.amount, whoKey: `report.event.who.${fx.target}`, subject: subject ? memberLabel(subject) : "" });
      return;
    }
    case "sheriff": {
      const sheriff = sheriffId(data);
      const s = sheriff ? state.factions[sheriff] : undefined;
      if (s) s.relations[event.factionId] = clamp((s.relations[event.factionId] ?? 0) + fx.amount, ranges.relation);
      report("report.event.sheriff", { amount: fx.amount });
      return;
    }
    case "rival_relation": {
      const rival = state.factions[data.balance.victory.rivalToExpel];
      if (rival) rival.relations[event.factionId] = clamp((rival.relations[event.factionId] ?? 0) + fx.amount, ranges.relation);
      report("report.event.rival_relation", { amount: fx.amount, rival: factionName(data, data.balance.victory.rivalToExpel) });
      return;
    }
    case "heat": {
      const zone = state.zones[fx.zoneId];
      if (zone) zone.heat = clamp(zone.heat + fx.amount, ranges.heat);
      report("report.event.heat", { amount: fx.amount, zone: data.zones.find((z) => z.id === fx.zoneId)?.name ?? fx.zoneId });
      return;
    }
    case "promote_subject":
      if (subject && subject.rank === "prospect") {
        subject.rank = fx.rank;
        report("report.event.promoted", { member: memberLabel(subject) });
      }
      return;
    case "defect_subject":
      if (subject && subject.status !== "dead" && livingMembers(state, event.factionId).length < data.balance.club.memberCap) {
        subject.factionId = event.factionId;
        subject.rank = "prospect";
        subject.loyalty = data.balance.tasks.recruit.startingLoyalty;
        subject.informant = false;
        report("report.event.defected", { member: memberLabel(subject) });
      }
      return;
    case "jail_random": {
      const candidates = factionMembers(state, event.factionId).filter((m) => m.status === "active" && m.rank !== "president").sort((a, b) => a.id.localeCompare(b.id));
      if (candidates.length === 0) return;
      const m = ctx.rng.pick(candidates);
      jail(m, ctx);
      m.statusWeeks = fx.weeks;
      report("report.event.jailed", { member: memberLabel(m), weeks: fx.weeks });
      return;
    }
    case "expose_informant": {
      const informant = factionMembers(state, event.factionId).find((m) => m.informant && m.status !== "dead");
      if (!informant) {
        report("report.event.no_informant");
        return;
      }
      delete state.members[informant.id];
      faction.federal = clamp(faction.federal - data.balance.federal.informantExpelledDrop, ranges.federalInvestigation);
      report("report.event.informant_exposed", { member: memberLabel(informant), drop: data.balance.federal.informantExpelledDrop });
      return;
    }
    case "chance": {
      const success = ctx.rng.chance(fx.probability);
      report(success ? "report.event.lucky" : "report.event.unlucky");
      for (const inner of success ? fx.success : fx.failure) applyEffect(state, ctx, event, inner);
      return;
    }
  }
}

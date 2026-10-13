// Cartel Valdés (GDD §12): sells guns under a deal. "Si incumplís, castiga":
// a club that goes `graceWeeks` without buying breaks the deal, loses the cartel's goodwill
// and one of its members gets a beating.

import { factionName, type TurnContext } from "../context";
import { cartelId } from "../management";
import type { GameState, MemberState } from "../state";
import { clamp } from "../util";
import { stanceKey } from "./diplomacy";
import { memberLabel } from "./members";

export function resolveCartel(state: GameState, ctx: TurnContext): void {
  const { data } = ctx;
  const { cartel: rules, ranges, combat } = data.balance;
  const cartel = cartelId(data);
  if (!cartel) return;
  for (const def of data.factions) {
    const key = stanceKey(def.id, cartel);
    const stance = state.stances[key];
    if (def.id === cartel || stance?.type !== "deal") continue;
    const lastPurchase = stance.lastPurchaseWeek ?? stance.sinceWeek;
    if (state.week - lastPurchase < rules.graceWeeks) continue;

    delete state.stances[key];
    const cartelState = state.factions[cartel];
    if (cartelState) {
      cartelState.relations[def.id] = clamp((cartelState.relations[def.id] ?? 0) - rules.breachRelationPenalty, ranges.relation);
    }
    const victims = Object.values(state.members)
      .filter((m): m is MemberState => m.factionId === def.id && m.status === "active" && m.rank !== "president")
      .sort((a, b) => a.id.localeCompare(b.id));
    const victim = victims.length > 0 ? ctx.rng.pick(victims) : null;
    if (victim) {
      victim.status = "wounded";
      victim.statusWeeks = ctx.rng.int(combat.woundWeeksMin, combat.woundWeeksMax);
    }
    ctx.report(
      "report.cartel.breach",
      { cartel: factionName(data, cartel), weeks: rules.graceWeeks, victim: victim ? memberLabel(victim) : "—", penalty: rules.breachRelationPenalty },
      def.id,
    );
  }
}

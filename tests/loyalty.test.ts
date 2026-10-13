import { describe, expect, it } from "vitest";
import type { Assignment } from "../src/sim/orders";
import { stanceKey } from "../src/sim/systems/diplomacy";
import { averageLoyalty } from "../src/sim/systems/loyalty";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { alwaysArrestData, baseData, dataWith, member, newState, noArrestData, PLAYER, PRESIDENT, SERGEANT, VP, WOLVES, zone } from "./helpers";

const L = baseData.balance.loyalty;
const LEDGER = "member_walt_mercer"; // cautious
const turn = (state: GameState, assignments: Assignment[] = [], data = noArrestData) => resolveTurn(state, { assignments }, data);
const keys = (r: { key: string }[]) => r.map((e) => e.key);

describe("lealtad semanal (GDD §6)", () => {
  it("cobrar el sueldo sube la lealtad", () => {
    const state = newState();
    const before = member(state, VP).loyalty;
    expect(member(turn(state).state, VP).loyalty).toBe(before + L.paidBonus);
  });

  it("la lealtad del presidente no cambia (sos vos)", () => {
    const state = newState();
    expect(member(turn(state).state, PRESIDENT).loyalty).toBe(member(state, PRESIDENT).loyalty);
  });

  it("ganar una zona sube la lealtad de todos", () => {
    const state = newState();
    zone(state, "zone_dry_creek").control = { [PLAYER]: 51 };
    // Guarding Dry Creek (+3) takes it from 51 to 54... ownership needs >50 and a 20 lead: it's already ours.
    // Instead: start just below ownership and guard over the line.
    zone(state, "zone_dry_creek").control = { [PLAYER]: 49 };
    const before = member(state, VP).loyalty;
    const { state: next, report } = turn(state, [{ memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_dry_creek" }]);
    expect(keys(report)).toContain("report.loyalty.zones_gained");
    expect(member(next, VP).loyalty).toBe(before + L.paidBonus + L.zoneGainedBonus);
  });

  it("perder una zona baja la lealtad de todos", () => {
    const state = newState();
    zone(state, "zone_redwater").control = { [PLAYER]: 51, [WOLVES]: 30 };
    const { state: next, report } = resolveTurn(
      state,
      { assignments: [{ memberId: "member_wolves_rex_hollis", taskId: "task_intimidate", zoneId: "zone_redwater" }] },
      noArrestData,
    );
    expect(keys(report)).toContain("report.loyalty.zones_lost");
    expect(member(next, VP).loyalty).toBe(member(state, VP).loyalty + L.paidBonus - L.zoneLostPenalty);
  });

  it("cada hermano preso baja la lealtad de todos", () => {
    const state = newState();
    const { state: next } = turn(state, [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }], alwaysArrestData);
    expect(member(next, VP).loyalty).toBe(member(state, VP).loyalty + L.paidBonus - L.arrestPenalty);
  });

  it("una tarea que contradice el rasgo baja la lealtad; una que le gusta, la sube", () => {
    const state = newState();
    const { state: next, report } = turn(state, [
      { memberId: LEDGER, taskId: "task_intimidate", zoneId: "zone_crossing" }, // cautious: dislikes
      { memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_route9_north" }, // violent: likes
    ]);
    expect(keys(report)).toContain("report.loyalty.trait_dislike");
    expect(member(next, LEDGER).loyalty).toBe(member(state, LEDGER).loyalty + L.paidBonus - L.traitDislikePenalty);
    expect(member(next, SERGEANT).loyalty).toBe(member(state, SERGEANT).loyalty + L.paidBonus + L.traitLikeBonus);
  });

  it("una guerra larga (8 semanas o más) desgasta a todos", () => {
    const state = newState();
    state.week = 20;
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "war", sinceWeek: 10 };
    const { state: next, report } = turn(state);
    expect(keys(report)).toContain("report.loyalty.long_war");
    expect(member(next, VP).loyalty).toBe(member(state, VP).loyalty + L.paidBonus - L.warWeeklyPenalty);
  });
});

describe("lealtad baja: deserciones e informantes (GDD §6, §10)", () => {
  it("un miembro con lealtad menor a 20 puede desertar", () => {
    const state = newState();
    member(state, VP).loyalty = 5;
    const sureDesert = dataWith((d) => {
      d.balance.loyalty.desertChance = 1;
    });
    const { state: next, report } = turn(state, [], sureDesert);
    expect(next.members[VP]).toBeUndefined();
    expect(keys(report)).toContain("report.loyalty.deserted");
  });

  it("o volverse informante en secreto, sin que el informe lo diga", () => {
    const state = newState();
    member(state, VP).loyalty = 5;
    const sureInformant = dataWith((d) => {
      d.balance.loyalty.desertChance = 0;
      d.balance.loyalty.informantChance = 1;
      d.balance.loyalty.informantHintChance = 0;
    });
    const { state: next, report } = turn(state, [], sureInformant);
    expect(member(next, VP).informant).toBe(true);
    expect(JSON.stringify(report)).not.toContain("informant\"");
    expect(keys(report)).not.toContain("report.loyalty.informant_rumor");
  });

  it("cada informante sube la investigación federal todas las semanas", () => {
    const state = newState();
    member(state, VP).informant = true;
    // One illegal task so the "quiet week" drop doesn't apply.
    const next = turn(state, [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }]).state;
    expect(next.factions[PLAYER]?.federal).toBe(baseData.balance.federal.perInformant);
  });

  it("los que tienen lealtad 20 o más no desertan", () => {
    const state = newState();
    const sureDesert = dataWith((d) => {
      d.balance.loyalty.desertChance = 1;
    });
    const next = turn(state, [], sureDesert).state;
    expect(Object.keys(next.members)).toHaveLength(Object.keys(state.members).length);
  });
});

describe("moción de destitución (GDD §6)", () => {
  function unhappyClub(): GameState {
    const state = newState();
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER && m.rank !== "president") m.loyalty = 25;
    return state;
  }
  const noDeserters = (voteChance: number) =>
    dataWith((d) => {
      d.balance.loyalty.desertChance = 0;
      d.balance.loyalty.informantChance = 0;
      d.balance.council.vote.minChance = voteChance;
      d.balance.council.vote.maxChance = voteChance;
    });

  it("con lealtad promedio menor a 35 durante 3 semanas, la mesa vota y si pasa, perdés", () => {
    let state = unhappyClub();
    const data = noDeserters(0);
    state = turn(state, [], data).state;
    state = turn(state, [], data).state;
    expect(state.outcome).toBeNull();
    const { state: last, report } = turn(state, [], data);
    expect(keys(report)).toContain("report.loyalty.impeachment_passed");
    expect(last.outcome).toMatchObject({ result: "defeat", reasonKey: "outcome.defeat.impeached" });
  });

  it("si la mesa te sostiene, la cuenta vuelve a empezar", () => {
    let state = unhappyClub();
    const data = noDeserters(1);
    for (let i = 0; i < 3; i++) state = turn(state, [], data).state;
    expect(state.outcome).toBeNull();
    expect(state.factions[PLAYER]?.lowLoyaltyWeeks).toBe(0);
  });

  it("el informe avisa del malestar antes de la moción", () => {
    const { report } = turn(unhappyClub(), [], noDeserters(1));
    expect(keys(report)).toContain("report.loyalty.unrest");
  });

  it("la lealtad promedio no cuenta al presidente", () => {
    const state = newState();
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER) m.loyalty = m.rank === "president" ? 100 : 30;
    expect(averageLoyalty(state, PLAYER)).toBe(30);
  });
});

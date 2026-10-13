import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import type { Proposal } from "../src/sim/council";
import { promotionOptions } from "../src/sim/council";
import { stanceKey } from "../src/sim/systems/diplomacy";
import { voters } from "../src/sim/systems/council";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, newState, PLAYER, PRESIDENT, PROSPECT, SERGEANT, VP, WOLVES, zone } from "./helpers";

const LEDGER = "member_walt_mercer";

/** Everyone at the table votes with the president / against him. */
const allYes = dataWith((d) => {
  d.balance.council.vote.minChance = 1;
  d.balance.council.vote.maxChance = 1;
});
const allNo = dataWith((d) => {
  d.balance.council.vote.minChance = 0;
  d.balance.council.vote.maxChance = 0;
});

function vote(state: GameState, proposals: Omit<Proposal, "factionId">[], data: GameData = allYes) {
  return resolveTurn(state, { assignments: [], proposals: proposals.map((p) => ({ factionId: PLAYER, ...p })) }, data);
}
const keys = (r: { key: string }[]) => r.map((e) => e.key);

describe("la mesa (GDD §6)", () => {
  it("votan los miembros con rango Miembro o superior que están presentes; no los prospectos ni el presidente", () => {
    const state = newState();
    member(state, SERGEANT).status = "jailed";
    const ids = voters(state, PLAYER).map((m) => m.id);
    expect(ids).not.toContain(PRESIDENT);
    expect(ids).not.toContain(PROSPECT);
    expect(ids).not.toContain(SERGEANT);
    expect(ids).toContain(VP);
  });

  it("con mayoría a favor, la propuesta pasa", () => {
    const { report } = vote(newState(), [{ type: "declare_war", targetFactionId: WOLVES }]);
    expect(keys(report)).toContain("report.council.passed");
  });

  it("con mayoría en contra, la propuesta no pasa", () => {
    const { state, report } = vote(newState(), [{ type: "declare_war", targetFactionId: WOLVES }], allNo);
    expect(keys(report)).toContain("report.council.failed");
    expect(state.stances).toEqual({});
  });

  it("si empata, desempata el presidente", () => {
    const state = newState();
    // Leave a single voter, who votes against: 1 (president) vs 1 → passes.
    for (const id of [SERGEANT, LEDGER, "member_bo_tanner", "member_luis_ortega"]) member(state, id).status = "jailed";
    const { report } = vote(state, [{ type: "declare_war", targetFactionId: WOLVES }], allNo);
    expect(keys(report)).toContain("report.council.passed");
  });

  it("respetar un voto perdido sube la lealtad de la mesa", () => {
    const state = newState();
    const before = member(state, VP).loyalty;
    const { state: next } = vote(state, [{ type: "declare_war", targetFactionId: WOLVES }], allNo);
    const l = baseData.balance.loyalty;
    expect(member(next, VP).loyalty).toBe(before + baseData.balance.council.respectBonus + l.paidBonus);
  });

  it("forzar un voto perdido lo ejecuta igual, pero la lealtad de la mesa cae", () => {
    const state = newState();
    const before = member(state, VP).loyalty;
    const { state: next, report } = vote(state, [{ type: "declare_war", targetFactionId: WOLVES, force: true }], allNo);
    expect(keys(report)).toContain("report.council.ignored");
    expect(next.stances[stanceKey(PLAYER, WOLVES)]?.type).toBe("war");
    expect(member(next, VP).loyalty).toBe(before - baseData.balance.council.ignorePenalty + baseData.balance.loyalty.paidBonus);
  });

  it("no se tratan más de 2 propuestas por semana", () => {
    const { report } = vote(newState(), [
      { type: "promote", targetMemberId: PROSPECT, newRank: "member" },
      { type: "promote", targetMemberId: "member_eli_vance", newRank: "member" },
      { type: "expel", targetMemberId: "member_bo_tanner" },
    ]);
    expect(report.find((e) => e.key === "report.council.rejected")?.params.reasonKey).toBe("proposal_error.too_many");
  });

  it("los rasgos inclinan el voto: un Violento apoya la guerra más que un Cauto", () => {
    const warVotes = (trait: "violent" | "cautious") => {
      let yes = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const state = newState(seed);
        for (const m of voters(state, PLAYER)) m.trait = trait;
        const { report } = vote(state, [{ type: "declare_war", targetFactionId: WOLVES }], baseData);
        yes += Number(report.find((e) => e.key.startsWith("report.council.passed") || e.key.startsWith("report.council.failed"))?.params.yes ?? 0);
      }
      return yes;
    };
    expect(warVotes("violent")).toBeGreaterThan(warVotes("cautious"));
  });
});

describe("guerra y tregua (GDD §12)", () => {
  it("declarar la guerra baja la relación de los dos lados a −60 y se anuncia a todos", () => {
    const { state, report } = vote(newState(), [{ type: "declare_war", targetFactionId: WOLVES }]);
    expect(state.factions[PLAYER]?.relations[WOLVES]).toBe(-60);
    expect(state.factions[WOLVES]?.relations[PLAYER]).toBe(-60);
    expect(report.find((e) => e.key === "report.council.war_declared")?.factionId).toBeNull();
  });

  it("en guerra, intimidar al enemigo mueve 2 puntos más de control", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "war", sinceWeek: 1 };
    const next = resolveTurn(
      state,
      { assignments: [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }] },
      dataWith((d) => {
        d.balance.arrest.minChance = 0;
        d.balance.arrest.maxChance = 0;
      }),
    ).state;
    // Sergeant strength 8 → 6, +2 at war = 8; wolves had 10.
    expect(zone(next, "zone_crossing").control[WOLVES]).toBe(2);
  });

  it("solo se propone tregua a quien está en guerra con nosotros", () => {
    const { report } = vote(newState(), [{ type: "truce", targetFactionId: WOLVES }]);
    expect(report.find((e) => e.key === "report.council.rejected")?.params.reasonKey).toBe("proposal_error.not_at_war");
  });

  it("el rival rechaza la tregua si va ganando y nos odia", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "war", sinceWeek: 1 };
    state.factions[WOLVES]!.relations[PLAYER] = -80;
    zone(state, "zone_copper_ridge").control = { [WOLVES]: 90 }; // wolves own 2 zones vs our 1
    const { state: next, report } = vote(state, [{ type: "truce", targetFactionId: WOLVES }]);
    expect(keys(report)).toContain("report.council.truce_refused");
    expect(next.stances[stanceKey(PLAYER, WOLVES)]?.type).toBe("war");
  });

  it("con tregua, nadie puede quitarle control al otro intimidando", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "truce", sinceWeek: 1 };
    const next = resolveTurn(state, { assignments: [{ memberId: SERGEANT, taskId: "task_intimidate", zoneId: "zone_crossing" }] }, allYes).state;
    expect(zone(next, "zone_crossing").control[WOLVES]).toBe(10);
  });

  it("la tregua dura 8 semanas", () => {
    let state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "truce", sinceWeek: 1 };
    for (let i = 0; i < 7; i++) state = resolveTurn(state, { assignments: [] }, baseData).state;
    expect(state.stances[stanceKey(PLAYER, WOLVES)]).toBeDefined();
    state = resolveTurn(state, { assignments: [] }, baseData).state;
    expect(state.stances[stanceKey(PLAYER, WOLVES)]).toBeUndefined();
  });
});

describe("ascensos y expulsiones (GDD §6)", () => {
  it("un prospecto solo puede ascender a Miembro; un Miembro, a los cargos vacantes", () => {
    const state = newState();
    expect(promotionOptions(state, PROSPECT)).toEqual(["member"]);
    expect(promotionOptions(state, "member_bo_tanner")).toEqual([]); // sergeant, treasurer and VP are all taken
    member(state, VP).status = "dead";
    expect(promotionOptions(state, "member_bo_tanner")).toEqual(["vice_president"]);
  });

  it("ascender cambia el rango y suma lealtad al ascendido", () => {
    const state = newState();
    const before = member(state, PROSPECT).loyalty;
    const { state: next } = vote(state, [{ type: "promote", targetMemberId: PROSPECT, newRank: "member" }]);
    expect(member(next, PROSPECT).rank).toBe("member");
    expect(member(next, PROSPECT).loyalty).toBe(before + baseData.balance.council.promotionLoyalty + baseData.balance.loyalty.paidBonus);
  });

  it("no se puede ascender a un cargo ocupado", () => {
    const { report } = vote(newState(), [{ type: "promote", targetMemberId: "member_bo_tanner", newRank: "sergeant_at_arms" }]);
    expect(report.find((e) => e.key === "report.council.rejected")?.params.reasonKey).toBe("proposal_error.bad_rank");
  });

  it("expulsar saca al miembro del club y su tarea de esa semana se cancela", () => {
    const state = newState();
    const { state: next, report } = resolveTurn(
      state,
      {
        assignments: [{ memberId: "member_bo_tanner", taskId: "task_guard_zone", zoneId: "zone_redwater" }],
        proposals: [{ factionId: PLAYER, type: "expel", targetMemberId: "member_bo_tanner" }],
      },
      allYes,
    );
    expect(next.members["member_bo_tanner"]).toBeUndefined();
    expect(keys(report)).not.toContain("report.task.guard");
  });

  it("expulsar a un informante baja la investigación federal y lo revela", () => {
    const state = newState();
    member(state, "member_bo_tanner").informant = true;
    state.factions[PLAYER]!.federal = 40;
    const { state: next, report } = vote(state, [{ type: "expel", targetMemberId: "member_bo_tanner" }]);
    expect(keys(report)).toContain("report.council.expelled_informant");
    expect(next.factions[PLAYER]?.federal).toBeLessThanOrEqual(40 - baseData.balance.federal.informantExpelledDrop);
  });

  it("no se puede expulsar al presidente", () => {
    const { report } = vote(newState(), [{ type: "expel", targetMemberId: PRESIDENT }]);
    expect(report.find((e) => e.key === "report.council.rejected")?.params.reasonKey).toBe("proposal_error.cannot_expel_president");
  });
});

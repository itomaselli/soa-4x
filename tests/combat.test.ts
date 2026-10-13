import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import type { Assignment } from "../src/sim/orders";
import { addBusiness } from "../src/sim/systems/businesses";
import { stanceKey } from "../src/sim/systems/diplomacy";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, newState, PLAYER, SERGEANT, VP, WOLVES, zone } from "./helpers";

const WOLF_A = "member_wolves_rex_hollis"; // strength 8
const WOLF_B = "member_wolves_jed_sutter"; // strength 8

const calm = (patch: (d: GameData) => void = () => {}) =>
  dataWith((d) => {
    d.balance.arrest.minChance = 0;
    d.balance.arrest.maxChance = 0;
    d.balance.events.weeklyChance = 0;
    d.balance.combat.randomMax = 0;
    d.balance.combat.loserDeathChance = 0;
    d.balance.combat.loserJailChance = 0;
    d.balance.combat.loserWoundChance = 0;
    d.balance.combat.winnerWoundChance = 0;
    patch(d);
  });

/** A Saints bar in Ruta 9 Sur (not HQ), which the Wolves can reach via El Cruce. */
function saintsBar(): GameState {
  const state = newState();
  state.factions[PLAYER]!.federal = 20; // away from 0 so weekly changes aren't clamped
  zone(state, "zone_route9_south").control = { [PLAYER]: 60, [WOLVES]: 10 };
  state.week = 0;
  addBusiness(state, baseData, PLAYER, "business_club_bar", "zone_route9_south");
  state.week = 1;
  return state;
}
const attack = (ids: string[], zoneId = "zone_route9_south"): Assignment[] => ids.map((memberId) => ({ memberId, taskId: "task_attack_business", zoneId }));
const keys = (r: { key: string }[]) => r.map((e) => e.key);

describe("combate (GDD §11)", () => {
  it("un ataque más fuerte que la defensa destruye el negocio y se queda con control", () => {
    const state = saintsBar();
    const { state: next, report } = resolveTurn(state, { assignments: attack([WOLF_A]) }, calm());
    expect(keys(report)).toContain("report.combat.attacker_won");
    expect(next.businesses).toHaveLength(0);
    expect(zone(next, "zone_route9_south").control[WOLVES]).toBe(10 + baseData.balance.combat.controlSwing);
  });

  it("los que custodian la zona defienden: si suman más, el negocio se salva", () => {
    const state = saintsBar();
    const { state: next, report } = resolveTurn(
      state,
      { assignments: [...attack([WOLF_A]), { memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_route9_south" }, { memberId: VP, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      calm(),
    );
    expect(keys(report)).toContain("report.combat.defender_won");
    expect(next.businesses).toHaveLength(1);
  });

  it("varios atacantes en la misma zona pelean juntos", () => {
    const state = saintsBar();
    const { report } = resolveTurn(
      state,
      { assignments: [...attack([WOLF_A, WOLF_B]), { memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_route9_south" }, { memberId: VP, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      calm(),
    );
    // 8 + 8 = 16 against 8 + 7 = 15
    expect(keys(report)).toContain("report.combat.attacker_won");
    expect(report.filter((e) => e.key.startsWith("report.combat."))).toHaveLength(1);
  });

  it("defender la sede da un bonus", () => {
    const state = newState();
    state.week = 0;
    addBusiness(state, baseData, PLAYER, "business_club_bar", "zone_redwater");
    state.week = 1;
    zone(state, "zone_redwater").control = { [PLAYER]: 70, [WOLVES]: 5 };
    // Wolves can reach Redwater only if they have control there or next door: they do (5).
    const weak = calm((d) => {
      d.balance.combat.hqDefenseBonus = 20;
    });
    const { report } = resolveTurn(state, { assignments: attack([WOLF_A], "zone_redwater") }, weak);
    expect(keys(report)).toContain("report.combat.defender_won");
  });

  it("no se atacan negocios de un club con el que hay tregua", () => {
    const state = saintsBar();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "truce", sinceWeek: 1 };
    const { state: next, report } = resolveTurn(state, { assignments: attack([WOLF_A]) }, calm());
    expect(keys(report)).toContain("report.combat.no_target");
    expect(next.businesses).toHaveLength(1);
  });

  it("los perdedores pueden morir; eso baja la lealtad de su club y sube la investigación federal", () => {
    const state = saintsBar();
    const deadly = calm((d) => {
      d.balance.combat.loserDeathChance = 1;
    });
    const { state: next, report } = resolveTurn(
      state,
      { assignments: [...attack([WOLF_A, WOLF_B]), { memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      deadly,
    );
    expect(member(next, SERGEANT).status).toBe("dead");
    expect(keys(report)).toContain("report.loyalty.deaths");
    const withoutDeaths = resolveTurn(
      saintsBar(),
      { assignments: [...attack([WOLF_A, WOLF_B]), { memberId: SERGEANT, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      calm(),
    ).state;
    expect((next.factions[PLAYER]?.federal ?? 0) - (withoutDeaths.factions[PLAYER]?.federal ?? 0)).toBe(baseData.balance.federal.perDeath);
  });

  it("el combate suma calor fuerte en la zona", () => {
    const state = saintsBar();
    const next = resolveTurn(state, { assignments: attack([WOLF_A]) }, calm()).state;
    const expected = 15 + baseData.balance.combat.extraHeat - baseData.balance.heat.weeklyDecay;
    expect(zone(next, "zone_route9_south").heat).toBe(expected);
  });
});

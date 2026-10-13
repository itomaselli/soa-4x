import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import { cartelPrice, validateManagement } from "../src/sim/management";
import { createRng } from "../src/sim/rng";
import { loadSave, migrateV3toV4, serializeState } from "../src/sim/save";
import type { GameState, MemberState } from "../src/sim/state";
import { addBusiness } from "../src/sim/systems/businesses";
import { aiOrders } from "../src/sim/systems/ai";
import { stanceKey } from "../src/sim/systems/diplomacy";
import { bestPerk, canEarnPerk, levelFor, maxPerks, nextLevelXp, rollPerkOptions } from "../src/sim/systems/perks";
import { gunRunCrates, intimidateAmount, memberArrestChance, protectionIncome, workExtra } from "../src/sim/systems/tasks";
import { resolveTurn } from "../src/sim/turn";
import { taskForecast } from "../src/ui/forecast";
import { memberSheet } from "../src/ui/viewModel";
import { baseData, benchAllExcept, dataWith, member, newState, PLAYER, PRESIDENT, PROSPECT, SERGEANT, VP, WOLVES, zone } from "./helpers";

const CARTEL = "faction_cartel_valdes";
const WOLF = "member_wolves_rex_hollis";
const levels = baseData.perks.xp.levels;

const calm = (patch: (d: GameData) => void = () => {}) =>
  dataWith((d) => {
    d.balance.arrest.minChance = 0;
    d.balance.arrest.maxChance = 0;
    d.balance.events.weeklyChance = 0;
    d.balance.heat.weeklyDecay = 0;
    d.balance.control.erosionPerWeek = 0;
    patch(d);
  });

function withPerk(state: GameState, id: string, perk: string): MemberState {
  const m = member(state, id);
  m.perks = [...m.perks, perk];
  return m;
}

describe("experiencia y niveles (Fase 13)", () => {
  it("cada tarea realizada da experiencia; descansar no", () => {
    const state = newState();
    benchAllExcept(state, [PRESIDENT, VP]);
    const next = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_guard_zone", zoneId: "zone_redwater" }] }, calm()).state;
    expect(next.members[PRESIDENT]!.xp).toBe(baseData.perks.xp.perTask);
    expect(next.members[VP]!.xp).toBe(0);
  });

  it("los niveles salen de los umbrales de perks.json", () => {
    expect(levelFor(baseData, 0)).toBe(0);
    expect(levelFor(baseData, levels[0]!)).toBe(1);
    expect(levelFor(baseData, levels[1]! - 1)).toBe(1);
    expect(nextLevelXp(baseData, 0)).toBe(levels[0]);
    expect(nextLevelXp(baseData, levels[levels.length - 1]!)).toBeNull();
  });

  it("al subir de nivel le ofrecen especialidades distintas que todavía no tiene", () => {
    const state = newState();
    benchAllExcept(state, [PRESIDENT]);
    member(state, PRESIDENT).xp = levels[0]! - 1;
    member(state, PRESIDENT).perks = ["perk_ghost"];
    member(state, PRESIDENT).xp = levels[1]! - 1;
    const { state: next, report } = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_guard_zone", zoneId: "zone_redwater" }] }, calm());
    const options = next.members[PRESIDENT]!.perkOptions;
    expect(options).toHaveLength(baseData.perks.choices);
    expect(new Set(options).size).toBe(options.length);
    expect(options).not.toContain("perk_ghost");
    expect(report.map((r) => r.key)).toContain("report.perk.level_up");
    expect(report.map((r) => r.key)).toContain("report.perk.options");
  });

  it("elegir una especialidad es una orden: se aplica al resolver y se cierra la oferta", () => {
    const state = newState();
    const m = member(state, PRESIDENT);
    m.xp = levels[0]!;
    m.perkOptions = ["perk_ghost", "perk_negotiator"];
    const next = resolveTurn(state, { assignments: [], perkChoices: [{ memberId: PRESIDENT, perkId: "perk_negotiator" }] }, calm()).state;
    expect(next.members[PRESIDENT]!.perks).toEqual(["perk_negotiator"]);
    expect(next.members[PRESIDENT]!.perkOptions).toEqual([]);
  });

  it("una elección que no estaba en la oferta se rechaza y se explica", () => {
    const state = newState();
    member(state, PRESIDENT).perkOptions = ["perk_ghost", "perk_negotiator"];
    const { state: next, report } = resolveTurn(state, { assignments: [], perkChoices: [{ memberId: PRESIDENT, perkId: "perk_veteran" }] }, calm());
    expect(next.members[PRESIDENT]!.perks).toEqual([]);
    expect(report.map((r) => r.key)).toContain("report.perk.rejected");
  });

  it("el rango limita cuántas especialidades tiene: un prospecto con su cupo lleno no recibe ofertas", () => {
    const state = newState();
    const p = member(state, PROSPECT);
    expect(maxPerks(baseData, p)).toBe(baseData.perks.maxPerksByRank.prospect);
    p.xp = levels[2]!;
    p.perks = ["perk_ghost"];
    expect(canEarnPerk(baseData, p)).toBe(false);
    expect(memberSheet(state, baseData, PROSPECT, null)?.rankFull).toBe(true);
    p.rank = "member";
    expect(canEarnPerk(baseData, p)).toBe(true);
  });

  it("las opciones se sortean con el mismo azar: misma semilla, mismas opciones", () => {
    const m = member(newState(), SERGEANT);
    expect(rollPerkOptions(baseData, m, createRng(5))).toEqual(rollPerkOptions(baseData, m, createRng(5)));
  });

  it("la IA elige la especialidad que mejor le queda (su stat más alta, su rasgo)", () => {
    const sergeant = member(newState(), SERGEANT); // strength 8, violent
    expect(bestPerk(baseData, sergeant, ["perk_mechanic", "perk_enforcer"])).toBe("perk_enforcer");
    const state = newState();
    member(state, WOLF).perkOptions = ["perk_mechanic", "perk_veteran"];
    const orders = aiOrders(state, baseData, WOLVES);
    expect(orders.perkChoices).toContainEqual({ memberId: WOLF, perkId: bestPerk(baseData, member(state, WOLF), ["perk_mechanic", "perk_veteran"]) });
  });
});

describe("efectos de las especialidades", () => {
  it("Fantasma: la mitad de probabilidad de caer preso", () => {
    const state = newState();
    const z = zone(state, "zone_redwater");
    z.heat = 40;
    const before = memberArrestChance(z, member(state, PRESIDENT), baseData);
    withPerk(state, PRESIDENT, "perk_ghost");
    expect(memberArrestChance(z, member(state, PRESIDENT), baseData)).toBeCloseTo(before * 0.5);
  });

  it("Matón: contra un club en guerra intimida el doble; contra los demás, igual", () => {
    const state = newState();
    const m = member(state, SERGEANT);
    const war = intimidateAmount(m, baseData, true);
    const peace = intimidateAmount(m, baseData, false);
    withPerk(state, SERGEANT, "perk_enforcer");
    expect(intimidateAmount(m, baseData, true)).toBe(war * 2);
    expect(intimidateAmount(m, baseData, false)).toBe(peace);
  });

  it("Mecánico y Cultivador suman una unidad al trabajar en su negocio", () => {
    const state = newState();
    const m = member(state, VP);
    const base = workExtra(m, 4, "task_work_garage", baseData);
    withPerk(state, VP, "perk_mechanic");
    expect(workExtra(m, 4, "task_work_garage", baseData)).toBe(base + 1);
    expect(workExtra(m, 4, "task_cultivate", baseData)).toBe(workExtra({ ...m, perks: [] }, 4, "task_cultivate", baseData));
  });

  it("Cultivador: cultivar no levanta calor", () => {
    const state = newState();
    benchAllExcept(state, [VP]);
    zone(state, "zone_cedar_flats").control = { [PLAYER]: 90 };
    addBusiness(state, baseData, PLAYER, "business_plantation", "zone_cedar_flats");
    withPerk(state, VP, "perk_grower");
    const heatBefore = zone(state, "zone_cedar_flats").heat;
    const next = resolveTurn(state, { assignments: [{ memberId: VP, taskId: "task_cultivate", zoneId: "zone_cedar_flats" }] }, calm()).state;
    expect(next.zones.zone_cedar_flats!.heat).toBe(heatBefore);
  });

  it("Contrabandista: mueve una caja más en las corridas y, libre, salva las compras de la incautación", () => {
    const state = newState();
    const m = member(state, PRESIDENT);
    const crates = gunRunCrates(m, baseData);
    withPerk(state, PRESIDENT, "perk_smuggler");
    expect(gunRunCrates(m, baseData)).toBe(crates + 1);
    const alwaysSeize = calm((d) => {
      d.balance.cartel.interceptPerHeat = 1;
    });
    zone(state, "zone_port_calloway").heat = 100;
    state.shipments.push({ factionId: PLAYER, goodId: "good_gun_crate", quantity: 2 });
    const next = resolveTurn(state, { assignments: [] }, alwaysSeize).state;
    expect(next.factions[PLAYER]!.stock.good_gun_crate).toBe(2);
    // Without the smuggler the same shipment is seized.
    const plain = newState();
    zone(plain, "zone_port_calloway").heat = 100;
    plain.shipments.push({ factionId: PLAYER, goodId: "good_gun_crate", quantity: 2 });
    expect(resolveTurn(plain, { assignments: [] }, alwaysSeize).state.factions[PLAYER]!.stock.good_gun_crate ?? 0).toBe(0);
  });

  it("Negociador: mientras esté libre, el cartel cobra 10% menos (también al validar y en la revisión)", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, CARTEL)] = { type: "deal", sinceWeek: 1 };
    const base = baseData.balance.cartel.catalog.good_coke_brick!;
    withPerk(state, PRESIDENT, "perk_negotiator");
    expect(cartelPrice(state, baseData, PLAYER, "good_coke_brick")).toBe(Math.round(base * 0.9));
    zone(state, "zone_redwater").control = { [PLAYER]: 90 };
    addBusiness(state, baseData, PLAYER, "business_cut_house", "zone_redwater");
    state.factions[PLAYER]!.money.dirty = Math.round(base * 0.9);
    expect(validateManagement(state, baseData, { kind: "buy", factionId: PLAYER, goodId: "good_coke_brick", quantity: 1 })).toBeNull();
    member(state, PRESIDENT).status = "jailed";
    expect(cartelPrice(state, baseData, PLAYER, "good_coke_brick")).toBe(base);
  });

  it("Veterano: perder un combate lo deja herido, nunca muerto", () => {
    const deadly = calm((d) => {
      d.balance.combat.loserDeathChance = 1;
      d.balance.combat.randomMax = 0;
    });
    const state = newState();
    benchAllExcept(state, [PROSPECT]);
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.id !== WOLF) m.status = "wounded";
    zone(state, "zone_route9_south").control = { [WOLVES]: 60, [PLAYER]: 20 };
    state.week = 0;
    addBusiness(state, baseData, WOLVES, "business_club_bar", "zone_route9_south");
    state.week = 1;
    withPerk(state, PROSPECT, "perk_veteran");
    const next = resolveTurn(
      state,
      { assignments: [{ memberId: PROSPECT, taskId: "task_attack_business", zoneId: "zone_route9_south" }, { memberId: WOLF, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      deadly,
    ).state;
    expect(next.members[PROSPECT]!.status).toBe("wounded");
  });

  it("Reclutador: sus reclutas arrancan con +1 en cada stat", () => {
    const sure = calm((d) => {
      d.balance.tasks.recruit.baseChance = 1;
      d.balance.tasks.recruit.statMin = 3;
      d.balance.tasks.recruit.statMax = 3;
    });
    const state = newState();
    benchAllExcept(state, [PRESIDENT]);
    withPerk(state, PRESIDENT, "perk_recruiter");
    const next = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_recruit", zoneId: "zone_redwater" }] }, sure).state;
    const recruit = Object.values(next.members).find((m) => m.id.startsWith("member_recruit"))!;
    expect(recruit.stats).toEqual({ strength: 4, cunning: 4, hands: 4, charm: 4 });
    expect(recruit).toMatchObject({ xp: 0, perks: [], scars: [], perkOptions: [] });
  });

  it("una herida de combate puede dejar una secuela: −1 permanente en una stat", () => {
    const scarAlways = calm((d) => {
      d.perks.scars.chanceOnCombatWound = 1;
      d.balance.combat.loserDeathChance = 0;
      d.balance.combat.loserJailChance = 0;
      d.balance.combat.loserWoundChance = 1;
      d.balance.combat.randomMax = 0;
    });
    const state = newState();
    benchAllExcept(state, [PROSPECT]);
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.id !== WOLF) m.status = "wounded";
    zone(state, "zone_route9_south").control = { [WOLVES]: 60, [PLAYER]: 20 };
    state.week = 0;
    addBusiness(state, baseData, WOLVES, "business_club_bar", "zone_route9_south");
    state.week = 1;
    const before = { ...member(state, PROSPECT).stats };
    const next = resolveTurn(
      state,
      { assignments: [{ memberId: PROSPECT, taskId: "task_attack_business", zoneId: "zone_route9_south" }, { memberId: WOLF, taskId: "task_guard_zone", zoneId: "zone_route9_south" }] },
      scarAlways,
    ).state;
    const after = next.members[PROSPECT]!;
    expect(after.scars).toHaveLength(1);
    const stat = baseData.perks.scars.list.find((s) => s.id === after.scars[0])!.stat;
    expect(after.stats[stat]).toBe(Math.max(baseData.balance.ranges.stat.min, before[stat] - baseData.perks.scars.penalty));
  });
});

describe("previsión de tareas y partidas guardadas", () => {
  it("la previsión de cobrar protección es la que después cobra el motor", () => {
    const state = newState();
    benchAllExcept(state, [PRESIDENT]);
    const z = zone(state, "zone_redwater");
    const expected = protectionIncome(member(state, PRESIDENT), baseData.zones.find((x) => x.id === "zone_redwater")!.wealth, z.control[PLAYER] ?? 0, baseData.balance);
    const lines = taskForecast(state, baseData, PRESIDENT, "task_collect_protection", "zone_redwater");
    expect(lines[0]).toEqual({ key: "forecast.protection", params: { income: expected } });
    expect(lines.some((l) => l.key === "forecast.arrest")).toBe(true);
    const { report } = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }] }, calm());
    expect(report.find((r) => r.key === "report.task.protection")?.params.income).toBe(expected);
  });

  it("la previsión incluye la especialidad: un Fantasma ve la mitad de riesgo", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 40;
    const plain = taskForecast(state, baseData, PRESIDENT, "task_intimidate", "zone_redwater").find((l) => l.key === "forecast.arrest")!.params!.chance as number;
    withPerk(state, PRESIDENT, "perk_ghost");
    const ghost = taskForecast(state, baseData, PRESIDENT, "task_intimidate", "zone_redwater").find((l) => l.key === "forecast.arrest")!.params!.chance as number;
    expect(ghost).toBe(Math.round(plain / 2));
  });

  it("las partidas del formato 3 migran con experiencia, especialidades y secuelas vacías", () => {
    const state = newState();
    const raw = JSON.parse(serializeState(state)) as Record<string, unknown> & { members: Record<string, Record<string, unknown>> };
    for (const m of Object.values(raw.members)) {
      delete m.xp;
      delete m.perks;
      delete m.scars;
      delete m.perkOptions;
    }
    raw.schemaVersion = 3;
    const migrated = migrateV3toV4(raw) as typeof raw;
    expect(Object.values(migrated.members).every((m) => m.xp === 0 && Array.isArray(m.perks))).toBe(true);
    expect(loadSave(JSON.stringify(raw), baseData)).toEqual(state);
  });
});

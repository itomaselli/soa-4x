import { describe, expect, it } from "vitest";
import type { AiProfile } from "../src/data/schemas";
import { aiEventChoices, aiOrders } from "../src/sim/systems/ai";
import { aiProposals, clubStrength } from "../src/sim/systems/aiCouncil";
import { addBusiness } from "../src/sim/systems/businesses";
import { stanceKey } from "../src/sim/systems/diplomacy";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, money, newState, PLAYER, WOLVES, zone } from "./helpers";

const CARTEL = "faction_cartel_valdes";
const profile: AiProfile = baseData.ai.profiles["expansive"]!;
const types = (state: GameState) => aiProposals(state, baseData, WOLVES, profile).map((p) => p.type);

describe("la IA usa la mesa como el jugador (Fase 8)", () => {
  it("declara la guerra a quien la agredió si es más fuerte", () => {
    const state = newState();
    state.factions[WOLVES]!.relations[PLAYER] = -40;
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER && m.rank === "prospect") m.status = "jailed";
    member(state, "member_ray_dawson").status = "jailed";
    expect(clubStrength(state, baseData, WOLVES)).toBeGreaterThan(clubStrength(state, baseData, PLAYER) * profile.council.warStrengthRatio);
    expect(types(state)).toContain("declare_war");
  });

  it("no declara la guerra si el rival es más fuerte", () => {
    const state = newState();
    state.factions[WOLVES]!.relations[PLAYER] = -40;
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.rank !== "president") m.status = "jailed";
    expect(types(state)).not.toContain("declare_war");
  });

  it("en guerra y con el club descontento, pide tregua si el rival la aceptaría", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "war", sinceWeek: 1 };
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.rank !== "president") m.loyalty = 30;
    expect(types(state)).toContain("truce");
  });

  it("no pide una tregua que le van a rechazar", () => {
    const state = newState();
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "war", sinceWeek: 1 };
    state.factions[PLAYER]!.relations[WOLVES] = -90;
    zone(state, "zone_dry_creek").control = { [PLAYER]: 80 }; // we're ahead → they refuse
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.rank !== "president") m.loyalty = 30;
    expect(types(state)).not.toContain("truce");
  });

  it("propone expulsar al miembro con lealtad muy baja", () => {
    const state = newState();
    member(state, "member_wolves_gil_stroud").loyalty = 5;
    expect(aiProposals(state, baseData, WOLVES, profile)).toContainEqual(expect.objectContaining({ type: "expel", targetMemberId: "member_wolves_gil_stroud" }));
  });

  it("asciende a un prospecto leal a Miembro", () => {
    const state = newState();
    member(state, "member_wolves_toby_reed").loyalty = 80;
    expect(aiProposals(state, baseData, WOLVES, profile)).toContainEqual(
      expect.objectContaining({ type: "promote", targetMemberId: "member_wolves_toby_reed", newRank: "member" }),
    );
  });

  it("cubre un cargo vacante con su Miembro más leal", () => {
    const state = newState();
    member(state, "member_wolves_rex_hollis").status = "dead"; // sergeant at arms
    expect(aiProposals(state, baseData, WOLVES, profile)).toContainEqual(expect.objectContaining({ type: "promote", newRank: "sergeant_at_arms" }));
  });

  it("con depósito y plata sucia, busca un trato con el cartel", () => {
    const state = newState();
    addBusiness(state, baseData, WOLVES, "business_warehouse", "zone_millbrook");
    money(state, WOLVES).dirty = 5000;
    expect(types(state)).toContain("cartel_deal");
  });

  it("nunca lleva más de 2 propuestas por semana a la mesa", () => {
    const state = newState();
    state.factions[WOLVES]!.relations[PLAYER] = -40;
    member(state, "member_wolves_gil_stroud").loyalty = 5;
    member(state, "member_wolves_toby_reed").loyalty = 80;
    expect(aiOrders(state, baseData, WOLVES).proposals!.length).toBeLessThanOrEqual(baseData.balance.council.maxProposalsPerWeek);
  });

  it("con trato y lugar en el depósito, compra armas", () => {
    const state = newState();
    state.week = 3;
    addBusiness(state, baseData, WOLVES, "business_warehouse", "zone_millbrook");
    state.stances[stanceKey(WOLVES, CARTEL)] = { type: "deal", sinceWeek: 2, lastPurchaseWeek: 2 };
    money(state, WOLVES).dirty = 3000;
    expect(aiOrders(state, baseData, WOLVES).management).toContainEqual(expect.objectContaining({ kind: "buy", goodId: "good_gun_crate" }));
  });
});

describe("la IA decide sus eventos (Fase 8)", () => {
  const pending = (state: GameState, eventId: string) =>
    state.pendingEvents.push({ instanceId: `${eventId}@1@${WOLVES}`, eventId, factionId: WOLVES, subjectMemberId: null, rivalFactionId: PLAYER, week: 1 });

  it("elige la opción con mejor valor esperado: asaltar el camión, no pagarle la campaña al sheriff", () => {
    const state = newState();
    pending(state, "event_route9_truck");
    pending(state, "event_sheriff_campaign");
    const choices = Object.fromEntries(aiEventChoices(state, baseData, WOLVES).map((c) => [c.instanceId.split("@")[0], c.optionId]));
    expect(choices).toEqual({ event_route9_truck: "hit", event_sheriff_campaign: "refuse" });
  });

  it("si un miembro nuestro se pasa a un club de la IA, el informe nos avisa", () => {
    const state = newState();
    state.pendingEvents.push({
      instanceId: "event_wolf_defector@1@w",
      eventId: "event_wolf_defector",
      factionId: WOLVES,
      subjectMemberId: "member_bo_tanner",
      rivalFactionId: PLAYER,
      week: 1,
    });
    const calm = dataWith((d) => (d.balance.events.weeklyChance = 0));
    const { state: next, report } = resolveTurn(state, { assignments: [], eventChoices: [{ instanceId: "event_wolf_defector@1@w", optionId: "accept" }] }, calm);
    expect(member(next, "member_bo_tanner").factionId).toBe(WOLVES);
    expect(report.find((e) => e.key === "report.event.defected_away")?.factionId).toBe(PLAYER);
  });
});

describe("sucesión en los clubes de la IA (Fase 8)", () => {
  it("si la mesa destituye al presidente de un club de la IA, asume quien lo propuso y la partida sigue", () => {
    const state = newState();
    for (const m of Object.values(state.members)) if (m.factionId === WOLVES && m.rank !== "president") m.loyalty = 25;
    state.factions[WOLVES]!.lowLoyaltyWeeks = 2;
    const data = dataWith((d) => {
      d.balance.loyalty.desertChance = 0;
      d.balance.loyalty.informantChance = 0;
      d.balance.council.vote.minChance = 0;
      d.balance.council.vote.maxChance = 0;
      d.balance.events.weeklyChance = 0;
    });
    const { state: next, report } = resolveTurn(state, { assignments: [] }, data);
    expect(report.map((e) => e.key)).toContain("report.loyalty.succession");
    expect(member(next, "member_wolves_jed_sutter").rank).toBe("president"); // the vice president
    expect(member(next, "member_wolves_cole_maddox").rank).toBe("member");
    expect(next.outcome).toBeNull();
  });
});

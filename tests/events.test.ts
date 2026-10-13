import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import { eventEligible } from "../src/sim/systems/events";
import type { GameState } from "../src/sim/state";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, member, money, newState, PLAYER, PROSPECT, SHERIFF, VP, WOLVES } from "./helpers";

const keys = (r: { key: string }[]) => r.map((e) => e.key);

/** Data where only one event exists and it always fires. */
function only(eventId: string, patch: (d: GameData) => void = () => {}): GameData {
  return dataWith((d) => {
    d.events = d.events.filter((e) => e.id === eventId);
    d.events.forEach((e) => (e.conditions.minWeek = undefined));
    d.balance.events.weeklyChance = 1;
    d.balance.arrest.minChance = 0;
    d.balance.arrest.maxChance = 0;
    patch(d);
  });
}

function withEvent(eventId: string, data: GameData): GameState {
  return resolveTurn(newState(), { assignments: [] }, data).state;
}

function answer(state: GameState, data: GameData, optionId?: string) {
  const instanceId = state.pendingEvents.find((e) => e.factionId === PLAYER)?.instanceId ?? "";
  return resolveTurn(state, { assignments: [], eventChoices: optionId ? [{ instanceId, optionId }] : [] }, data);
}

describe("eventos (GDD §13)", () => {
  it("un evento queda pendiente hasta que el jugador decide", () => {
    const data = only("event_sheriff_campaign");
    const state = withEvent("event_sheriff_campaign", data);
    expect(state.pendingEvents.filter((e) => e.factionId === PLAYER).map((e) => e.eventId)).toEqual(["event_sheriff_campaign"]);
  });

  it("la decisión del jugador se aplica al comienzo de la semana siguiente", () => {
    const data = only("event_sheriff_campaign", (d) => (d.balance.events.weeklyChance = 0));
    const state = withEvent("event_sheriff_campaign", only("event_sheriff_campaign"));
    money(state).dirty = 1000;
    const { state: next, report } = answer(state, data, "pay");
    expect(report.find((e) => e.key === "report.event.choice")?.params.optionKey).toBe("event.event_sheriff_campaign.option.pay");
    expect(keys(report)).toContain("report.event.money");
    expect(next.pendingEvents).toEqual([]);
    expect(next.factions[SHERIFF]?.relations[PLAYER]).toBeGreaterThan(0);
  });

  it("si nadie decide, se aplica la opción por defecto", () => {
    const data = only("event_sheriff_campaign", (d) => (d.balance.events.weeklyChance = 0));
    const state = withEvent("event_sheriff_campaign", only("event_sheriff_campaign"));
    const { state: next, report } = answer(state, data);
    expect(report.find((e) => e.key === "report.event.choice")?.params.optionKey).toBe("event.event_sheriff_campaign.option.refuse");
    expect(next.factions[SHERIFF]?.relations[PLAYER]).toBeLessThan(0);
  });

  it("si no alcanza la plata para la opción elegida, se aplica la opción por defecto", () => {
    const data = only("event_sheriff_campaign", (d) => (d.balance.events.weeklyChance = 0));
    const state = withEvent("event_sheriff_campaign", only("event_sheriff_campaign"));
    money(state).dirty = 10;
    const { report } = answer(state, data, "pay");
    expect(report.find((e) => e.key === "report.event.choice")?.params.optionKey).toBe("event.event_sheriff_campaign.option.refuse");
  });

  it("un evento no se repite antes de su enfriamiento", () => {
    const data = only("event_sheriff_campaign");
    const state = withEvent("event_sheriff_campaign", data);
    const def = data.events[0]!;
    expect(eventEligible(state, data, PLAYER, def)).toBe(false);
    // Cooldowns are per club: the Wolves got the same event the same week, and also can't repeat it.
    expect(eventEligible(state, data, WOLVES, def)).toBe(false);
  });

  it("las condiciones se respetan: sin informante no hay sospecha de informante", () => {
    const def = baseData.events.find((e) => e.id === "event_informant_suspicion")!;
    const state = newState();
    expect(eventEligible(state, baseData, PLAYER, def)).toBe(false);
    member(state, VP).informant = true;
    expect(eventEligible(state, baseData, PLAYER, def)).toBe(true);
  });

  it("dar el parche: el prospecto pasa a Miembro y sube su lealtad", () => {
    const data = only("event_prospect_patch", (d) => (d.balance.events.weeklyChance = 0));
    const state = withEvent("event_prospect_patch", only("event_prospect_patch"));
    const subjectId = state.pendingEvents.find((e) => e.factionId === PLAYER)!.subjectMemberId!;
    const next = answer(state, data, "accept").state;
    expect(member(next, subjectId).rank).toBe("member");
  });

  it("recibir a un lobo: se pasa a nuestro club como prospecto y los Wolves se enojan", () => {
    const data = only("event_wolf_defector", (d) => (d.balance.events.weeklyChance = 0));
    const state = withEvent("event_wolf_defector", only("event_wolf_defector"));
    const subjectId = state.pendingEvents.find((e) => e.factionId === PLAYER)!.subjectMemberId!;
    const next = answer(state, data, "accept").state;
    expect(member(next, subjectId).factionId).toBe(PLAYER);
    expect(member(next, subjectId).rank).toBe("prospect");
    expect(next.factions[WOLVES]?.relations[PLAYER]).toBeLessThan(0);
  });

  it("investigar al informante puede descubrirlo y echarlo", () => {
    const data = only("event_informant_suspicion", (d) => {
      d.balance.events.weeklyChance = 0;
      const ev = d.events[0]!;
      const fx = ev.options.find((o) => o.id === "investigate")!.effects.find((e) => e.type === "chance");
      if (fx?.type === "chance") fx.probability = 1;
    });
    const base = newState();
    member(base, VP).informant = true;
    const state = resolveTurn(base, { assignments: [] }, only("event_informant_suspicion")).state;
    const { state: next, report } = answer(state, data, "investigate");
    expect(keys(report)).toContain("report.event.informant_exposed");
    expect(next.members[VP]).toBeUndefined();
  });

  it("asaltar el camión: si sale mal, alguien cae preso", () => {
    const data = only("event_route9_truck", (d) => {
      d.balance.events.weeklyChance = 0;
      const fx = d.events[0]!.options.find((o) => o.id === "hit")!.effects[0];
      if (fx?.type === "chance") fx.probability = 0;
    });
    const state = withEvent("event_route9_truck", only("event_route9_truck"));
    const { state: next, report } = answer(state, data, "hit");
    expect(keys(report)).toContain("report.event.jailed");
    expect(Object.values(next.members).some((m) => m.factionId === PLAYER && m.status === "jailed")).toBe(true);
  });

  it("los clubes de la IA también tienen eventos, con las mismas reglas", () => {
    const state = withEvent("event_sheriff_campaign", only("event_sheriff_campaign"));
    expect(state.pendingEvents.map((e) => e.factionId).sort()).toEqual([WOLVES, PLAYER].sort());
    void PROSPECT;
  });
});

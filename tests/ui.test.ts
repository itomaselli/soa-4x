import { describe, expect, it } from "vitest";
import { carryOverDraft, draftProblems, draftToOrders, type Draft } from "../src/ui/draft";
import { diplomacyRows, mapViewModel, memberRows, topBarModel, votePreview, zoneDetails } from "../src/ui/viewModel";
import { stanceKey } from "../src/sim/systems/diplomacy";
import { resolveTurn } from "../src/sim/turn";
import { baseData, member, newState, PLAYER, PRESIDENT, SERGEANT, VP, WOLVES, zone } from "./helpers";

describe("interfaz: borrador de órdenes", () => {
  it("solo se mandan las tareas que ya tienen zona", () => {
    const draft: Draft = {
      [PRESIDENT]: { taskId: "task_collect_protection", zoneId: "zone_redwater" },
      [VP]: { taskId: "task_intimidate", zoneId: null },
    };
    expect(draftToOrders(draft).assignments).toEqual([
      { memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" },
    ]);
  });

  it("marca las tareas sin zona y las zonas fuera de alcance con la misma validación que la simulación", () => {
    const draft: Draft = {
      [PRESIDENT]: { taskId: "task_guard_zone", zoneId: "zone_lone_pine" },
      [VP]: { taskId: "task_intimidate", zoneId: null },
      [SERGEANT]: { taskId: "task_intimidate", zoneId: "zone_crossing" },
    };
    expect(draftProblems(draft, newState(), baseData)).toEqual({
      [PRESIDENT]: "order_error.zone_not_reachable",
      [VP]: "ui.error.pick_zone",
    });
  });

  it("después de avanzar la semana se conservan las órdenes que siguen siendo válidas", () => {
    const state = newState();
    member(state, VP).status = "jailed";
    member(state, VP).statusWeeks = 3;
    const draft: Draft = {
      [PRESIDENT]: { taskId: "task_collect_protection", zoneId: "zone_redwater" },
      [VP]: { taskId: "task_guard_zone", zoneId: "zone_redwater" },
    };
    expect(Object.keys(carryOverDraft(draft, state, baseData))).toEqual([PRESIDENT]);
  });
});

describe("interfaz: datos para mostrar", () => {
  it("el mapa pinta cada zona con el color de su dueño, o neutral si no tiene", () => {
    const vm = mapViewModel(newState(), baseData, PLAYER, null);
    const saints = baseData.factions.find((f) => f.id === PLAYER)!.color;
    const wolves = baseData.factions.find((f) => f.id === WOLVES)!.color;
    expect(vm.zones["zone_redwater"]?.borderColor).toBe(saints);
    expect(vm.zones["zone_millbrook"]?.borderColor).toBe(wolves);
    expect(vm.zones["zone_crossing"]?.borderColor).toBe(baseData.ui.colors.neutral);
  });

  it("las zonas fuera de alcance se ven apagadas y las calientes llevan aviso", () => {
    const state = newState();
    zone(state, "zone_redwater").heat = 50;
    const vm = mapViewModel(state, baseData, PLAYER, "zone_redwater");
    expect(vm.zones["zone_lone_pine"]?.labelColor).toBe(baseData.ui.colors.labelDim);
    expect(vm.zones["zone_redwater"]?.labelColor).toBe(baseData.ui.colors.label);
    expect(vm.zones["zone_redwater"]?.heatWarning).toBe(true);
    expect(vm.selectedZoneId).toBe("zone_redwater");
  });

  it("la barra superior muestra semana, plata, territorio y relación con los rivales", () => {
    const m = topBarModel(newState(), baseData, PLAYER);
    expect(m).toMatchObject({ week: 1, clean: 2000, dirty: 500, owned: 1, totalZones: 18, target: 12 });
    expect(m.relations.map((r) => r.name)).toEqual(["Grim Wolves MC"]);
  });

  it("la ficha de zona muestra el control de cada facción y sus vecinas", () => {
    const d = zoneDetails(newState(), baseData, "zone_crossing", PLAYER)!;
    expect(d.control.map((c) => c.value)).toEqual([10, 10]);
    expect(d.freeControl).toBe(80);
    expect(d.owner).toBeNull();
    expect(d.neighbors.map((n) => n.id)).toContain("zone_route9_north");
  });

  it("la tabla del club lista primero los rangos más altos y oculta a los muertos", () => {
    const state = newState();
    member(state, VP).status = "dead";
    const rows = memberRows(state, PLAYER);
    expect(rows[0]?.id).toBe(PRESIDENT);
    expect(rows.map((r) => r.id)).not.toContain(VP);
  });

  it("los datos de la interfaz se recalculan después de un turno", () => {
    const state = newState();
    const next = resolveTurn(state, { assignments: [{ memberId: PRESIDENT, taskId: "task_collect_protection", zoneId: "zone_redwater" }] }, baseData).state;
    expect(topBarModel(next, baseData, PLAYER).week).toBe(2);
  });

  it("los federales no se muestran hasta que la investigación llega a 50", () => {
    const state = newState();
    state.factions[PLAYER]!.federal = 49;
    expect(topBarModel(state, baseData, PLAYER).federal).toBeNull();
    state.factions[PLAYER]!.federal = 50;
    expect(topBarModel(state, baseData, PLAYER).federal).toBe(50);
  });

  it("la barra superior avisa cuando la lealtad promedio está por debajo de 35", () => {
    const state = newState();
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER && m.rank !== "president") m.loyalty = 30;
    expect(topBarModel(state, baseData, PLAYER)).toMatchObject({ averageLoyalty: 30, lowLoyalty: true });
  });

  it("la estimación de voto muestra a cada votante; el ascendido vota a favor y el expulsado en contra", () => {
    const state = newState();
    const promote = votePreview(state, baseData, PLAYER, "promote", "member_bo_tanner");
    expect(promote.find((v) => v.name === "Smoke")?.fixed).toBe("yes");
    const expel = votePreview(state, baseData, PLAYER, "expel", "member_bo_tanner");
    expect(expel.find((v) => v.name === "Smoke")?.fixed).toBe("no");
    expect(expel.every((v) => v.chance >= 0 && v.chance <= 100)).toBe(true);
  });

  it("la diplomacia muestra guerra, tregua y semanas", () => {
    const state = newState();
    state.week = 5;
    state.stances[stanceKey(PLAYER, WOLVES)] = { type: "truce", sinceWeek: 3 };
    expect(diplomacyRows(state, baseData, PLAYER)).toEqual([
      expect.objectContaining({ id: WOLVES, stateKey: "diplomacy.truce", truceWeeksLeft: 6, warWeeks: null }),
    ]);
  });
});

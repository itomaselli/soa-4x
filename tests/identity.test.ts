import { describe, expect, it } from "vitest";
import { patchPixels } from "../src/render/patch";
import { withIdentities } from "../src/sim/identity";
import { deserializeState, saveDataProblems, serializeState } from "../src/sim/save";
import { createInitialState } from "../src/sim/setup";
import { resolveTurn } from "../src/sim/turn";
import { baseData, dataWith, PLAYER, WOLVES } from "./helpers";

describe("identidad del club (Fase 11)", () => {
  it("sin elegir nada, el club arranca con su nombre y parche por defecto", () => {
    const state = createInitialState(baseData, { seed: 1, playerFactionId: PLAYER });
    expect(state.identities[PLAYER]).toEqual({ name: "Iron Saints MC", patchId: "patch_01" });
  });

  it("el jugador elige nombre y parche; los rivales tienen el suyo", () => {
    const state = createInitialState(baseData, { seed: 1, playerFactionId: PLAYER, clubName: "  Hijos del Asfalto MC ", patchId: "patch_17" });
    expect(state.identities[PLAYER]).toEqual({ name: "Hijos del Asfalto MC", patchId: "patch_17" });
    expect(state.identities[WOLVES]).toEqual({ name: "Grim Wolves MC", patchId: "patch_02" });
  });

  it("el informe usa el nombre elegido", () => {
    const state = createInitialState(baseData, { seed: 1, playerFactionId: PLAYER, clubName: "Hijos del Asfalto MC" });
    const sure = dataWith((d) => {
      d.balance.council.vote.minChance = 1;
      d.balance.events.weeklyChance = 0;
    });
    const { report } = resolveTurn(state, { assignments: [], proposals: [{ factionId: PLAYER, type: "declare_war", targetFactionId: WOLVES }] }, sure);
    expect(report.find((e) => e.key === "report.council.war_declared")?.params.faction).toBe("Hijos del Asfalto MC");
  });

  it("la identidad se guarda y se carga con la partida", () => {
    const state = createInitialState(baseData, { seed: 1, playerFactionId: PLAYER, clubName: "Los Cuervos MC", patchId: "patch_33" });
    const loaded = deserializeState(serializeState(state));
    expect(withIdentities(baseData, loaded).factions.find((f) => f.id === PLAYER)).toMatchObject({ name: "Los Cuervos MC", patchId: "patch_33" });
    expect(saveDataProblems(loaded, baseData)).toEqual([]);
  });

  it("un parche que ya no existe en los datos se detecta al cargar", () => {
    const state = createInitialState(baseData, { seed: 1, playerFactionId: PLAYER, patchId: "patch_99" });
    expect(saveDataProblems(state, baseData)).toContainEqual(`${PLAYER}: parche desconocido patch_99`);
  });
});

describe("los 50 parches (Fase 11)", () => {
  const grids = baseData.patches.patches.map((p) => patchPixels(baseData, p.id));

  it("hay 50 parches y todos se pueden dibujar a 16×16", () => {
    expect(grids).toHaveLength(50);
    for (const grid of grids) {
      expect(grid).toHaveLength(16);
      for (const row of grid!) expect(row).toHaveLength(16);
    }
  });

  it("no hay dos parches iguales", () => {
    expect(new Set(grids.map((g) => JSON.stringify(g))).size).toBe(50);
  });

  it("cada parche tiene borde, fondo y emblema visibles", () => {
    for (const p of baseData.patches.patches) {
      const palette = baseData.patches.palettes[p.palette]!;
      const colors = new Set(patchPixels(baseData, p.id)!.flat().filter(Boolean));
      expect(colors.has(palette.rim), p.id).toBe(true);
      expect(colors.has(palette.emblem), p.id).toBe(true);
    }
  });
});

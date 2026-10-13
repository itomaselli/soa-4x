import { describe, expect, it } from "vitest";
import { BUNDLED_RAW_DATA, DataValidationError, loadGameData, parseGameData, type RawGameData } from "../src/data/load";
import type { PortraitsData } from "../src/data/schemas";
import { hashId } from "../src/render/hash";
import { patchPixels } from "../src/render/patch";
import { portraitPicks, portraitPixels, type PortraitSubject } from "../src/render/portrait";
import { createInitialState } from "../src/sim/setup";
import { RANKS } from "../src/sim/state";
import { memberSheet } from "../src/ui/viewModel";

const data = loadGameData();
const P = data.portraits;
const subject = (over: Partial<PortraitSubject> = {}): PortraitSubject => ({ id: "member_test_rider", rank: "member", status: "active", ...over });
const PATCH = "patch_02";

function problemsWith(change: (p: PortraitsData) => void): string[] {
  const raw = structuredClone(BUNDLED_RAW_DATA) as RawGameData;
  change(raw.portraits as PortraitsData);
  try {
    parseGameData(raw);
  } catch (error) {
    if (error instanceof DataValidationError) return error.problems;
    throw error;
  }
  return [];
}

describe("datos de retratos (portraits.json)", () => {
  it("el JSON real pasa la validación y tiene un chaleco para cada rango", () => {
    expect(problemsWith(() => {})).toEqual([]);
    for (const rank of RANKS) expect(P.vests[P.ranks[rank].vest]).toBeDefined();
  });

  it("rechaza una pieza con una fila de largo incorrecto o caracteres inválidos", () => {
    const short = problemsWith((p) => {
      p.over[0]!.pieces[Object.keys(p.over[0]!.pieces)[0]!]![3] = ".".repeat(p.size - 1);
    });
    expect(short.join("\n")).toMatch(/capa "head" › pieza "oval": tiene que ser de 24×24/);
    const bad = problemsWith((p) => {
      p.vests.open![0] = "x".repeat(p.size);
    });
    expect(bad.join("\n")).toMatch(/chaleco "open"/);
  });

  it("rechaza tintas, chalecos o insignias desconocidas", () => {
    const problems = problemsWith((p) => {
      p.over[0]!.ink = "plaid";
      p.ranks.president.vest = "tuxedo";
      p.ranks.treasurer.tab = "medal";
    }).join("\n");
    expect(problems).toMatch(/tinta desconocida "plaid"/);
    expect(problems).toMatch(/chaleco desconocido "tuxedo"/);
    expect(problems).toMatch(/insignia desconocida "medal"/);
  });
});

describe("retratos de miembros", () => {
  it("el retrato es de 24×24", () => {
    const grid = portraitPixels(data, subject(), PATCH);
    expect(grid).toHaveLength(P.size);
    for (const row of grid) expect(row).toHaveLength(P.size);
  });

  it("el mismo id da siempre el mismo retrato (semilla derivada del id)", () => {
    expect(portraitPixels(data, subject(), PATCH)).toEqual(portraitPixels(data, subject(), PATCH));
    expect(hashId("member_test_rider")).toBe(hashId("member_test_rider"));
  });

  it("ids distintos dan caras variadas", () => {
    const faces = new Set(Array.from({ length: 100 }, (_, i) => JSON.stringify(portraitPicks(data, `member_${i}`))));
    expect(faces.size).toBeGreaterThan(95);
  });

  it("cada capa usa una sola tinta: la barba y el pelo comparten color", () => {
    for (let i = 0; i < 50; i++) {
      const picks = portraitPicks(data, `member_${i}`);
      for (const [key, colors] of Object.entries(P.inks)) expect(colors).toContain(picks.inks[key]);
    }
  });

  it("el rango define el chaleco: el prospecto no lleva el parche y el miembro sí", () => {
    const patchColors = new Set(patchPixels(data, PATCH)!.flat().filter(Boolean));
    const { x, y, size } = P.patchSlot;
    const slot = (rank: PortraitSubject["rank"]) =>
      portraitPixels(data, subject({ rank }), PATCH)
        .slice(y, y + size)
        .flatMap((row) => row.slice(x, x + size));
    expect(slot("member").some((c) => c !== null && patchColors.has(c))).toBe(true);
    expect(slot("prospect").some((c) => c !== null && patchColors.has(c))).toBe(false);
  });

  it("los oficiales llevan su insignia de rango", () => {
    for (const rank of RANKS) {
      const def = P.ranks[rank];
      const colors = new Set(portraitPixels(data, subject({ rank }), PATCH).flat());
      if (def.tabInk) expect(colors.has(def.tabInk), rank).toBe(true);
    }
  });

  it("la cara no depende del rango ni del estado", () => {
    const top = (s: PortraitSubject) => portraitPixels(data, s, PATCH).slice(0, 12);
    expect(top(subject({ rank: "president" }))).toEqual(top(subject({ rank: "prospect" })));
  });

  it("herido lleva vendaje, preso lleva rejas y muerto queda en escala de grises", () => {
    const has = (s: PortraitSubject, ink: string) => portraitPixels(data, s, PATCH).flat().includes(ink);
    const wounded = P.status.overlays.wounded!;
    const jailed = P.status.overlays.jailed!;
    expect(has(subject({ status: "wounded" }), wounded.ink)).toBe(true);
    expect(has(subject({ status: "jailed" }), jailed.ink)).toBe(true);
    expect(has(subject(), jailed.ink)).toBe(false);
    for (const c of portraitPixels(data, subject({ status: "dead" }), PATCH).flat()) {
      expect(c).toMatch(/^#([0-9a-f]{2})\1\1$/);
    }
  });
});

describe("ficha del miembro", () => {
  const state = createInitialState(data, { seed: 1, playerFactionId: "faction_iron_saints" });
  const member = Object.values(state.members).find((m) => m.factionId === "faction_iron_saints")!;

  it("muestra estadísticas, lealtad, gustos del rasgo y la orden de la semana", () => {
    const sheet = memberSheet(state, data, member.id, { taskId: "task_guard_zone", zoneId: "zone_redwater" })!;
    expect(sheet.stats.map((s) => s.value)).toEqual([member.stats.strength, member.stats.cunning, member.stats.hands, member.stats.charm]);
    expect(sheet.loyalty.value).toBe(member.loyalty);
    expect(sheet.likes).toEqual(data.traits.tasks[member.trait]?.likes ?? []);
    expect(sheet.plan).toEqual({ taskId: "task_guard_zone", zoneId: "zone_redwater" });
  });

  it("el chaleco lleva el parche actual del club", () => {
    const sheet = memberSheet(state, data, member.id, null)!;
    expect(sheet.patchId).toBe(data.factions.find((f) => f.id === member.factionId)?.patchId);
  });

  it("un id desconocido no abre ficha", () => {
    expect(memberSheet(state, data, "member_nobody", null)).toBeNull();
  });
});

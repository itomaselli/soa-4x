import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data/schemas";
import { validateGameData } from "../src/data/validate";
import { generateCountyMap, innerBand, lPaths, riverSegments, roadPath, type CountyMap } from "../src/render/county";
import { buildMapLayout, zoneTiles } from "../src/render/layout";
import { computeRegions } from "../src/render/regions";
import { generateScenario } from "../src/sim/mapgen";
import { gameData } from "../src/sim/scenario";
import { MAP_SIZES } from "../src/sim/state";
import { baseData, PLAYER } from "./helpers";

const SEEDS = [1, 7, 42, 1234];

/** The classic county plus random counties of every size. */
const counties: { name: string; data: GameData }[] = [
  { name: "clásico", data: baseData },
  ...MAP_SIZES.flatMap((size) =>
    SEEDS.map((seed) => ({
      name: `${size} #${seed}`,
      data: gameData(baseData, { scenario: generateScenario(baseData, { size, seed, playerFactionId: PLAYER, playerPatchId: "patch_01" }).scenario, identities: {} }),
    })),
  ),
];

function paint(data: GameData): CountyMap {
  return generateCountyMap(data, computeRegions(data), buildMapLayout(data));
}

const key = (x: number, y: number) => `${x},${y}`;

describe("mapa del condado con tiles", () => {
  it("es determinista: el mismo condado da el mismo terreno, rutas, vías y casas", () => {
    for (const { name, data } of counties) expect(paint(data), name).toEqual(paint(data));
  });

  it("hay una ruta en L entre los centros de cada par de zonas vecinas", () => {
    for (const { name, data } of counties) {
      const map = paint(data);
      const layout = buildMapLayout(data);
      const pairs = new Set(data.zones.flatMap((z) => z.adjacent.map((a) => [z.id, a].sort().join("|"))));
      expect(new Set(map.roads.map((r) => [r.a, r.b].sort().join("|"))), name).toEqual(pairs);
      for (const road of map.roads) {
        const a = layout.zones.find((z) => z.id === road.a)!.center;
        const b = layout.zones.find((z) => z.id === road.b)!.center;
        expect(road.tiles[0], name).toEqual(a);
        expect(road.tiles.at(-1), name).toEqual(b);
        // One step at a time, turning at most once.
        let turns = 0;
        for (let i = 1; i < road.tiles.length; i++) {
          const p = road.tiles[i - 1]!;
          const q = road.tiles[i]!;
          expect(Math.abs(q.x - p.x) + Math.abs(q.y - p.y), name).toBe(1);
          if (i > 1 && (q.x - p.x !== p.x - road.tiles[i - 2]!.x || q.y - p.y !== p.y - road.tiles[i - 2]!.y)) turns++;
        }
        expect(turns, name).toBeLessThanOrEqual(1);
        for (const t of road.tiles) expect(map.cells[t.y]![t.x]!.track?.kind, name).toBe("road");
      }
    }
  });

  it("elige la L que queda más adentro de las dos zonas", () => {
    for (const { name, data } of counties) {
      const regions = computeRegions(data);
      const layout = buildMapLayout(data);
      for (const z of data.zones) {
        for (const other of z.adjacent) {
          const path = roadPath(regions, layout, z.id, other);
          const inside = (tiles: { x: number; y: number }[]) => tiles.filter((t) => [z.id, other].includes(regions.tiles[t.y]?.[t.x] ?? "")).length;
          const [h, v] = lPaths(layout.zones.find((l) => l.id === z.id)!.center, layout.zones.find((l) => l.id === other)!.center);
          const centers = new Set(layout.zones.filter((l) => l.id !== z.id && l.id !== other).map((l) => key(l.center.x, l.center.y)));
          const clean = (tiles: { x: number; y: number }[]) => !tiles.some((t) => centers.has(key(t.x, t.y)));
          // The chosen one avoids other centers when it can, and among clean options has the most cells inside.
          if (clean(h) || clean(v)) expect(clean(path), `${name} ${z.id}–${other}`).toBe(true);
          if (clean(h) && clean(v)) expect(inside(path), `${name} ${z.id}–${other}`).toBe(Math.max(inside(h), inside(v)));
        }
      }
    }
  });

  it("los ríos son las fronteras cerradas, siempre los mismos", () => {
    for (const { name, data } of counties) {
      const rivers = riverSegments(computeRegions(data));
      expect(rivers, name).toEqual(riverSegments(computeRegions(data)));
      for (const r of rivers) {
        expect(r.a !== null && r.b !== null, name).toBe(true);
        expect(data.zones.find((z) => z.id === r.a)?.adjacent, name).not.toContain(r.b);
      }
    }
  });

  it("casas, fábricas, árboles, rocas y vías no pisan centros, nombres ni rutas", () => {
    for (const { name, data } of counties) {
      const map = paint(data);
      const layout = buildMapLayout(data);
      const kept = new Set(layout.zones.flatMap((z) => [...zoneTiles(z).map((t) => key(t.x, t.y)), key(z.center.x + 2, z.center.y - 1)]));
      map.cells.forEach((row, y) =>
        row.forEach((cell, x) => {
          if (cell.deco) {
            expect(kept.has(key(x, y)), `${name}: ${cell.deco} en ${x},${y}`).toBe(false);
            expect(cell.track, `${name}: ${cell.deco} sobre una ruta en ${x},${y}`).toBeNull();
            expect(cell.zoneId, name).not.toBeNull();
          }
          if (cell.track?.kind === "rail") expect(kept.has(key(x, y)), `${name}: vía en ${x},${y}`).toBe(false);
        }),
      );
    }
  });

  it("las casas rodean el centro de pueblos y puertos y se ralean con la distancia", () => {
    let near = 0;
    let far = 0;
    let nearCells = 0;
    let farCells = 0;
    for (const { data } of counties) {
      const map = paint(data);
      const layout = buildMapLayout(data);
      const buildings = new Set(Object.values(data.ui.county.buildings).flatMap((b) => b?.sprites ?? []));
      map.cells.forEach((row, y) =>
        row.forEach((cell, x) => {
          const zone = data.zones.find((z) => z.id === cell.zoneId);
          const isBuilding = cell.deco !== null && buildings.has(cell.deco);
          if (isBuilding) expect(data.ui.county.buildings[zone!.type], zone!.type).toBeDefined();
          if (!zone || zone.type !== "town") return;
          const c = layout.zones.find((z) => z.id === zone.id)!.center;
          const d = Math.hypot(x - c.x, y - c.y);
          if (d <= 3) {
            nearCells++;
            if (isBuilding) near++;
          } else if (d >= 5) {
            farCells++;
            if (isBuilding) far++;
          }
        }),
      );
    }
    expect(near / nearCells).toBeGreaterThan(far / farCells);
    expect(near).toBeGreaterThan(0);
  });

  it("vías en las zonas industriales; mar afuera junto a los puertos; marisma en las rurales con «~»", () => {
    for (const { name, data } of counties) {
      const map = paint(data);
      const cfg = data.ui.county;
      const cells = map.cells.flat();
      for (const cell of cells.filter((c) => c.track?.kind === "rail")) expect(data.zones.find((z) => z.id === cell.zoneId)?.type, name).toBe("industrial");
      for (const cell of cells.filter((c) => c.sea)) expect(cell.zoneId, name).toBeNull();
      if (data.zones.some((z) => z.type === "port")) expect(cells.some((c) => c.sea), name).toBe(true);
      for (const cell of cells.filter((c) => c.zoneId !== null)) {
        const zone = data.zones.find((z) => z.id === cell.zoneId)!;
        if (zone.type === "rural" && zone.glyph === cfg.marsh.glyph) expect(cell.ground, name).toBe(cfg.marsh.sprite);
        if (zone.type === "industrial") expect(cfg.ground.industrial, name).toContain(cell.ground);
      }
    }
  });
});

describe("datos del condado (ui.json › county)", () => {
  it("los datos reales pasan y un sprite que no existe o un suelo que no cubre la celda se rechazan", () => {
    expect(validateGameData(baseData)).toEqual([]);
    const data = structuredClone(baseData);
    data.ui.county.rocks.sprite = "local.boulder";
    data.ui.county.ground.port = ["local.house_1"];
    const problems = validateGameData(data).join("\n");
    expect(problems).toMatch(/ui\.json › county\.rocks: no existe "local\.boulder" en tileset\.json/);
    expect(problems).toMatch(/ui\.json › county\.ground\.port: "local\.house_1" no cubre la celda/);
  });
});

describe("banda interior del control de facción", () => {
  const T = 16;
  const area = (rects: { w: number; h: number }[]) => rects.reduce((sum, r) => sum + r.w * r.h, 0);

  it("una celda sola lleva una banda en sus cuatro lados", () => {
    const rects = innerBand(3, 3, (x, y) => x === 1 && y === 1, T, 2);
    expect(rects).toHaveLength(4);
    for (const r of rects) expect(r.x >= T && r.y >= T && r.x + r.w <= 2 * T && r.y + r.h <= 2 * T).toBe(true);
  });

  it("es la máscara menos su erosión: un bloque de 2×2 no tiene banda entre sus celdas", () => {
    const rects = innerBand(4, 4, (x, y) => x >= 1 && x <= 2 && y >= 1 && y <= 2, T, 2);
    for (const r of rects) {
      const touchesOutline = r.x === T || r.y === T || r.x + r.w === 3 * T || r.y + r.h === 3 * T;
      expect(touchesOutline).toBe(true);
    }
    // Every pixel of the band, counted once: the 32×32 square minus its 28×28 inside.
    const covered = new Set<string>();
    for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) covered.add(`${x},${y}`);
    expect(covered.size).toBe(32 * 32 - 28 * 28);
    expect(area(rects)).toBeGreaterThanOrEqual(covered.size);
  });

  it("en una esquina hacia adentro (forma de L) agrega el cuadradito de la esquina", () => {
    const inL = (x: number, y: number) => (x === 0 && y <= 1) || (y === 1 && x <= 1);
    const rects = innerBand(2, 2, inL, T, 2);
    // Cell (0, 1) has neighbours above and to the right but not diagonally: corner square at its top-right.
    expect(rects).toContainEqual({ x: T - 2, y: T, w: 2, h: 2 });
  });
});

import { describe, expect, it } from "vitest";
import { buildMapLayout, lineTiles, zoneAt, zoneTiles } from "../src/render/layout";
import { baseData } from "./helpers";

const layout = buildMapLayout(baseData);

describe("dibujo del mapa", () => {
  it("hay una caja por cada zona", () => {
    expect(layout.zones).toHaveLength(baseData.zones.length);
  });

  it("todo lo que se dibuja entra en el mapa", () => {
    const tiles = [...layout.roads, ...layout.zones.flatMap(zoneTiles)];
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(layout.width);
      expect(t.y).toBeLessThan(layout.height);
    }
  });

  it("las zonas y sus nombres no se pisan entre sí", () => {
    const seen = new Map<string, string>();
    for (const z of layout.zones) {
      for (const t of zoneTiles(z)) {
        const k = `${t.x},${t.y}`;
        expect(seen.get(k), `${z.id} pisa a ${seen.get(k)} en ${k}`).toBeUndefined();
        seen.set(k, z.id);
      }
    }
  });

  it("los caminos no se dibujan encima de las zonas", () => {
    for (const road of layout.roads) expect(zoneAt(layout, road)).toBeNull();
  });

  it("cada conexión entre zonas tiene al menos un tramo de camino visible", () => {
    const roadSet = new Set(layout.roads.map((r) => `${r.x},${r.y}`));
    for (const zone of baseData.zones) {
      for (const adjId of zone.adjacent) {
        const other = baseData.zones.find((z) => z.id === adjId)!;
        const line = lineTiles(zone.position, other.position);
        expect(line.some((t) => roadSet.has(`${t.x},${t.y}`)), `${zone.id} → ${adjId}`).toBe(true);
      }
    }
  });

  it("hacer click en la caja o en el nombre de una zona la identifica", () => {
    const redwater = layout.zones.find((z) => z.id === "zone_redwater")!;
    expect(zoneAt(layout, redwater.center)).toBe("zone_redwater");
    expect(zoneAt(layout, redwater.labelStart)).toBe("zone_redwater");
    expect(zoneAt(layout, { x: 0, y: 0 })).toBeNull();
  });
});

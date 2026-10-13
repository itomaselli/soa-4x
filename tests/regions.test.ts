import { describe, expect, it } from "vitest";
import { generateLocalMap, LOCAL_LOT_SIZE } from "../src/render/localMap";
import { computeRegions, touchingPairs, zoneAtTile } from "../src/render/regions";
import { baseData } from "./helpers";

const map = computeRegions(baseData);

describe("mapa político (Fase 10)", () => {
  it("cada distrito contiene su propio centro y una superficie razonable", () => {
    for (const zone of baseData.zones) {
      expect(zoneAtTile(map, zone.position.x, zone.position.y)).toBe(zone.id);
      const tiles = map.tiles.flat().filter((t) => t === zone.id).length;
      expect(tiles, zone.id).toBeGreaterThan(20);
    }
  });

  it("las zonas conectadas por las reglas comparten frontera en el mapa", () => {
    const touching = touchingPairs(map);
    for (const zone of baseData.zones) {
      for (const adj of zone.adjacent) expect(touching.has([zone.id, adj].sort().join("|")), `${zone.id} – ${adj}`).toBe(true);
    }
  });

  it("las fronteras entre vecinas son abiertas; entre no vecinas, cerradas; el borde del condado es borde", () => {
    for (const b of map.borders) {
      if (b.a === null || b.b === null) expect(b.kind).toBe("edge");
      else {
        const adjacent = baseData.zones.find((z) => z.id === b.a)!.adjacent.includes(b.b);
        expect(b.kind).toBe(adjacent ? "open" : "closed");
      }
    }
  });
});

describe("mapa local de cada zona (Fase 10)", () => {
  it("es siempre el mismo para la misma zona", () => {
    expect(generateLocalMap(baseData, "zone_redwater")).toEqual(generateLocalMap(baseData, "zone_redwater"));
  });

  it("tiene un lote por cada lugar para negocios, sin superponerse y dentro del mapa", () => {
    for (const zone of baseData.zones) {
      const local = generateLocalMap(baseData, zone.id);
      expect(local.lots, zone.id).toHaveLength(zone.businessSlots);
      const used = new Set<string>();
      for (const lot of local.lots) {
        for (let y = lot.y; y < lot.y + LOCAL_LOT_SIZE; y++) {
          for (let x = lot.x; x < lot.x + LOCAL_LOT_SIZE; x++) {
            expect(x).toBeLessThan(local.width);
            expect(y).toBeLessThan(local.height);
            expect(used.has(`${x},${y}`)).toBe(false);
            used.add(`${x},${y}`);
          }
        }
      }
    }
  });

  it("tiene una salida hacia cada zona vecina, en el borde correspondiente", () => {
    for (const zone of baseData.zones) {
      const local = generateLocalMap(baseData, zone.id);
      expect(local.exits.map((e) => e.zoneId).sort()).toEqual([...zone.adjacent].sort());
      for (const exit of local.exits) {
        const onEdge = exit.x === 0 || exit.y === 0 || exit.x === local.width - 1 || exit.y === local.height - 1;
        expect(onEdge, `${zone.id} → ${exit.zoneId}`).toBe(true);
      }
    }
  });

  it("el puerto tiene agua y los pueblos tienen calles y casas", () => {
    const port = generateLocalMap(baseData, "zone_port_calloway").tiles.flat();
    expect(port.some((t) => t.terrain === "water")).toBe(true);
    const town = generateLocalMap(baseData, "zone_redwater").tiles.flat();
    expect(town.some((t) => t.terrain === "road")).toBe(true);
    expect(town.some((t) => t.terrain === "building")).toBe(true);
  });
});

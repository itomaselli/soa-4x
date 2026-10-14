import { describe, expect, it } from "vitest";
import { BUNDLED_RAW_DATA, DataValidationError, parseGameData, type RawGameData } from "../src/data/load";
import type { TilesetData } from "../src/data/schemas";
import { localTextureId, validateGameData } from "../src/data/validate";
import { generateLocalMap, groundUnder } from "../src/render/localMap";
import { maskTextureId, parseColor, spritePixels } from "../src/render/tileset";
import { baseData } from "./helpers";

function problemsWith(change: (t: TilesetData, raw: RawGameData) => void): string[] {
  const raw = structuredClone(BUNDLED_RAW_DATA) as RawGameData;
  change(raw.tileset as TilesetData, raw);
  try {
    parseGameData(raw);
  } catch (error) {
    if (error instanceof DataValidationError) return error.problems;
    throw error;
  }
  return [];
}

const { tileset } = baseData;

describe("tileset a todo color (tileset.json)", () => {
  it("el JSON real pasa la validación y trae los sprites que usa el juego", () => {
    expect(problemsWith(() => {})).toEqual([]);
    for (const prefix of ["local.", "zone_type.", "business.", "marker.", "extra.", "county."]) {
      expect(Object.keys(tileset.sprites).some((id) => id.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it("rechaza con un mensaje claro una fila de 15 caracteres", () => {
    const problems = problemsWith((t) => {
      t.sprites["extra.club_hq"]!.pixels[3] = ".".repeat(15);
    });
    expect(problems.join("\n")).toMatch(/tileset\.json › sprites\.extra\.club_hq\.pixels: la fila 4 tiene 15 caracteres y tienen que ser 16/);
  });

  it("rechaza con un mensaje claro un carácter que no está en la paleta", () => {
    const problems = problemsWith((t) => {
      t.sprites["local.house_1"]!.pixels[0] = "KKKKKKK#........";
    });
    expect(problems.join("\n")).toMatch(/tileset\.json › sprites\.local\.house_1\.pixels: la fila 1 tiene caracteres que no están en la paleta \("#"\)/);
  });

  it("rechaza filas de menos y un glyph de más de un carácter", () => {
    const problems = problemsWith((t) => {
      t.sprites["extra.bar_sign"]!.pixels.pop();
      t.sprites["extra.bar_sign"]!.glyph = "YY";
    }).join("\n");
    expect(problems).toMatch(/extra\.bar_sign\.pixels: tiene 15 filas y tienen que ser 16/);
    expect(problems).toMatch(/extra\.bar_sign\.glyph: el glyph tiene que ser un solo carácter/);
  });

  it("existe cada id que referencian ui.json y buildingVariants", () => {
    const { ui } = baseData;
    const local = ui.localMap;
    const ids = [
      ...Object.keys(ui.tileset.sprites),
      ...Object.keys(local.sprites).map(localTextureId),
      ...Object.values(local.variants).flatMap((byType) => Object.values(byType).flat()).map(localTextureId),
      ...Object.values(local.autotile).flatMap((set) => set.pieces.map((p) => localTextureId(p.sprite))),
      ...local.river.sets.flat().map((p) => localTextureId(p.sprite)),
      localTextureId(local.rails.sprite),
      ...Object.values(local.lotFence).map(localTextureId),
      ...Object.values(local.landmarks).filter((v): v is string => typeof v === "string"),
      ...Object.values(tileset.buildingVariants).flat().map(localTextureId),
    ];
    for (const id of ids) expect(tileset.sprites[id], id).toBeDefined();
    expect(Object.keys(tileset.buildingVariants)).toContain("industrial");
  });

  it("un id que no existe en el tileset se reporta", () => {
    const data = structuredClone(baseData);
    data.ui.localMap.lotFence.town = "fence_marble";
    data.tileset.buildingVariants.port = ["warehouse_9"];
    const problems = validateGameData(data).join("\n");
    expect(problems).toMatch(/ui\.json › localMap\.lotFence: no existe "local\.fence_marble" en tileset\.json/);
    expect(problems).toMatch(/tileset\.json › buildingVariants\.port: no existe "local\.warehouse_9"/);
  });
});

describe("conversión del tileset a RGBA", () => {
  it("cada carácter toma el color de la paleta y el punto queda transparente", () => {
    const sprite = { pixels: ["K.", "zT"] };
    const palette = { K: "#14141a", z: "#0000006e", T: "#ffffff" };
    const { rgba, mask, size } = spritePixels(sprite, palette);
    expect(size).toBe(2);
    expect([...rgba.slice(0, 4)]).toEqual([0x14, 0x14, 0x1a, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    // The shadow keeps its alpha.
    expect([...rgba.slice(8, 12)]).toEqual([0, 0, 0, 0x6e]);
    // The mask pixel is left out of the sprite and goes white to the mask.
    expect([...rgba.slice(12, 16)]).toEqual([0, 0, 0, 0]);
    expect([...mask!]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it("los sprites reales dan 16×16 y solo los que tienen T traen máscara", () => {
    for (const [id, sprite] of Object.entries(tileset.sprites)) {
      const { rgba, mask, size } = spritePixels(sprite, tileset.palette);
      expect(size, id).toBe(16);
      expect(rgba.length, id).toBe(16 * 16 * 4);
      expect(mask !== null, id).toBe(sprite.pixels.some((row) => row.includes("T")));
    }
    expect(spritePixels(tileset.sprites["local.member"]!, tileset.palette).mask).not.toBeNull();
    expect(maskTextureId("local.member")).toBe("local.member#mask");
  });

  it("los sprites opacos cubren toda la celda", () => {
    for (const [id, sprite] of Object.entries(tileset.sprites).filter(([, s]) => s.opaque)) {
      const { rgba } = spritePixels(sprite, tileset.palette);
      for (let i = 3; i < rgba.length; i += 4) expect(rgba[i], id).toBe(255);
    }
  });

  it("lee colores con y sin alfa", () => {
    expect(parseColor("#c0483a")).toEqual([0xc0, 0x48, 0x3a, 255]);
    expect(parseColor("#0000006e")).toEqual([0, 0, 0, 0x6e]);
  });
});

describe("suelo debajo de los sprites del distrito", () => {
  const opaque = (key: string) => tileset.sprites[localTextureId(key)]?.opaque === true;

  it("toda celda sin sprite opaco lleva suelo debajo, y las opacas no", () => {
    for (const zone of baseData.zones) {
      for (const cell of generateLocalMap(baseData, zone.id).tiles.flat()) {
        if (cell.sprite && opaque(cell.sprite)) expect(cell.under, `${zone.id} ${cell.sprite}`).toBeUndefined();
        else {
          expect(cell.under, `${zone.id} ${cell.sprite}`).toBeDefined();
          expect(opaque(cell.under!), cell.under).toBe(true);
        }
      }
    }
  });

  it("el suelo debajo de un edificio sale del tipo de zona", () => {
    const ground = baseData.ui.localMap.variants.ground!;
    for (const zone of baseData.zones) {
      const map = generateLocalMap(baseData, zone.id);
      map.tiles.forEach((row, y) =>
        row.forEach((cell, x) => {
          if (cell.terrain !== "building") return;
          expect(ground[zone.type], zone.type).toContain(cell.under);
          expect(cell.under).toBe(groundUnder(baseData, zone, "building", x, y));
        }),
      );
    }
  });

  it("los edificios salen de buildingVariants según el tipo de zona, también en la zona industrial", () => {
    for (const zone of baseData.zones) {
      const buildings = generateLocalMap(baseData, zone.id).tiles.flat().filter((t) => t.terrain === "building");
      for (const b of buildings) expect(tileset.buildingVariants[zone.type], zone.id).toContain(b.sprite);
    }
    const industrial = baseData.zones.find((z) => z.type === "industrial")!;
    const sprites = new Set(generateLocalMap(baseData, industrial.id).tiles.flat().filter((t) => t.terrain === "building").map((t) => t.sprite));
    expect(sprites.size).toBeGreaterThan(1);
  });

  it("un bote flota sobre agua, no sobre el suelo del puerto", () => {
    const port = baseData.zones.find((z) => z.type === "port")!;
    const boats = generateLocalMap(baseData, port.id).tiles.flat().filter((t) => t.terrain === "boat");
    expect(boats.length).toBeGreaterThan(0);
    for (const b of boats) expect(baseData.ui.localMap.variants.water!["*"]).toContain(b.under);
  });

  it("la elección de variantes y de suelo sigue siendo determinista", () => {
    for (const zone of baseData.zones) {
      const a = generateLocalMap(baseData, zone.id).tiles.map((row) => row.map((c) => `${c.sprite}/${c.under}/${c.glyph}`));
      const b = generateLocalMap(baseData, zone.id).tiles.map((row) => row.map((c) => `${c.sprite}/${c.under}/${c.glyph}`));
      expect(a).toEqual(b);
    }
  });

  it("las piezas de autotiling conservan las conexiones de ui.json", () => {
    const { autotile } = baseData.ui.localMap;
    expect(autotile.asphalt.pieces.map((p) => [p.sprite, p.connects])).toEqual([
      ["asphalt_end", "S"],
      ["asphalt_straight", "NS"],
      ["asphalt_curve", "ES"],
      ["asphalt_tee", "NES"],
      ["asphalt_cross", "NESW"],
    ]);
    expect(autotile.dirt.pieces.map((p) => [p.sprite, p.connects])).toEqual([
      ["dirt_road_straight", "NS"],
      ["dirt_road_curve", "NE"],
      ["dirt_road_tee", "NEW"],
      ["dirt_road_cross", "NESW"],
    ]);
  });
});

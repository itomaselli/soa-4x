import { describe, expect, it } from "vitest";
import { BUNDLED_RAW_DATA, DataValidationError, parseGameData, type RawGameData } from "../src/data/load";
import type { TilesExtraData } from "../src/data/schemas";
import { EXTRA_TILE_INK, extraTilePixels } from "../src/render/extraTile";
import { autotile, connectionMask, generateLocalMap, LOCAL_LOT_SIZE, rotateMask, type LocalMap } from "../src/render/localMap";
import type { ReportEntry } from "../src/sim/report";
import { addBusiness } from "../src/sim/systems/businesses";
import { localViewModel, mapViewModel, moodMarker, zoneMarkers } from "../src/ui/viewModel";
import { baseData, newState, PLAYER } from "./helpers";

const N = 1;
const E = 2;
const S = 4;
const W = 8;

function problemsWith(change: (t: TilesExtraData) => void): string[] {
  const raw = structuredClone(BUNDLED_RAW_DATA) as RawGameData;
  change(raw.tilesExtra as TilesExtraData);
  try {
    parseGameData(raw);
  } catch (error) {
    if (error instanceof DataValidationError) return error.problems;
    throw error;
  }
  return [];
}

const allMaps = () => baseData.zones.map((z) => generateLocalMap(baseData, z.id));

/** Tiles that new elements must leave alone: lot areas and the space around exits. */
function reservedTiles(map: LocalMap): Set<string> {
  const reserved = new Set<string>();
  for (const lot of map.lots) {
    for (let y = lot.y; y < lot.y + LOCAL_LOT_SIZE; y++) for (let x = lot.x; x < lot.x + LOCAL_LOT_SIZE; x++) reserved.add(`${x},${y}`);
  }
  for (const exit of map.exits) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) reserved.add(`${exit.x + dx},${exit.y + dy}`);
  return reserved;
}

describe("tiles propios (tiles-extra.json)", () => {
  it("el JSON real pasa la validación", () => {
    expect(problemsWith(() => {})).toEqual([]);
    expect(Object.keys(baseData.tilesExtra.tiles)).toEqual(
      expect.arrayContaining(["club_hq", "sheriff_office", "gas_station", "motel", "bar_sign", "bike_side", "bike_rider_side", "bike_front", "bike_rider_front"]),
    );
  });

  it("rechaza con un mensaje claro un tile con una fila de 15 caracteres", () => {
    const problems = problemsWith((t) => {
      t.tiles.club_hq!.pixels[3] = ".".repeat(15);
    });
    expect(problems.join("\n")).toMatch(/tiles-extra\.json › tiles\.club_hq\.pixels: la fila 4 tiene 15 caracteres y tienen que ser 16/);
  });

  it("rechaza con un mensaje claro un carácter inválido", () => {
    const problems = problemsWith((t) => {
      t.tiles.motel!.pixels[0] = "#######x........";
    });
    expect(problems.join("\n")).toMatch(/tiles-extra\.json › tiles\.motel\.pixels: la fila 1 tiene caracteres inválidos \("x"\): solo valen "#" y "\."/);
  });

  it("rechaza un tile con filas de menos y un glyph de más de un carácter", () => {
    const problems = problemsWith((t) => {
      t.tiles.bar_sign!.pixels.pop();
      t.tiles.bar_sign!.glyph = "YY";
    }).join("\n");
    expect(problems).toMatch(/bar_sign\.pixels: tiene 15 filas y tienen que ser 16/);
    expect(problems).toMatch(/bar_sign\.glyph: el glyph tiene que ser un solo carácter/);
  });

  it("la conversión a píxeles da 16×16, blanco donde hay # y transparente donde hay .", () => {
    for (const tile of Object.values(baseData.tilesExtra.tiles)) {
      const grid = extraTilePixels(tile);
      expect(grid).toHaveLength(16);
      grid.forEach((row, y) => {
        expect(row).toHaveLength(16);
        row.forEach((c, x) => expect(c).toBe(tile.pixels[y]![x] === "#" ? EXTRA_TILE_INK : null));
      });
    }
  });
});

describe("autotiling de rutas (máscara de 4 vecinos)", () => {
  const asphalt = baseData.ui.localMap.autotile.asphalt.pieces;
  const dirt = baseData.ui.localMap.autotile.dirt.pieces;

  it("rotar la máscara un cuarto de vuelta lleva N→E→S→W→N", () => {
    expect(rotateMask(N, 1)).toBe(E);
    expect(rotateMask(W, 1)).toBe(N);
    expect(rotateMask(N | E, 2)).toBe(S | W);
    expect(rotateMask(N | E | S, 4)).toBe(N | E | S);
  });

  it("elige la pieza y la rotación que conectan con los vecinos", () => {
    expect(autotile(asphalt, N | S)).toEqual({ sprite: "asphalt_straight", rotation: 0 });
    expect(autotile(asphalt, E | W)).toEqual({ sprite: "asphalt_straight", rotation: 1 });
    expect(autotile(asphalt, N | E | S | W)).toEqual({ sprite: "asphalt_cross", rotation: 0 });
    expect(autotile(asphalt, N).sprite).toBe("asphalt_end");
    for (let mask = 1; mask < 16; mask++) {
      const piece = autotile(asphalt, mask);
      const base = asphalt.find((p) => p.sprite === piece.sprite)!;
      expect(rotateMask(connectionMask(base.connects), piece.rotation), `máscara ${mask}`).toBe(mask);
    }
  });

  it("el camino de tierra no tiene punta: un callejón sin salida usa la recta en su eje", () => {
    expect(autotile(dirt, E)).toEqual({ sprite: "dirt_road_straight", rotation: 1 });
    expect(autotile(dirt, S)).toEqual({ sprite: "dirt_road_straight", rotation: 0 });
    expect(autotile(dirt, N | E).sprite).toBe("dirt_road_curve");
  });

  it("en los mapas, cada tramo de ruta conecta con las rutas vecinas", () => {
    for (const map of allMaps()) {
      map.tiles.forEach((row, y) =>
        row.forEach((cell, x) => {
          if (cell.terrain !== "road" || !cell.road) return;
          const pieces = baseData.ui.localMap.autotile[cell.road].pieces;
          const base = pieces.find((p) => p.sprite === cell.sprite);
          expect(base, `${map.zoneId} ${x},${y}`).toBeDefined();
          const road = (nx: number, ny: number) => map.tiles[ny]?.[nx] === undefined || map.tiles[ny]![nx]!.terrain === "road";
          const mask = (road(x, y - 1) ? N : 0) | (road(x + 1, y) ? E : 0) | (road(x, y + 1) ? S : 0) | (road(x - 1, y) ? W : 0);
          const covered = rotateMask(connectionMask(base!.connects), cell.rotation);
          if (pieces.some((p) => [0, 1, 2, 3].some((k) => rotateMask(connectionMask(p.connects), k) === mask))) {
            expect(covered, `${map.zoneId} ${x},${y}`).toBe(mask);
          }
        }),
      );
    }
  });
});

describe("mapa local expandido", () => {
  it("es determinista: la misma zona genera los mismos elementos en las mismas posiciones", () => {
    for (const zone of baseData.zones) expect(generateLocalMap(baseData, zone.id)).toEqual(generateLocalMap(baseData, zone.id));
  });

  it("cada sprite existe en ui.json y cada glifo se puede dibujar en modo ASCII", () => {
    const { sprites } = baseData.ui.localMap;
    for (const map of allMaps()) {
      for (const cell of map.tiles.flat()) {
        if (cell.sprite) expect(sprites[cell.sprite], cell.sprite).toBeDefined();
        expect(cell.glyph >= " " && cell.glyph <= "~", cell.glyph).toBe(true);
      }
      for (const l of map.landmarks) {
        expect(baseData.tilesExtra.tiles[l.sprite.replace("extra.", "")], l.sprite).toBeDefined();
        expect(l.glyph).toBe(baseData.tilesExtra.tiles[l.sprite.replace("extra.", "")]!.glyph);
      }
    }
  });

  it("árboles, edificios y suelo usan variantes según el tipo de zona", () => {
    const { variants } = baseData.ui.localMap;
    const rural = generateLocalMap(baseData, "zone_dry_creek").tiles.flat();
    const trees = new Set(rural.filter((t) => t.terrain === "tree").map((t) => t.sprite));
    expect(trees.size).toBeGreaterThan(1);
    for (const s of trees) expect(variants.tree!.rural).toContain(s);
    const road = generateLocalMap(baseData, "zone_route9_south").tiles.flat();
    for (const t of road.filter((t) => t.terrain === "tree")) expect(variants.tree!.road).toContain(t.sprite);
    const town = generateLocalMap(baseData, "zone_redwater").tiles.flat();
    expect(new Set(town.filter((t) => t.terrain === "building").map((t) => t.sprite)).size).toBeGreaterThan(3);
    expect(town.some((t) => t.terrain === "sidewalk")).toBe(true);
  });

  it("las vías de la zona industrial corren horizontales (sprite rotado)", () => {
    const rails = generateLocalMap(baseData, "zone_gravel_pit").tiles.flat().filter((t) => t.terrain === "rail");
    expect(rails.length).toBeGreaterThan(0);
    for (const r of rails) expect(r).toMatchObject({ sprite: "rails", rotation: 1 });
  });

  it("cada lote tiene cerco atrás y una esquina libre del lado de la calle para el cartel", () => {
    for (const map of allMaps()) {
      for (const lot of map.lots) {
        const { x, y } = lot.signSpot;
        expect([lot.x, lot.x + LOCAL_LOT_SIZE - 1]).toContain(x);
        expect([lot.y, lot.y + LOCAL_LOT_SIZE - 1]).toContain(y);
        expect(map.tiles[y]![x]!.terrain).not.toBe("fence");
        const backRow = y === lot.y ? lot.y + LOCAL_LOT_SIZE - 1 : lot.y;
        for (let fx = lot.x; fx < lot.x + LOCAL_LOT_SIZE; fx++) expect(map.tiles[backRow]![fx]!.terrain).toBe("fence");
      }
    }
  });

  it("la sede aparece en la zona hqZoneId de cada club y del sheriff, con el color de su facción", () => {
    for (const faction of baseData.factions.filter((f) => f.kind === "club" || f.kind === "sheriff")) {
      const map = generateLocalMap(baseData, faction.hqZoneId!);
      const hq = map.landmarks.filter((l) => l.factionId === faction.id && (l.kind === "club_hq" || l.kind === "sheriff_hq"));
      expect(hq, faction.id).toHaveLength(1);
      expect(hq[0]!.sprite).toBe(faction.kind === "club" ? "extra.club_hq" : "extra.sheriff_office");
      const bikes = map.landmarks.filter((l) => l.kind === "parked_bike" && l.factionId === faction.id);
      if (faction.kind === "club") {
        expect(bikes.map((b) => [b.x, b.y])).toEqual([
          [hq[0]!.x + 1, hq[0]!.y],
          [hq[0]!.x + 2, hq[0]!.y],
        ]);
      } else expect(bikes).toHaveLength(0);
    }
  });

  it("las zonas que no son sede de nadie no tienen sede", () => {
    const hqZones = new Set(baseData.factions.filter((f) => f.kind === "club" || f.kind === "sheriff").map((f) => f.hqZoneId));
    for (const map of allMaps().filter((m) => !hqZones.has(m.zoneId))) {
      expect(map.landmarks.filter((l) => l.kind === "club_hq" || l.kind === "sheriff_hq" || l.kind === "parked_bike"), map.zoneId).toEqual([]);
    }
  });

  it("la gasolinera y el motel aparecen solo en zonas de ruta, junto a la ruta", () => {
    for (const map of allMaps()) {
      const type = baseData.zones.find((z) => z.id === map.zoneId)!.type;
      const roadside = map.landmarks.filter((l) => l.kind === "gas_station" || l.kind === "motel");
      if (type !== "road") {
        expect(roadside, map.zoneId).toEqual([]);
        continue;
      }
      expect(roadside.map((l) => l.kind).sort(), map.zoneId).toEqual(["gas_station", "motel"]);
      for (const l of roadside) {
        const nextToRoad = [map.tiles[l.y - 1]?.[l.x], map.tiles[l.y + 1]?.[l.x]].some((t) => t?.terrain === "road");
        expect(nextToRoad, `${map.zoneId} ${l.kind}`).toBe(true);
      }
    }
  });

  it("ningún elemento nuevo pisa lotes, salidas, rutas ni agua", () => {
    for (const map of allMaps()) {
      const reserved = reservedTiles(map);
      const seen = new Set<string>();
      for (const l of map.landmarks) {
        const key = `${l.x},${l.y}`;
        expect(reserved.has(key), `${map.zoneId} ${l.kind} ${key}`).toBe(false);
        expect(seen.has(key), `${map.zoneId} ${l.kind} superpuesto`).toBe(false);
        seen.add(key);
        expect(["road", "water", "dock", "boat", "rail"]).not.toContain(map.tiles[l.y]![l.x]!.terrain);
        expect(map.memberSpots.some((p) => p.x === l.x && p.y === l.y), `${map.zoneId} ${l.kind}`).toBe(false);
      }
    }
  });
});

describe("marcadores del mapa político", () => {
  it("las tareas planeadas marcan su zona (corrida de armas, plata, combate)", () => {
    const markers = zoneMarkers(newState(), baseData, PLAYER, {
      plannedTasks: [
        { taskId: "task_gun_run", zoneId: "zone_crossing" },
        { taskId: "task_collect_protection", zoneId: "zone_redwater" },
        { taskId: "task_attack_business", zoneId: "zone_millbrook" },
        { taskId: "task_guard_zone", zoneId: "zone_cedar_flats" },
      ],
    });
    expect(markers.zone_crossing?.map((m) => m.spriteId)).toEqual(["marker.gun_run"]);
    expect(markers.zone_redwater?.map((m) => m.spriteId)).toEqual(["marker.money"]);
    expect(markers.zone_millbrook?.map((m) => m.spriteId)).toEqual(["marker.combat"]);
    expect(markers.zone_cedar_flats).toBeUndefined();
  });

  it("los combates de la semana pasada marcan combate y, si hubo muertos, muerte", () => {
    const entry = (deaths: number, zoneId: string): ReportEntry => ({ stage: "combat", key: "report.combat.attacker_won", params: { zoneId, deaths }, factionId: null });
    const markers = zoneMarkers(newState(), baseData, PLAYER, { lastReport: [entry(1, "zone_crossing"), entry(0, "zone_redwater")] });
    expect(markers.zone_crossing?.map((m) => m.spriteId)).toEqual(["marker.death", "marker.combat"]);
    expect(markers.zone_redwater?.map((m) => m.spriteId)).toEqual(["marker.combat"]);
  });

  it("un allanamiento avisado marca la zona del negocio (solo para su dueño)", () => {
    const state = newState();
    const b = addBusiness(state, baseData, PLAYER, "business_club_bar", "zone_redwater");
    b.raidWarned = true;
    expect(zoneMarkers(state, baseData, PLAYER).zone_redwater?.map((m) => m.spriteId)).toEqual(["marker.raid_warned"]);
    expect(zoneMarkers(state, baseData, "faction_grim_wolves").zone_redwater).toBeUndefined();
  });

  it("como mucho ui.markers.max marcadores por zona, sin repetir", () => {
    const planned = ["task_gun_run", "task_collect_protection", "task_attack_business", "task_retail", "task_gun_run"].map((taskId) => ({ taskId, zoneId: "zone_crossing" }));
    const lastReport: ReportEntry[] = [{ stage: "combat", key: "report.combat.defender_won", params: { zoneId: "zone_crossing", deaths: 2 }, factionId: null }];
    const list = zoneMarkers(newState(), baseData, PLAYER, { plannedTasks: planned, lastReport }).zone_crossing!;
    expect(list).toHaveLength(baseData.ui.markers.max);
    expect(new Set(list.map((m) => m.spriteId)).size).toBe(list.length);
  });

  it("la cara de ánimo según la lealtad media aparece en la sede del club", () => {
    const state = newState();
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER) m.loyalty = 10;
    expect(moodMarker(state, baseData, PLAYER)?.spriteId).toBe("marker.mood_angry");
    for (const m of Object.values(state.members)) if (m.factionId === PLAYER) m.loyalty = 90;
    expect(moodMarker(state, baseData, PLAYER)?.spriteId).toBe("marker.mood_great");
    const vm = mapViewModel(state, baseData, PLAYER, null);
    expect(vm.zones.zone_redwater?.mood?.spriteId).toBe("marker.mood_great");
    expect(vm.zones.zone_millbrook?.mood).toBeNull();
  });

  it("un bar cuelga su cartel en el lote y otros negocios no", () => {
    const state = newState();
    addBusiness(state, baseData, PLAYER, "business_club_bar", "zone_redwater", 0);
    addBusiness(state, baseData, PLAYER, "business_garage", "zone_redwater", 1);
    const lots = localViewModel(state, baseData, PLAYER, "zone_redwater", null, []).lots;
    expect(lots.map((l) => l.sign)).toEqual([true, false, false]);
  });
});

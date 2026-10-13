// Cross-file checks that a single zod schema can't express:
// unique IDs, references between files, map symmetry, balance ranges and
// that every piece of content has its Spanish string.

import { MEMBER_STATUSES, RANKS, STAT_KEYS, TRAITS, ZONE_TYPES } from "../sim/state";
import type { GameData } from "./schemas";

type Range = { min: number; max: number };

function inRange(value: number, range: Range): boolean {
  return value >= range.min && value <= range.max;
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

/** Every string key the content needs. Exported so the UI and tests use the same convention. */
export function requiredStringKeys(data: GameData): string[] {
  return [
    ...ZONE_TYPES.map((t) => `zone_type.${t}`),
    ...RANKS.map((r) => `rank.${r}`),
    ...TRAITS.map((t) => `trait.${t}`),
    ...MEMBER_STATUSES.map((s) => `status.${s}`),
    ...STAT_KEYS.map((k) => `stat.${k}`),
    ...data.tasks.map((t) => `task.${t.id}`),
    ...data.goods.map((g) => `good.${g.id}`),
    ...data.businesses.map((b) => `business.${b.id}`),
    ...data.events.flatMap((e) => [
      `event.${e.id}.title`,
      `event.${e.id}.text`,
      ...e.options.map((o) => `event.${e.id}.option.${o.id}`),
    ]),
  ];
}

/**
 * Readable problems of a 1-bit tile drawn as text (tiles-extra.json): `size` rows of `size` characters, only "#"
 * and ".". The zod schema calls it, so a broken tile is rejected saying which row and why.
 */
export function extraTilePixelProblems(rows: readonly string[], size: number): string[] {
  const problems: string[] = [];
  if (rows.length !== size) problems.push(`tiene ${rows.length} filas y tienen que ser ${size}`);
  rows.forEach((row, i) => {
    if (row.length !== size) problems.push(`la fila ${i + 1} tiene ${row.length} caracteres y tienen que ser ${size}`);
    const bad = [...new Set(row.replace(/[#.]/g, ""))];
    if (bad.length > 0) problems.push(`la fila ${i + 1} tiene caracteres inválidos (${bad.map((c) => `"${c}"`).join(", ")}): solo valen "#" y "."`);
  });
  return problems;
}

/** Returns a list of human-readable problems. Empty list = valid. */
export function validateGameData(data: GameData): string[] {
  const errors: string[] = [];
  const { ranges } = data.balance;

  // Unique IDs per file
  const files: Array<[string, readonly { id: string }[]]> = [
    ["zones.json", data.zones],
    ["factions.json", data.factions],
    ["members.json", data.members],
    ["tasks.json", data.tasks],
    ["goods.json", data.goods],
    ["businesses.json", data.businesses],
    ["events.json", data.events],
  ];
  for (const [file, items] of files) {
    for (const dupe of findDuplicates(items.map((i) => i.id))) {
      errors.push(`${file}: id repetido "${dupe}"`);
    }
  }

  const zoneIds = new Set(data.zones.map((z) => z.id));
  const factionIds = new Set(data.factions.map((f) => f.id));

  // Zones
  for (const zone of data.zones) {
    const where = `zones.json › ${zone.id}`;
    for (const adj of zone.adjacent) {
      if (adj === zone.id) {
        errors.push(`${where}: una zona no puede ser adyacente a sí misma`);
      } else if (!zoneIds.has(adj)) {
        errors.push(`${where}: zona adyacente desconocida "${adj}"`);
      } else {
        const other = data.zones.find((z) => z.id === adj);
        if (other && !other.adjacent.includes(zone.id)) {
          errors.push(`${where}: la adyacencia con "${adj}" no es simétrica`);
        }
      }
    }
    if (!inRange(zone.wealth, ranges.wealth)) errors.push(`${where}: wealth ${zone.wealth} fuera de rango`);
    if (!inRange(zone.policePresence, ranges.policePresence))
      errors.push(`${where}: policePresence ${zone.policePresence} fuera de rango`);
    if (!inRange(zone.businessSlots, ranges.businessSlots))
      errors.push(`${where}: businessSlots ${zone.businessSlots} fuera de rango`);
    if (!inRange(zone.initialHeat, ranges.heat)) errors.push(`${where}: initialHeat ${zone.initialHeat} fuera de rango`);
    for (const [factionId, value] of Object.entries(zone.initialControl)) {
      if (!factionIds.has(factionId)) errors.push(`${where}: facción desconocida en initialControl "${factionId}"`);
      if (!inRange(value, ranges.control)) errors.push(`${where}: control de "${factionId}" = ${value} fuera de rango`);
    }
  }

  // Map drawing: zone boxes (3×3) and labels (row below the box) must fit, and boxes can't overlap
  const { width, height } = data.ui.map;
  for (const zone of data.zones) {
    const { x, y } = zone.position;
    const halfLabel = Math.ceil(zone.shortName.length / 2);
    if (x - Math.max(1, halfLabel) < 0 || x + Math.max(1, halfLabel) >= width || y - 1 < 0 || y + 2 >= height) {
      errors.push(`zones.json › ${zone.id}: la posición (${x}, ${y}) queda fuera del mapa de ${width}×${height}`);
    }
    for (const other of data.zones) {
      if (other.id <= zone.id) continue;
      if (Math.abs(other.position.x - x) < 3 && Math.abs(other.position.y - y) < 4) {
        errors.push(`zones.json › ${zone.id}: se superpone en el mapa con "${other.id}"`);
      }
    }
  }

  // Every zone type and business has a sprite (else the tile view would mix in ASCII)
  for (const type of new Set(data.zones.map((z) => z.type))) {
    if (!(`zone_type.${type}` in data.ui.tileset.sprites)) errors.push(`ui.json: falta el sprite "zone_type.${type}"`);
  }
  for (const b of data.businesses) {
    if (!(`business.${b.id}` in data.ui.tileset.sprites)) errors.push(`ui.json: falta el sprite "business.${b.id}"`);
  }

  // Map connectivity: every zone reachable from the first one
  const firstZone = data.zones[0];
  if (firstZone) {
    const reached = new Set<string>([firstZone.id]);
    const queue = [firstZone.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      const current = data.zones.find((z) => z.id === currentId);
      for (const adj of current?.adjacent ?? []) {
        if (zoneIds.has(adj) && !reached.has(adj)) {
          reached.add(adj);
          queue.push(adj);
        }
      }
    }
    for (const id of zoneIds) {
      if (!reached.has(id)) errors.push(`zones.json › ${id}: zona desconectada del resto del mapa`);
    }
  }

  // Factions
  for (const faction of data.factions) {
    const where = `factions.json › ${faction.id}`;
    if (faction.hqZoneId !== null && !zoneIds.has(faction.hqZoneId)) {
      errors.push(`${where}: sede en zona desconocida "${faction.hqZoneId}"`);
    }
    if (faction.aiProfile !== null && !(faction.aiProfile in data.ai.profiles)) {
      errors.push(`${where}: perfil de IA desconocido "${faction.aiProfile}"`);
    }
    for (const [otherId, value] of Object.entries(faction.initialRelations)) {
      if (otherId === faction.id) errors.push(`${where}: no puede tener relación consigo misma`);
      else if (!factionIds.has(otherId)) errors.push(`${where}: relación con facción desconocida "${otherId}"`);
      if (!inRange(value, ranges.relation)) errors.push(`${where}: relación con "${otherId}" = ${value} fuera de rango`);
    }
  }

  // Members
  for (const member of data.members) {
    const where = `members.json › ${member.id}`;
    if (!factionIds.has(member.factionId)) errors.push(`${where}: facción desconocida "${member.factionId}"`);
    for (const key of STAT_KEYS) {
      if (!inRange(member.stats[key], ranges.stat)) errors.push(`${where}: ${key} ${member.stats[key]} fuera de rango`);
    }
    if (!inRange(member.loyalty, ranges.loyalty)) errors.push(`${where}: loyalty ${member.loyalty} fuera de rango`);
  }

  // Balance references
  if (!factionIds.has(data.balance.victory.rivalToExpel)) {
    errors.push(`balance.json: victory.rivalToExpel apunta a una facción desconocida "${data.balance.victory.rivalToExpel}"`);
  }
  if (!data.factions.some((f) => f.kind === "sheriff")) errors.push("factions.json: falta una facción de tipo sheriff");
  const { arrest, tasks } = data.balance;
  if (arrest.minChance > arrest.maxChance) errors.push("balance.json: arrest.minChance > arrest.maxChance");
  if (arrest.jailWeeksMin > arrest.jailWeeksMax) errors.push("balance.json: arrest.jailWeeksMin > arrest.jailWeeksMax");
  if (!data.goods.some((g) => g.id === tasks.stealBikes.goodId)) {
    errors.push(`balance.json: tasks.stealBikes.goodId apunta a un bien desconocido "${tasks.stealBikes.goodId}"`);
  }
  if (tasks.stealBikes.min > tasks.stealBikes.max) errors.push("balance.json: tasks.stealBikes.min > max");
  if (!inRange(tasks.recruit.statMin, ranges.stat) || !inRange(tasks.recruit.statMax, ranges.stat) || tasks.recruit.statMin > tasks.recruit.statMax) {
    errors.push("balance.json: tasks.recruit.statMin/statMax fuera del rango de stats");
  }
  if (!inRange(tasks.recruit.startingLoyalty, ranges.loyalty)) errors.push("balance.json: tasks.recruit.startingLoyalty fuera de rango");

  // Businesses, goods and events reference real things
  const goodIds = new Set(data.goods.map((g) => g.id));
  for (const b of data.businesses) {
    for (const id of [b.processor?.inputGoodId, b.processor?.outputGoodId, b.workshop?.inputGoodId, b.workshop?.outputGoodId, b.storage?.goodId]) {
      if (id !== undefined && id !== null && !goodIds.has(id)) errors.push(`businesses.json › ${b.id}: bien desconocido "${id}"`);
    }
    if (b.workshop && !data.tasks.some((t) => t.id === b.workshop!.workTaskId)) {
      errors.push(`businesses.json › ${b.id}: tarea de trabajo desconocida "${b.workshop.workTaskId}"`);
    }
  }
  for (const g of data.goods) {
    if ((g.basePrice === null) !== (g.saleCurrency === null)) errors.push(`goods.json › ${g.id}: basePrice y saleCurrency van juntos`);
  }
  if (!goodIds.has(data.balance.tasks.gunRun.goodId)) errors.push(`balance.json: tasks.gunRun.goodId desconocido`);
  for (const goodId of Object.keys(data.balance.cartel.catalog)) {
    if (!goodIds.has(goodId)) errors.push(`balance.json: el catálogo del cartel tiene un bien desconocido "${goodId}"`);
  }
  if (!zoneIds.has(data.balance.cartel.portZoneId)) errors.push(`balance.json: cartel.portZoneId desconocido`);
  if (!data.factions.some((f) => f.kind === "cartel")) errors.push("factions.json: falta una facción de tipo cartel");
  for (const e of data.events) {
    if (!e.options.some((o) => o.id === e.defaultOption)) errors.push(`events.json › ${e.id}: defaultOption no es una opción`);
    const walk = (effects: (typeof e.options)[number]["effects"]): void => {
      for (const fx of effects) {
        if (fx.type === "heat" && !zoneIds.has(fx.zoneId)) errors.push(`events.json › ${e.id}: zona desconocida "${fx.zoneId}"`);
        if (fx.type === "chance") {
          walk(fx.success);
          walk(fx.failure);
        }
      }
    };
    for (const o of e.options) walk(o.effects);
  }
  for (const [name, profile] of Object.entries(data.ai.profiles)) {
    for (const z of profile.allowedZones ?? []) if (!zoneIds.has(z)) errors.push(`ai.json › ${name}: zona desconocida "${z}"`);
  }

  // Patches: well-formed emblems, known parts, unique designs; factions use existing patches
  const { patches } = data;
  for (const [id, rows] of Object.entries(patches.emblems)) {
    if (rows.length !== patches.emblemSize || rows.some((r) => r.length !== patches.emblemSize || /[^#.]/.test(r))) {
      errors.push(`patches.json › emblema "${id}": tiene que ser de ${patches.emblemSize}×${patches.emblemSize} con "#" y "."`);
    }
  }
  const designs = new Set<string>();
  for (const p of patches.patches) {
    if (!(p.emblem in patches.emblems)) errors.push(`patches.json › ${p.id}: emblema desconocido "${p.emblem}"`);
    if (!(p.palette in patches.palettes)) errors.push(`patches.json › ${p.id}: paleta desconocida "${p.palette}"`);
    const design = `${p.emblem}|${p.shape}|${p.palette}`;
    if (designs.has(design)) errors.push(`patches.json › ${p.id}: diseño repetido`);
    designs.add(design);
  }
  for (const f of data.factions) {
    if (f.patchId !== null && !patches.patches.some((p) => p.id === f.patchId)) errors.push(`factions.json › ${f.id}: parche desconocido "${f.patchId}"`);
  }
  for (const k of Object.keys(patches.emblems)) if (!(`patch_emblem.${k}` in data.strings)) errors.push(`strings.es.json: falta el texto "patch_emblem.${k}"`);
  for (const k of Object.keys(patches.palettes)) if (!(`patch_palette.${k}` in data.strings)) errors.push(`strings.es.json: falta el texto "patch_palette.${k}"`);

  // Portraits: every piece is size×size with "#" and ".", known inks, vests and tabs; the patch fits
  const { portraits } = data;
  const pieceProblem = (where: string, rows: string[]): void => {
    if (rows.length !== portraits.size || rows.some((r) => r.length !== portraits.size || /[^#.]/.test(r))) {
      errors.push(`portraits.json › ${where}: tiene que ser de ${portraits.size}×${portraits.size} con "#" y "."`);
    }
  };
  for (const layer of [...portraits.under, ...portraits.over]) {
    if (!(layer.ink in portraits.inks)) errors.push(`portraits.json › capa "${layer.id}": tinta desconocida "${layer.ink}"`);
    if (Object.keys(layer.pieces).length === 0) errors.push(`portraits.json › capa "${layer.id}": no tiene piezas`);
    for (const [id, rows] of Object.entries(layer.pieces)) pieceProblem(`capa "${layer.id}" › pieza "${id}"`, rows);
  }
  if (!(portraits.vestInk in portraits.inks)) errors.push(`portraits.json › vestInk: tinta desconocida "${portraits.vestInk}"`);
  for (const [id, rows] of Object.entries(portraits.vests)) pieceProblem(`chaleco "${id}"`, rows);
  for (const [id, rows] of Object.entries(portraits.tabs)) pieceProblem(`insignia "${id}"`, rows);
  for (const [status, overlay] of Object.entries(portraits.status.overlays)) pieceProblem(`estado "${status}"`, overlay.pixels);
  for (const [rank, def] of Object.entries(portraits.ranks)) {
    if (!(def.vest in portraits.vests)) errors.push(`portraits.json › rango ${rank}: chaleco desconocido "${def.vest}"`);
    if (def.tab !== null && !(def.tab in portraits.tabs)) errors.push(`portraits.json › rango ${rank}: insignia desconocida "${def.tab}"`);
    if ((def.tab === null) !== (def.tabInk === null)) errors.push(`portraits.json › rango ${rank}: tab y tabInk van juntos`);
  }
  const slot = portraits.patchSlot;
  if (slot.x + slot.size > portraits.size || slot.y + slot.size > portraits.size) errors.push("portraits.json › patchSlot: el parche se sale del retrato");

  // Map sprites (ui.json, tiles-extra.json): every reference exists and every glyph is in the bitmap font
  const { ui, tilesExtra } = data;
  const local = ui.localMap;
  const asciiOk = (ch: string) => ch.length === 1 && ch >= " " && ch <= "~";
  const extraIds = new Set(Object.keys(tilesExtra.tiles).map((id) => `extra.${id}`));
  for (const [id, tile] of Object.entries(tilesExtra.tiles)) {
    if (!asciiOk(tile.glyph)) errors.push(`tiles-extra.json › ${id}: el glyph "${tile.glyph}" no está en la fuente ASCII`);
  }
  for (const id of Object.keys(local.sprites)) {
    const g = local.glyphs[id];
    if (g === undefined) errors.push(`ui.json › localMap.glyphs: falta el glifo de "${id}" para el modo ASCII`);
    else if (!asciiOk(g)) errors.push(`ui.json › localMap.glyphs › ${id}: "${g}" no está en la fuente ASCII`);
  }
  const localSprite = (id: string, where: string) => {
    if (!(id in local.sprites)) errors.push(`ui.json › localMap.${where}: sprite desconocido "${id}"`);
  };
  for (const [terrain, byType] of Object.entries(local.variants)) {
    for (const [type, ids] of Object.entries(byType)) {
      if (type !== "*" && !(ZONE_TYPES as readonly string[]).includes(type)) errors.push(`ui.json › localMap.variants.${terrain}: tipo de zona desconocido "${type}"`);
      for (const id of ids) localSprite(id, `variants.${terrain}.${type}`);
    }
  }
  for (const [kind, set] of Object.entries(local.autotile)) {
    for (const piece of set.pieces) localSprite(piece.sprite, `autotile.${kind}`);
    if (!set.pieces.some((p) => p.connects.length === 2 && p.connects !== "NS" && p.connects !== "EW")) errors.push(`ui.json › localMap.autotile.${kind}: falta una curva`);
    for (const g of Object.values(set.glyphs)) if (!asciiOk(g)) errors.push(`ui.json › localMap.autotile.${kind}: "${g}" no está en la fuente ASCII`);
  }
  localSprite(local.rails.sprite, "rails");
  for (const id of Object.values(local.lotFence)) localSprite(id, "lotFence");
  for (const [key, id] of Object.entries(local.landmarks)) {
    if (typeof id === "string" && !extraIds.has(id)) errors.push(`ui.json › localMap.landmarks.${key}: no existe "${id}" en tiles-extra.json`);
  }
  for (const id of Object.keys(ui.tileset.sprites).filter((id) => id.startsWith("marker."))) {
    if (!(id in ui.tileset.glyphs)) errors.push(`ui.json › tileset.glyphs: falta el glifo de "${id}" para el modo ASCII`);
  }
  for (const [id, g] of Object.entries(ui.tileset.glyphs)) if (!asciiOk(g)) errors.push(`ui.json › tileset.glyphs › ${id}: "${g}" no está en la fuente ASCII`);
  const markerIds = [...Object.values(ui.markers.tasks), ...ui.markers.mood.map((m) => m.sprite)];
  for (const id of markerIds) {
    if (!(id in ui.tileset.sprites)) errors.push(`ui.json › markers: sprite desconocido "${id}"`);
    if (!(id in ui.markers.colors)) errors.push(`ui.json › markers.colors: falta el color de "${id}"`);
  }
  for (const taskId of Object.keys(ui.markers.tasks)) if (!data.tasks.some((t) => t.id === taskId)) errors.push(`ui.json › markers.tasks: tarea desconocida "${taskId}"`);
  if (!ui.markers.mood.some((m) => m.min <= data.balance.ranges.loyalty.min)) errors.push("ui.json › markers.mood: falta una cara para la lealtad más baja");

  // Trait task lists point to real tasks
  const taskIds = new Set(data.tasks.map((t) => t.id));
  for (const [trait, affinity] of Object.entries(data.traits.tasks)) {
    for (const id of [...affinity.likes, ...affinity.dislikes]) {
      if (!taskIds.has(id)) errors.push(`traits.json › ${trait}: tarea desconocida "${id}"`);
    }
  }

  // Strings
  for (const key of requiredStringKeys(data)) {
    if (!(key in data.strings)) errors.push(`strings.es.json: falta el texto "${key}"`);
  }

  return errors;
}

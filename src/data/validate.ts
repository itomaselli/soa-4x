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

  // Strings
  for (const key of requiredStringKeys(data)) {
    if (!(key in data.strings)) errors.push(`strings.es.json: falta el texto "${key}"`);
  }

  return errors;
}

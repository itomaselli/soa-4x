// Heat and law (GDD §10), resolved in this order:
//   1. crackdowns (heat ≥ 85): members who acted in the zone this week may be arrested; heat drops
//   2. raids (heat ≥ 60): illegal businesses may be shut down; a friendly sheriff warns first
//   3. police presence follows sustained heat (up while ≥ raid threshold, back to base when calm)
//   4. federal investigation per club: hot zones and informants push it up, a clean week pulls it down
//   5. the sheriff's goodwill fades a little every week
//   6. natural heat decay and patrol warnings

import { factionName, sheriffId, zoneName, type TurnContext } from "../context";
import type { GameState } from "../state";
import { clamp } from "../util";
import { storageCapacity } from "./businesses";
import { controlOf } from "./control";
import { factionMembers, memberLabel } from "./members";
import { jail } from "./tasks";

export function resolveHeat(state: GameState, ctx: TurnContext): void {
  crackdowns(state, ctx);
  raids(state, ctx);
  policeDrift(state, ctx);
  federalInvestigation(state, ctx);
  sheriffDecay(state, ctx);
  heatDecay(state, ctx);
}

function crackdowns(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const zone of Object.values(state.zones)) {
    if (zone.heat < balance.heat.crackdownThreshold) continue;
    const arrested: string[] = [];
    for (const [memberId, where] of Object.entries(ctx.scratch.memberTasks).sort((a, b) => a[0].localeCompare(b[0]))) {
      const member = state.members[memberId];
      if (where.zoneId !== zone.id || !member || member.status !== "active") continue;
      if (ctx.rng.chance(balance.law.crackdownArrestChance)) {
        jail(member, ctx);
        arrested.push(memberLabel(member));
      }
    }
    zone.heat = clamp(zone.heat - balance.law.crackdownHeatDrop, balance.ranges.heat);
    ctx.report("report.law.crackdown", { zone: zoneName(ctx.data, zone.id), count: arrested.length, names: arrested.join(", ") || "—" });
  }
}

function raids(state: GameState, ctx: TurnContext): void {
  const { balance, businesses } = ctx.data;
  const sheriff = sheriffId(ctx.data);
  const kept = [];
  const lostStorage: { factionId: string; goodId: string }[] = [];
  for (const business of state.businesses) {
    const def = businesses.find((b) => b.id === business.typeId);
    const zone = state.zones[business.zoneId];
    if (!def || def.legal || !zone || zone.heat < balance.heat.raidThreshold) {
      kept.push(business);
      continue;
    }
    const goodwill = sheriff ? (state.factions[sheriff]?.relations[business.ownerFactionId] ?? 0) : 0;
    const params = { zone: zoneName(ctx.data, zone.id), businessKey: `business.${def.id}` };
    if (goodwill >= balance.law.sheriffWarnRelation && !business.raidWarned) {
      business.raidWarned = true;
      ctx.report("report.law.raid_warning", params, business.ownerFactionId);
      kept.push(business);
      continue;
    }
    if (ctx.rng.chance(balance.law.raidChance)) {
      ctx.report("report.law.raid", { ...params, owner: factionName(ctx.data, business.ownerFactionId) });
      if (def.storage) lostStorage.push({ factionId: business.ownerFactionId, goodId: def.storage.goodId });
      continue; // shut down
    }
    kept.push(business);
  }
  state.businesses = kept;
  // "Si se allana, perdés el stock": goods that no longer fit in the remaining warehouses are seized.
  for (const { factionId, goodId } of lostStorage) {
    const faction = state.factions[factionId];
    const capacity = storageCapacity(state, ctx.data, factionId, goodId) ?? 0;
    const held = faction?.stock[goodId] ?? 0;
    if (faction && held > capacity) {
      faction.stock[goodId] = capacity;
      ctx.report("report.law.raid_stock_lost", { quantity: held - capacity, goodKey: `good.${goodId}` }, factionId);
    }
  }
}

function policeDrift(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const zone of Object.values(state.zones)) {
    const base = ctx.data.zones.find((z) => z.id === zone.id)?.policePresence ?? zone.policePresence;
    if (zone.heat >= balance.heat.raidThreshold && zone.policePresence < balance.ranges.policePresence.max) {
      zone.policePresence += 1;
      ctx.report("report.law.police_up", { zone: zoneName(ctx.data, zone.id), police: zone.policePresence });
    } else if (zone.heat < balance.heat.patrolThreshold && zone.policePresence > base) {
      zone.policePresence -= 1;
    }
  }
}

function federalInvestigation(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  const f = balance.federal;
  for (const def of ctx.data.factions) {
    if (def.kind !== "club") continue;
    const faction = state.factions[def.id];
    if (!faction) continue;
    const before = faction.federal;
    const hotZones = Object.values(state.zones).filter(
      (z) => z.heat >= balance.heat.raidThreshold && controlOf(z, def.id) > 0,
    ).length;
    const informants = factionMembers(state, def.id).filter((m) => m.informant && m.status !== "dead").length;
    let delta = hotZones * f.perHotZone + informants * f.perInformant;
    if (!ctx.scratch.illegalFactions.has(def.id)) delta -= f.lowProfileDrop;
    faction.federal = clamp(faction.federal + delta, balance.ranges.federalInvestigation);

    if (faction.federal !== before && faction.federal >= f.visibleFrom) {
      ctx.report("report.law.federal", { value: Math.round(faction.federal), delta: Math.round((faction.federal - before) * 10) / 10 }, def.id);
    } else if (before < f.visibleFrom && faction.federal >= f.visibleFrom) {
      ctx.report("report.law.federal_visible", {}, def.id);
    }

    // A federal raid ends the player's game (checked at end of turn). AI clubs lose their active members to jail.
    if (def.id !== state.playerFactionId && faction.federal >= balance.ranges.federalInvestigation.max) {
      for (const m of factionMembers(state, def.id)) {
        if (m.status === "active" || m.status === "wounded") {
          m.status = "jailed";
          m.statusWeeks = balance.arrest.jailWeeksMax * 2;
        }
      }
      faction.federal = f.raidResetTo;
      ctx.report("report.law.federal_raid_ai", { faction: def.name });
    }
  }
}

function sheriffDecay(state: GameState, ctx: TurnContext): void {
  const sheriff = sheriffId(ctx.data);
  const relations = sheriff ? state.factions[sheriff]?.relations : undefined;
  if (!relations) return;
  const decay = ctx.data.balance.law.sheriffRelationDecay;
  for (const [id, value] of Object.entries(relations)) {
    relations[id] = value > 0 ? Math.max(0, value - decay) : Math.min(0, value + decay);
  }
}

function heatDecay(state: GameState, ctx: TurnContext): void {
  const { balance } = ctx.data;
  for (const zone of Object.values(state.zones)) {
    zone.heat = clamp(zone.heat - balance.heat.weeklyDecay, balance.ranges.heat);
    if (zone.heat >= balance.heat.patrolThreshold) {
      ctx.report("report.heat.patrols", { zone: zoneName(ctx.data, zone.id), heat: zone.heat });
    }
  }
  // Raid warnings are forgotten once the zone cools down below the raid threshold.
  for (const business of state.businesses) {
    const zone = state.zones[business.zoneId];
    if (zone && zone.heat < balance.heat.raidThreshold) business.raidWarned = false;
  }
}

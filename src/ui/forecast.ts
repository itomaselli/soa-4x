// Task forecast (phase 13): what a member would do with a task in a district, read with the engine's own formulas
// (stats, specialties, the zone's heat and wealth). Ranges and chances, never a promised result: the arrest roll,
// stolen bikes and recruiting are random, and other clubs act the same week.

import type { GameData } from "../data/schemas";
import type { GameState, MemberState } from "../sim/state";
import { businessDef } from "../sim/systems/businesses";
import { controlOf } from "../sim/systems/control";
import { atWar } from "../sim/systems/diplomacy";
import { marketPrice } from "../sim/systems/economy";
import { memberEffects } from "../sim/systems/perks";
import {
  guardAmount,
  gunRunCrates,
  intimidateAmount,
  intimidationTarget,
  memberArrestChance,
  protectionIncome,
  recruitChance,
  retailUnits,
  workExtra,
} from "../sim/systems/tasks";
import type { Msg } from "./productionChains";

const pct = (chance: number) => Math.round(chance * 100);

export function taskForecast(state: GameState, data: GameData, memberId: string, taskId: string, zoneId: string | null): Msg[] {
  const member: MemberState | undefined = state.members[memberId];
  const task = data.tasks.find((t) => t.id === taskId);
  const zone = zoneId ? state.zones[zoneId] : undefined;
  const zoneDef = zoneId ? data.zones.find((z) => z.id === zoneId) : undefined;
  if (!member || !task || !zone || !zoneDef) return [];
  const { balance } = data;
  const lines: Msg[] = [];
  const faction = state.factions[member.factionId];

  switch (taskId) {
    case "task_guard_zone":
      lines.push({ key: "forecast.guard", params: { amount: guardAmount(member, balance) } });
      break;
    case "task_intimidate": {
      const rival = intimidationTarget(state, zone, member.factionId);
      const war = rival !== null && atWar(state, rival, member.factionId);
      const amount = intimidateAmount(member, data, war);
      lines.push(
        rival
          ? { key: "forecast.intimidate", params: { amount, rival: data.factions.find((f) => f.id === rival)?.name ?? rival } }
          : { key: "forecast.intimidate_nobody", params: { amount } },
      );
      break;
    }
    case "task_collect_protection":
      lines.push({ key: "forecast.protection", params: { income: protectionIncome(member, zoneDef.wealth, controlOf(zone, member.factionId), balance) } });
      break;
    case "task_steal_bikes":
      lines.push({ key: "forecast.steal_bikes", params: { min: balance.tasks.stealBikes.min, max: balance.tasks.stealBikes.max } });
      break;
    case "task_work_garage":
    case "task_cultivate": {
      const business = state.businesses.find((b) => b.ownerFactionId === member.factionId && b.zoneId === zoneId && !b.suspended && businessDef(data, b.typeId)?.workshop?.workTaskId === taskId);
      const rule = business ? businessDef(data, business.typeId)?.workshop : undefined;
      lines.push(
        business && rule
          ? { key: "forecast.work", params: { units: workExtra(member, rule.handsPerExtraUnit, taskId, data), outputKey: `good.${rule.outputGoodId}` } }
          : { key: "forecast.work_none" },
      );
      break;
    }
    case "task_gun_run": {
      const goodId = balance.tasks.gunRun.goodId;
      const crates = Math.min(faction?.stock[goodId] ?? 0, gunRunCrates(member, data));
      lines.push({ key: "forecast.gun_run", params: { crates, max: gunRunCrates(member, data), income: crates * (marketPrice(state, data, goodId) ?? 0) } });
      break;
    }
    case "task_retail": {
      const units = retailUnits(member, zoneDef.wealth, balance);
      const stock = data.goods.filter((g) => g.streetOnly).reduce((sum, g) => sum + (faction?.stock[g.id] ?? 0), 0);
      lines.push({ key: "forecast.retail", params: { units: Math.min(units, stock), max: units } });
      break;
    }
    case "task_bribe":
      lines.push({ key: "forecast.bribe", params: { cost: balance.tasks.bribe.cost, heat: balance.tasks.bribe.heatReduction } });
      break;
    case "task_recruit":
      lines.push({ key: "forecast.recruit", params: { chance: pct(recruitChance(member, balance)) } });
      break;
    case "task_attack_business":
      lines.push({ key: "forecast.attack" });
      break;
    default:
      break;
  }

  const noHeat = memberEffects(data, member, "no_task_heat").some((fx) => fx.taskId === taskId);
  if (task.heat !== 0 && !noHeat) lines.push({ key: task.heat > 0 ? "forecast.heat_up" : "forecast.heat_down", params: { heat: Math.abs(task.heat) } });
  if (task.illegal) lines.push({ key: "forecast.arrest", params: { chance: pct(memberArrestChance(zone, member, data)) } });
  return lines;
}

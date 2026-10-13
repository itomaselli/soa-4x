// Headless simulator: `npm run sim -- --weeks 100 --seed 42`.
// Until the phase 2 AI exists, the player faction plays random valid orders.
// Checks state invariants every week and prints stats every 10 weeks.

import { parseArgs } from "node:util";
import { DataValidationError, loadGameData } from "../data/load";
import type { GameData } from "../data/schemas";
import { checkInvariants } from "../sim/invariants";
import { randomOrders } from "../sim/policies/random";
import type { ReportEntry } from "../sim/report";
import { createRng } from "../sim/rng";
import { createInitialState } from "../sim/setup";
import type { GameState } from "../sim/state";
import { ownedZones } from "../sim/systems/control";
import { activeMembers, factionMembers } from "../sim/systems/members";
import { resolveTurn } from "../sim/turn";
import { t } from "../ui/strings";

const DEFAULT_PLAYER_FACTION = "faction_iron_saints";
const PRINT_EVERY_WEEKS = 10;
/** Mixed into the seed so the random policy has its own sequence, independent of the game's RNG. */
const POLICY_SEED_SALT = 0x9e3779b9;

function row(state: GameState, data: GameData, week: number): string {
  const player = state.playerFactionId;
  const money = state.factions[player]?.money ?? { clean: 0, dirty: 0 };
  const zones = Object.values(state.zones);
  const avgHeat = zones.reduce((sum, z) => sum + z.heat, 0) / zones.length;
  return t(data.strings, "sim.row", {
    week,
    clean: money.clean,
    dirty: money.dirty,
    owned: ownedZones(state, player, data.balance).length,
    active: activeMembers(state, player).length,
    jailed: factionMembers(state, player).filter((m) => m.status === "jailed").length,
    heat: avgHeat.toFixed(1),
  });
}

function main(): number {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "100" },
      seed: { type: "string", default: "1" },
    },
  });
  const seed = Number(values.seed);
  const weeks = Number(values.weeks);
  if (!Number.isInteger(seed) || !Number.isInteger(weeks) || weeks < 0) {
    console.error("Uso: npm run sim -- --weeks <n> --seed <n>");
    return 1;
  }

  let data: GameData;
  try {
    data = loadGameData();
  } catch (error) {
    if (error instanceof DataValidationError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const s = data.strings;

  let state = createInitialState(data, { seed, playerFactionId: DEFAULT_PLAYER_FACTION });
  const policyRng = createRng(seed ^ POLICY_SEED_SALT);
  const allEntries: ReportEntry[] = [];
  console.log(t(s, "sim.header", { weeks, seed }));
  console.log(row(state, data, 0));

  for (let i = 0; i < weeks && !state.outcome; i++) {
    const orders = randomOrders(state, data, state.playerFactionId, policyRng);
    const result = resolveTurn(state, orders, data);
    state = result.state;
    allEntries.push(...result.report);

    const problems = checkInvariants(state, data.balance);
    if (problems.length > 0) {
      console.error(t(s, "cli.invariants_failed", { week: state.week - 1 }));
      for (const p of problems) console.error(`- ${p}`);
      return 1;
    }
    if ((i + 1) % PRINT_EVERY_WEEKS === 0) console.log(row(state, data, i + 1));
  }

  const count = (key: string) => allEntries.filter((e) => e.key === key).length;
  const protection = allEntries
    .filter((e) => e.key === "report.task.protection")
    .reduce((sum, e) => sum + Number(e.params.income ?? 0), 0);
  console.log(
    t(s, "sim.summary", {
      arrests: count("report.task.arrested"),
      recruits: count("report.task.recruit"),
      rejected: count("report.order_rejected"),
      protection,
    }),
  );
  console.log(
    state.outcome
      ? t(s, "sim.outcome", { week: state.outcome.week, outcome: t(s, state.outcome.reasonKey) })
      : t(s, "sim.no_outcome", { weeks }),
  );
  return 0;
}

process.exitCode = main();

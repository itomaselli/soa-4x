// Headless simulator: `npm run sim -- --weeks 100 --seed 42 [--runs 20] [--player ai|random|idle]`.
// Every AI faction plays with its ai.json profile. The player faction plays with its own AI profile
// by default, or with random orders / no orders to compare.
// Checks state invariants every week. One run prints a timeline; several runs print aggregates.

import { parseArgs } from "node:util";
import { DataValidationError, loadGameData } from "../data/load";
import type { GameData } from "../data/schemas";
import { checkInvariants } from "../sim/invariants";
import { randomOrders } from "../sim/policies/random";
import type { ReportEntry } from "../sim/report";
import { createRng, type Rng } from "../sim/rng";
import { createInitialState } from "../sim/setup";
import type { GameState } from "../sim/state";
import { aiOrders, allAiOrders } from "../sim/systems/ai";
import { ownedZones } from "../sim/systems/control";
import { averageLoyalty } from "../sim/systems/loyalty";
import { activeMembers, factionMembers } from "../sim/systems/members";
import { resolveTurn } from "../sim/turn";
import { t } from "../ui/strings";

const DEFAULT_PLAYER_FACTION = "faction_iron_saints";
const PRINT_EVERY_WEEKS = 10;
/** Mixed into the seed so the random policy has its own sequence, independent of the game's RNG. */
const POLICY_SEED_SALT = 0x9e3779b9;
const PLAYER_MODES = ["ai", "random", "idle"] as const;
type PlayerMode = (typeof PLAYER_MODES)[number];

interface FactionStats {
  arrests: number;
  recruits: number;
  protection: number;
  unpaid: number;
  zones: number;
  deserted: number;
  loyalty: number;
  federal: number;
  informants: number;
}

const EMPTY_STATS: FactionStats = { arrests: 0, recruits: 0, protection: 0, unpaid: 0, zones: 0, deserted: 0, loyalty: 0, federal: 0, informants: 0 };

interface RunResult {
  seed: number;
  state: GameState;
  stats: Record<string, FactionStats>;
  publicCounts: Record<string, number>;
}

const PUBLIC_KEYS = ["report.law.crackdown", "report.council.war_declared"];

function clubIds(data: GameData): string[] {
  return data.factions.filter((f) => f.kind === "club").map((f) => f.id);
}

function factionName(data: GameData, id: string): string {
  return data.factions.find((f) => f.id === id)?.name ?? id;
}

function timelineRows(state: GameState, data: GameData, week: number): string[] {
  const zones = Object.values(state.zones);
  const avgHeat = zones.reduce((sum, z) => sum + z.heat, 0) / zones.length;
  const rows = [t(data.strings, "sim.row", { week, heat: avgHeat.toFixed(1) })];
  for (const id of clubIds(data)) {
    const money = state.factions[id]?.money ?? { clean: 0, dirty: 0 };
    rows.push(
      t(data.strings, "sim.faction_row", {
        faction: factionName(data, id),
        owned: ownedZones(state, id, data.balance).length,
        clean: money.clean,
        dirty: money.dirty,
        active: activeMembers(state, id).length,
        jailed: factionMembers(state, id).filter((m) => m.status === "jailed").length,
      }),
    );
  }
  return rows;
}

function collectStats(state: GameState, data: GameData, entries: ReportEntry[]): Record<string, FactionStats> {
  const stats: Record<string, FactionStats> = {};
  for (const id of clubIds(data)) {
    const mine = entries.filter((e) => e.factionId === id);
    const count = (key: string) => mine.filter((e) => e.key === key).length;
    stats[id] = {
      arrests: count("report.task.arrested"),
      recruits: count("report.task.recruit"),
      protection: mine.filter((e) => e.key === "report.task.protection").reduce((s, e) => s + Number(e.params.income ?? 0), 0),
      unpaid: count("report.expenses.unpaid"),
      zones: ownedZones(state, id, data.balance).length,
      deserted: count("report.loyalty.deserted"),
      loyalty: averageLoyalty(state, id) ?? 0,
      federal: state.factions[id]?.federal ?? 0,
      informants: factionMembers(state, id).filter((m) => m.informant).length,
    };
  }
  return stats;
}

function playerOrders(state: GameState, data: GameData, mode: PlayerMode, policyRng: Rng) {
  if (mode === "ai") return aiOrders(state, data, state.playerFactionId);
  if (mode === "random") return randomOrders(state, data, state.playerFactionId, policyRng);
  return { assignments: [] };
}

function runOnce(data: GameData, seed: number, weeks: number, mode: PlayerMode, printTimeline: boolean): RunResult | string[] {
  let state = createInitialState(data, { seed, playerFactionId: DEFAULT_PLAYER_FACTION });
  const policyRng = createRng(seed ^ POLICY_SEED_SALT);
  const entries: ReportEntry[] = [];
  if (printTimeline) console.log(timelineRows(state, data, 0).join("\n"));

  for (let i = 0; i < weeks && !state.outcome; i++) {
    const ai = allAiOrders(state, data, state.playerFactionId);
    const mine = playerOrders(state, data, mode, policyRng);
    const result = resolveTurn(state, { assignments: [...mine.assignments, ...ai.assignments] }, data);
    state = result.state;
    entries.push(...result.report);

    const problems = checkInvariants(state, data.balance);
    if (problems.length > 0) {
      return [t(data.strings, "cli.invariants_failed", { week: state.week - 1 }), ...problems.map((p) => `- ${p}`)];
    }
    if (printTimeline && (i + 1) % PRINT_EVERY_WEEKS === 0) console.log(timelineRows(state, data, i + 1).join("\n"));
  }
  const publicCounts = Object.fromEntries(PUBLIC_KEYS.map((k) => [k, entries.filter((e) => e.key === k).length]));
  return { seed, state, stats: collectStats(state, data, entries), publicCounts };
}

function outcomeText(data: GameData, state: GameState): string {
  return state.outcome ? t(data.strings, state.outcome.reasonKey) : t(data.strings, "sim.no_outcome_short");
}

function main(): number {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "100" },
      seed: { type: "string", default: "1" },
      runs: { type: "string", default: "1" },
      player: { type: "string", default: "ai" },
    },
  });
  const seed = Number(values.seed);
  const weeks = Number(values.weeks);
  const runs = Number(values.runs);
  const mode = values.player as PlayerMode;
  if (!Number.isInteger(seed) || !Number.isInteger(weeks) || weeks < 0 || !Number.isInteger(runs) || runs < 1 || !PLAYER_MODES.includes(mode)) {
    console.error("Uso: npm run sim -- --weeks <n> --seed <n> [--runs <n>] [--player ai|random|idle]");
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
  console.log(t(s, "sim.header", { weeks, runs, seed, player: t(s, `sim.player.${mode}`) }));

  const results: RunResult[] = [];
  for (let r = 0; r < runs; r++) {
    const result = runOnce(data, seed + r, weeks, mode, runs === 1);
    if (Array.isArray(result)) {
      console.error(`${t(s, "sim.failed_seed", { seed: seed + r })}\n${result.join("\n")}`);
      return 1;
    }
    results.push(result);
    if (runs > 1) {
      const [player, rival] = clubIds(data);
      console.log(
        t(s, "sim.run_line", {
          seed: result.seed,
          result: outcomeText(data, result.state),
          week: result.state.outcome?.week ?? weeks,
          playerZones: player ? (result.stats[player]?.zones ?? 0) : 0,
          rivalZones: rival ? (result.stats[rival]?.zones ?? 0) : 0,
        }),
      );
    }
  }

  // Aggregates (for one run, these are just that run's numbers)
  console.log(`\n${t(s, "sim.aggregate_title", { runs })}`);
  const byOutcome = new Map<string, number>();
  for (const r of results) byOutcome.set(outcomeText(data, r.state), (byOutcome.get(outcomeText(data, r.state)) ?? 0) + 1);
  for (const [outcome, count] of [...byOutcome.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(t(s, "sim.aggregate_outcome", { outcome, count, percent: Math.round((count / runs) * 100) }));
  }
  const count = (key: string) => results.reduce((sum, r) => sum + r.publicCounts[key]!, 0) / runs;
  console.log(t(s, "sim.aggregate_public", { crackdowns: count("report.law.crackdown").toFixed(1), wars: count("report.council.war_declared").toFixed(1) }));
  const avgEnd = results.reduce((sum, r) => sum + (r.state.outcome?.week ?? weeks), 0) / runs;
  console.log(t(s, "sim.avg_end_week", { week: avgEnd.toFixed(1) }));
  for (const id of clubIds(data)) {
    const avg = (pick: (st: FactionStats) => number) =>
      (results.reduce((sum, r) => sum + pick(r.stats[id] ?? EMPTY_STATS), 0) / runs).toFixed(1);
    console.log(
      t(s, "sim.aggregate_faction", {
        faction: factionName(data, id),
        zones: avg((x) => x.zones),
        arrests: avg((x) => x.arrests),
        recruits: avg((x) => x.recruits),
        protection: avg((x) => x.protection),
        unpaid: avg((x) => x.unpaid),
      }),
    );
    console.log(
      t(s, "sim.aggregate_faction_2", {
        deserted: avg((x) => x.deserted),
        loyalty: avg((x) => x.loyalty),
        federal: avg((x) => x.federal),
        informants: avg((x) => x.informants),
      }),
    );
  }
  return 0;
}

process.exitCode = main();

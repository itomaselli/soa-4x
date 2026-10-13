// Headless simulator entry point: `npm run sim -- --weeks 100 --seed 42`.
// Phase 0: loads and validates data, builds the initial state and checks invariants.
// Turn resolution arrives in phase 1/2 (see docs/GDD.md §17).

import { parseArgs } from "node:util";
import { DataValidationError, loadGameData } from "../data/load";
import { checkInvariants } from "../sim/invariants";
import { createInitialState } from "../sim/setup";
import { t } from "../ui/strings";

const DEFAULT_PLAYER_FACTION = "faction_iron_saints";

function main(): number {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "1" },
      seed: { type: "string", default: "1" },
    },
  });
  const seed = Number(values.seed);
  const weeks = Number(values.weeks);
  if (!Number.isInteger(seed) || !Number.isInteger(weeks) || weeks < 0) {
    console.error("Uso: npm run sim -- --weeks <n> --seed <n>");
    return 1;
  }

  let data;
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

  const state = createInitialState(data, { seed, playerFactionId: DEFAULT_PLAYER_FACTION });
  console.log(
    t(s, "app.phase0_ok", {
      zones: data.zones.length,
      members: data.members.length,
      factions: data.factions.length,
    }),
  );
  console.log(t(s, "cli.seed", { seed, rngState: state.rngState }));

  const problems = checkInvariants(state, data.balance);
  if (problems.length > 0) {
    console.error(t(s, "cli.invariants_failed"));
    for (const p of problems) console.error(`- ${p}`);
    return 1;
  }
  console.log(t(s, "cli.invariants_ok"));
  console.log(t(s, "cli.turns_not_implemented", { weeks }));
  return 0;
}

process.exitCode = main();

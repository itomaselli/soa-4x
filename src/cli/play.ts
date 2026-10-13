// Text-mode game: `npm run play -- --seed 42` or `npm run play -- --load saves/autosave.json`.
// Shows the state, asks for one task per active member, resolves the week and prints the report.
// This file only does I/O: all decisions go through orders + resolveTurn.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { loadGameData } from "../data/load";
import type { GameData } from "../data/schemas";
import { availableTasks, reachableZones, type Assignment } from "../sim/orders";
import { loadSave, serializeState } from "../sim/save";
import { createInitialState } from "../sim/setup";
import type { GameState } from "../sim/state";
import { allAiOrders } from "../sim/systems/ai";
import { resolveTurn } from "../sim/turn";
import { t } from "../ui/strings";
import { formatReport, formatStatus, sortedMembers } from "./text";

const DEFAULT_PLAYER_FACTION = "faction_iron_saints";
const DEFAULT_SAVE_PATH = "saves/autosave.json";
const QUIT_COMMAND = "s";

function save(state: GameState, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeState(state));
}

/** Line reader that also works with piped input (returns null at end of input). */
function createAsker() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const iterator = rl[Symbol.asyncIterator]();
  return {
    async ask(prompt: string): Promise<string | null> {
      process.stdout.write(prompt);
      const next = await iterator.next();
      if (next.done) return null;
      if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`);
      return next.value.trim();
    },
    close: () => rl.close(),
  };
}

type Asker = ReturnType<typeof createAsker>;

/** Asks for a 1-based index into `count` options. "" = skip, null = quit. */
async function askIndex(asker: Asker, prompt: string, count: number, data: GameData): Promise<number | "skip" | null> {
  for (;;) {
    const answer = await asker.ask(prompt);
    if (answer === null || answer.toLowerCase() === QUIT_COMMAND) return null;
    if (answer === "") return "skip";
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
    console.log(t(data.strings, "play.invalid_choice"));
  }
}

async function collectOrders(state: GameState, data: GameData, asker: Asker): Promise<Assignment[] | null> {
  const s = data.strings;
  const player = state.playerFactionId;
  const tasks = availableTasks(data).map((id) => data.tasks.find((task) => task.id === id)!);
  const zones = reachableZones(state, data, player);

  console.log(`\n${t(s, "play.tasks_title")}`);
  tasks.forEach((task, i) =>
    console.log(
      `  ${t(s, "play.task_line", {
        index: i + 1,
        name: t(s, `task.${task.id}`),
        illegal: task.illegal ? t(s, "play.task_illegal", { heat: task.heat }) : "",
      })}`,
    ),
  );
  console.log(`\n${t(s, "play.assign_title")}`);

  const assignments: Assignment[] = [];
  for (const member of sortedMembers(state, player).filter((m) => m.status === "active")) {
    const label = member.nickname || member.name;
    const taskIndex = await askIndex(asker, t(s, "play.ask_task", { member: label }), tasks.length, data);
    if (taskIndex === null) return null;
    if (taskIndex === "skip") {
      console.log(t(s, "play.idle", { member: label }));
      continue;
    }
    const zoneIndex = await askIndex(asker, t(s, "play.ask_zone"), zones.length, data);
    if (zoneIndex === null) return null;
    if (zoneIndex === "skip") {
      console.log(t(s, "play.idle", { member: label }));
      continue;
    }
    assignments.push({ memberId: member.id, taskId: tasks[taskIndex]!.id, zoneId: zones[zoneIndex]! });
  }
  return assignments;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "1" },
      load: { type: "string" },
      save: { type: "string", default: DEFAULT_SAVE_PATH },
    },
  });
  const data = loadGameData();
  const s = data.strings;
  const savePath = values.save;

  let state: GameState;
  if (values.load) {
    state = loadSave(readFileSync(values.load, "utf8"), data);
    console.log(t(s, "play.loaded", { path: values.load }));
  } else {
    state = createInitialState(data, { seed: Number(values.seed), playerFactionId: DEFAULT_PLAYER_FACTION });
  }

  const asker = createAsker();
  while (!state.outcome) {
    console.log(`\n${formatStatus(state, data, state.playerFactionId).join("\n")}`);
    const assignments = await collectOrders(state, data, asker);
    if (assignments === null) break;
    const week = state.week;
    const ai = allAiOrders(state, data, state.playerFactionId);
    const result = resolveTurn(
      state,
      { assignments: [...assignments, ...ai.assignments], management: ai.management, proposals: ai.proposals },
      data,
    );
    state = result.state;
    console.log(`\n${t(s, "play.report_title", { week })}`);
    console.log(formatReport(result.report, data, state.playerFactionId).join("\n"));
    save(state, savePath);
  }

  save(state, savePath);
  console.log(t(s, "play.saved", { path: savePath }));
  if (state.outcome) {
    console.log(t(s, "play.game_over", { week: state.outcome.week, outcome: t(s, state.outcome.reasonKey) }));
  }
  console.log(t(s, "play.goodbye"));
  asker.close();
}

await main();

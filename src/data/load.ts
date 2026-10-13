// Loads and validates the content in /data.
// The JSON files are imported statically, so this works the same in the
// browser (Vite), in tests (Vitest) and in the headless CLI (tsx).

import { GameDataSchema, type GameData } from "./schemas";
import { validateGameData } from "./validate";

import balance from "../../data/balance.json";
import zones from "../../data/zones.json";
import factions from "../../data/factions.json";
import members from "../../data/members.json";
import tasks from "../../data/tasks.json";
import goods from "../../data/goods.json";
import businesses from "../../data/businesses.json";
import events from "../../data/events.json";
import names from "../../data/names.json";
import ai from "../../data/ai.json";
import ui from "../../data/ui.json";
import strings from "../../data/strings.es.json";

export class DataValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Datos inválidos en /data:\n- ${problems.join("\n- ")}`);
    this.name = "DataValidationError";
    this.problems = problems;
  }
}

/** Raw, unvalidated bundle (one entry per file). */
export type RawGameData = Record<keyof GameData, unknown>;

const FILE_NAMES: Record<keyof GameData, string> = {
  balance: "balance.json",
  zones: "zones.json",
  factions: "factions.json",
  members: "members.json",
  tasks: "tasks.json",
  goods: "goods.json",
  businesses: "businesses.json",
  events: "events.json",
  names: "names.json",
  ai: "ai.json",
  ui: "ui.json",
  strings: "strings.es.json",
};

function fileNameFor(key: string | undefined): string {
  return key !== undefined && key in FILE_NAMES ? FILE_NAMES[key as keyof GameData] : "datos";
}

export const BUNDLED_RAW_DATA: RawGameData = {
  balance,
  zones,
  factions,
  members,
  tasks,
  goods,
  businesses,
  events,
  names,
  ai,
  ui,
  strings,
};

/** Validates a raw bundle: shape (zod) first, then cross-references. Throws DataValidationError. */
export function parseGameData(raw: RawGameData): GameData {
  const parsed = GameDataSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const [file, ...path] = issue.path.map(String);
      const location = path.length > 0 ? `${fileNameFor(file)} › ${path.join(".")}` : fileNameFor(file);
      return `${location}: ${issue.message}`;
    });
    throw new DataValidationError(problems);
  }
  const problems = validateGameData(parsed.data);
  if (problems.length > 0) {
    throw new DataValidationError(problems);
  }
  return parsed.data;
}

/** Loads the content bundled with the game. */
export function loadGameData(): GameData {
  return parseGameData(BUNDLED_RAW_DATA);
}

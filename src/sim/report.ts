// Every resolution step explains itself through report entries (CLAUDE.md, golden rule 6).
// Entries hold a strings.es.json key plus parameters; the UI turns them into Spanish text.

/** Resolution stages, in the fixed order of GDD §4, plus the end-of-turn checks. */
export const TURN_STAGES = [
  "orders",
  "production",
  "transport",
  "sales",
  "faction_tasks",
  "combat",
  "laundering",
  "expenses",
  "heat_and_law",
  "loyalty",
  "events",
  "end_of_turn",
] as const;
export type TurnStage = (typeof TURN_STAGES)[number];

export interface ReportEntry {
  stage: TurnStage;
  /** strings.es.json key, e.g. "report.task.collect_protection". */
  key: string;
  params: Record<string, string | number>;
  /** Faction the entry is about (null = public / global). Used later to hide other factions' details. */
  factionId: string | null;
}

export type Reporter = (key: string, params?: Record<string, string | number>, factionId?: string | null) => void;

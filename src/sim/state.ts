// GameState: the full, plain-data snapshot of a game.
// It must stay JSON-serializable (no classes, no functions, no Maps/Sets).
// The zod schema is the single source of truth; TS types are inferred from it,
// so a loaded save is validated against exactly the same shape the sim uses.
// Range limits (0–100, 1–10, ...) are balance values and are checked against
// data/balance.json in src/sim/invariants.ts, not hard-coded here.

import { z } from "zod";

// ---------- Shared enums (GDD §5, §6) ----------

export const ZONE_TYPES = ["town", "road", "port", "rural", "industrial"] as const;
export const ZoneTypeSchema = z.enum(ZONE_TYPES);
export type ZoneType = z.infer<typeof ZoneTypeSchema>;

export const STAT_KEYS = ["strength", "cunning", "hands", "charm"] as const;
export const StatKeySchema = z.enum(STAT_KEYS);
export type StatKey = z.infer<typeof StatKeySchema>;

export const RANKS = [
  "prospect",
  "member",
  "sergeant_at_arms",
  "treasurer",
  "vice_president",
  "president",
] as const;
export const RankSchema = z.enum(RANKS);
export type Rank = z.infer<typeof RankSchema>;

export const TRAITS = ["traditionalist", "greedy", "violent", "cautious", "loyal", "ambitious"] as const;
export const TraitSchema = z.enum(TRAITS);
export type Trait = z.infer<typeof TraitSchema>;

export const MEMBER_STATUSES = ["active", "wounded", "jailed", "dead"] as const;
export const MemberStatusSchema = z.enum(MEMBER_STATUSES);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

export const FACTION_KINDS = ["club", "cartel", "sheriff", "federal"] as const;
export const FactionKindSchema = z.enum(FACTION_KINDS);
export type FactionKind = z.infer<typeof FactionKindSchema>;

export const CURRENCIES = ["clean", "dirty"] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

// ---------- Building blocks ----------

export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "IDs are lowercase snake_case, e.g. zone_redwater");
export type Id = z.infer<typeof IdSchema>;

const FiniteNumber = z.number().finite();
const NonNegativeInt = z.number().int().nonnegative();

export const StatsSchema = z.object({
  strength: z.number().int(),
  cunning: z.number().int(),
  hands: z.number().int(),
  charm: z.number().int(),
});
export type Stats = z.infer<typeof StatsSchema>;

export const MoneySchema = z.object({
  clean: FiniteNumber,
  dirty: FiniteNumber,
});
export type Money = z.infer<typeof MoneySchema>;

// ---------- State slices ----------

export const ZoneStateSchema = z.object({
  id: IdSchema,
  /** Influence per faction id (GDD §5). Missing faction = 0. */
  control: z.record(IdSchema, FiniteNumber),
  heat: FiniteNumber,
  policePresence: z.number().int(),
});
export type ZoneState = z.infer<typeof ZoneStateSchema>;

export const MemberStateSchema = z.object({
  id: IdSchema,
  factionId: IdSchema,
  name: z.string().min(1),
  nickname: z.string(),
  rank: RankSchema,
  trait: TraitSchema,
  stats: StatsSchema,
  loyalty: FiniteNumber,
  status: MemberStatusSchema,
  /** Remaining weeks for `wounded` / `jailed`. 0 otherwise. */
  statusWeeks: NonNegativeInt,
});
export type MemberState = z.infer<typeof MemberStateSchema>;

export const FactionStateSchema = z.object({
  id: IdSchema,
  money: MoneySchema,
  /** Relation towards other factions, keyed by faction id (GDD §12). */
  relations: z.record(IdSchema, FiniteNumber),
  /** Goods in stock, keyed by good id. */
  stock: z.record(IdSchema, NonNegativeInt),
});
export type FactionState = z.infer<typeof FactionStateSchema>;

export const BusinessStateSchema = z.object({
  id: IdSchema,
  typeId: IdSchema,
  zoneId: IdSchema,
  ownerFactionId: IdSchema,
});
export type BusinessState = z.infer<typeof BusinessStateSchema>;

export const OUTCOME_RESULTS = ["victory", "defeat"] as const;

export const OutcomeSchema = z.object({
  result: z.enum(OUTCOME_RESULTS),
  /** strings.es.json key explaining why, e.g. "outcome.defeat.too_few_members". */
  reasonKey: z.string(),
  week: z.number().int(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const SAVE_SCHEMA_VERSION = 1;

export const GameStateSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  /** Current week, starting at 1. */
  week: z.number().int().min(1),
  /** mulberry32 state (uint32). See src/sim/rng.ts. */
  rngState: z.number().int().min(0).max(0xffffffff),
  playerFactionId: IdSchema,
  factions: z.record(IdSchema, FactionStateSchema),
  zones: z.record(IdSchema, ZoneStateSchema),
  members: z.record(IdSchema, MemberStateSchema),
  businesses: z.array(BusinessStateSchema),
  /** Global federal investigation, 0–100 (GDD §10). */
  federalInvestigation: FiniteNumber,
  /** Consecutive weeks each faction has owned at least `victory.zonesToControl` zones (GDD §14). */
  controlStreaks: z.record(IdSchema, NonNegativeInt),
  /** null while the game is running. */
  outcome: OutcomeSchema.nullable(),
});
export type GameState = z.infer<typeof GameStateSchema>;

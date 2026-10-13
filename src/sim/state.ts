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

export const PROPOSAL_TYPES = ["declare_war", "truce", "promote", "expel", "cartel_deal", "open_illegal_business"] as const;
export const ProposalTypeSchema = z.enum(PROPOSAL_TYPES);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;
/** Everything the council votes on: the president's proposals plus a motion to remove him. */
export const VOTE_TYPES = [...PROPOSAL_TYPES, "impeachment"] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

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
  /** Secretly talking to the federals (GDD §10). Hidden from the player. */
  informant: z.boolean(),
});
export type MemberState = z.infer<typeof MemberStateSchema>;

export const FactionStateSchema = z.object({
  id: IdSchema,
  money: MoneySchema,
  /** Relation towards other factions, keyed by faction id (GDD §12). */
  relations: z.record(IdSchema, FiniteNumber),
  /** Goods in stock, keyed by good id. */
  stock: z.record(IdSchema, NonNegativeInt),
  /** Federal investigation into this faction, 0–100 (GDD §10). Invisible to the player below `federal.visibleFrom`. */
  federal: FiniteNumber,
  /** Consecutive weeks with average loyalty below the impeachment threshold (GDD §6). */
  lowLoyaltyWeeks: NonNegativeInt,
  /** Owned zones at the end of each recent week, oldest first. Feeds the council's "recent results". */
  ownedHistory: z.array(NonNegativeInt),
});
export type FactionState = z.infer<typeof FactionStateSchema>;

export const BusinessStateSchema = z.object({
  id: IdSchema,
  typeId: IdSchema,
  zoneId: IdSchema,
  ownerFactionId: IdSchema,
  /** Which of the zone's building lots it occupies, 0 … businessSlots−1 (phase 10: lots on the local map). */
  lot: NonNegativeInt,
  /** The sheriff already warned about a raid on this business (GDD §10). */
  raidWarned: z.boolean(),
  /** Week it was built: it starts working the following week. */
  builtWeek: z.number().int(),
  /** Maintenance unpaid: the business does nothing until it's paid again. */
  suspended: z.boolean(),
  /** Extra production for next week from members who worked here (garage). */
  workCapacity: NonNegativeInt,
});
export type BusinessState = z.infer<typeof BusinessStateSchema>;

export const STANCE_TYPES = ["war", "truce", "deal"] as const;

/** Explicit diplomatic state between two factions (GDD §12). No stance = neutral or tension, from the relation value. */
export const StanceSchema = z.object({
  type: z.enum(STANCE_TYPES),
  sinceWeek: z.number().int(),
  /** Deals with the cartel: last week the club bought guns (GDD §12: "si incumplís, castiga"). */
  lastPurchaseWeek: z.number().int().optional(),
});
export type Stance = z.infer<typeof StanceSchema>;

export const PendingEventSchema = z.object({
  /** Unique per occurrence, e.g. "event_route9_truck@12". */
  instanceId: z.string(),
  eventId: IdSchema,
  factionId: IdSchema,
  subjectMemberId: IdSchema.nullable(),
  /** The rival club the event refers to (defectors, relation changes). */
  rivalFactionId: IdSchema.nullable().optional(),
  week: z.number().int(),
});
export type PendingEvent = z.infer<typeof PendingEventSchema>;

export const OUTCOME_RESULTS = ["victory", "defeat"] as const;

export const OutcomeSchema = z.object({
  result: z.enum(OUTCOME_RESULTS),
  /** strings.es.json key explaining why, e.g. "outcome.defeat.too_few_members". */
  reasonKey: z.string(),
  week: z.number().int(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Bump it with a migration in src/sim/save.ts (SAVE_MIGRATIONS) whenever the shape of GameState changes. */
export const SAVE_SCHEMA_VERSION = 2;

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
  /** Stances keyed by the two faction ids sorted and joined with "|", e.g. "faction_grim_wolves|faction_iron_saints". */
  stances: z.record(z.string(), StanceSchema),
  /** Consecutive weeks each faction has owned at least `victory.zonesToControl` zones (GDD §14). */
  controlStreaks: z.record(IdSchema, NonNegativeInt),
  /** Recent units sold per good; drives prices (GDD §9). */
  market: z.record(IdSchema, z.object({ supply: z.number().nonnegative() })),
  /** Gun shipments bought from the cartel, delivered in the transport stage. */
  shipments: z.array(z.object({ factionId: IdSchema, goodId: IdSchema, quantity: NonNegativeInt })),
  /** Events waiting for the player's decision (GDD §13). */
  pendingEvents: z.array(PendingEventSchema),
  /** Last week each event happened to each club, keyed `${eventId}__${factionId}`, for cooldowns. */
  eventHistory: z.record(IdSchema, z.number().int()),
  /** Counter for unique business ids. */
  businessSerial: NonNegativeInt,
  /** Name and patch of each club (phase 11): the player names their club; rivals use their defaults. */
  identities: z.record(IdSchema, z.object({ name: z.string().min(1).max(40), patchId: IdSchema.nullable() })),
  /** null while the game is running. */
  outcome: OutcomeSchema.nullable(),
});
export type GameState = z.infer<typeof GameStateSchema>;

// zod schemas for the content files in /data.
// These check the *shape* of each file. Cross-file references and balance
// ranges are checked afterwards in validate.ts.

import { z } from "zod";
import {
  FactionKindSchema,
  IdSchema,
  MoneySchema,
  RankSchema,
  StatKeySchema,
  StatsSchema,
  TraitSchema,
  ZoneTypeSchema,
} from "../sim/state";

const Int = z.number().int();
const Probability = z.number().min(0).max(1);
const Range = z
  .object({ min: z.number().finite(), max: z.number().finite() })
  .refine((r) => r.min <= r.max, "min must be <= max");

/** A single display character for the ASCII placeholder renderer (GDD §15). */
const GlyphSchema = z.string().length(1);

// ---------- balance.json ----------

export const BalanceSchema = z.object({
  ranges: z.object({
    stat: Range,
    loyalty: Range,
    control: Range,
    heat: Range,
    wealth: Range,
    policePresence: Range,
    businessSlots: Range,
    relation: Range,
    federalInvestigation: Range,
  }),
  control: z.object({
    ownerMinimum: z.number(),
    ownerLeadMargin: z.number(),
  }),
  heat: z.object({
    weeklyDecay: z.number(),
    patrolThreshold: z.number(),
    raidThreshold: z.number(),
    crackdownThreshold: z.number(),
  }),
  club: z.object({
    startingMembers: Int,
    startingProspects: Int,
    memberCap: Int,
    prospectStatPenalty: Int,
    lowLoyaltyThreshold: z.number(),
  }),
  council: z.object({
    impeachmentAverageLoyalty: z.number(),
    impeachmentWeeks: Int,
  }),
  laundering: z.object({
    federalAttentionCapacityRatio: z.number().min(0).max(1),
  }),
  market: z.object({
    priceVariance: z.number().min(0).max(1),
  }),
  federal: z.object({
    visibleFrom: z.number(),
  }),
  victory: z.object({
    zonesToControl: Int,
    weeksHeld: Int,
    /** Faction whose total expulsion from the county is also a victory (GDD §14). */
    rivalToExpel: IdSchema,
  }),
  defeat: z.object({
    minActiveMembers: Int,
  }),
  initiative: z.object({
    /** Initiative = task stat + rng.int(0, randomMax). */
    randomMax: Int.nonnegative(),
  }),
  arrest: z.object({
    base: Probability,
    perHeat: z.number(),
    perPolicePresence: z.number(),
    perCunning: z.number(),
    patrolBonus: z.number(),
    minChance: Probability,
    maxChance: Probability,
    jailWeeksMin: Int.positive(),
    jailWeeksMax: Int.positive(),
  }),
  tasks: z.object({
    guard: z.object({ baseGain: Int, strengthDivisor: Int.positive() }),
    intimidate: z.object({ baseGain: Int, strengthDivisor: Int.positive() }),
    protection: z.object({ rate: z.number(), charmBase: z.number(), perCharm: z.number() }),
    stealBikes: z.object({ goodId: IdSchema, min: Int.nonnegative(), max: Int.nonnegative() }),
    bribe: z.object({ cost: z.number().nonnegative(), heatReduction: z.number(), sheriffRelationGain: z.number() }),
    recruit: z.object({
      baseChance: Probability,
      perCharm: z.number(),
      statMin: Int,
      statMax: Int,
      startingLoyalty: z.number(),
    }),
  }),
  /** Weekly wage per rank (GDD §8). */
  wages: z.record(RankSchema, z.number().nonnegative()),
  loyalty: z.object({
    /** Loyalty lost by a member who wasn't paid this week (GDD §8). */
    unpaidPenalty: z.number().nonnegative(),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;

// ---------- zones.json ----------

export const ZoneDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  type: ZoneTypeSchema,
  glyph: GlyphSchema,
  adjacent: z.array(IdSchema),
  wealth: Int,
  policePresence: Int,
  businessSlots: Int,
  initialHeat: z.number().finite(),
  /** Starting influence per faction id. Missing faction = 0. */
  initialControl: z.record(IdSchema, z.number().finite()),
});
export type ZoneDef = z.infer<typeof ZoneDefSchema>;

// ---------- factions.json ----------

export const FactionDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: FactionKindSchema,
  glyph: GlyphSchema,
  /** Headquarters zone, or null if it is outside the current map. */
  hqZoneId: IdSchema.nullable(),
  startingMoney: MoneySchema,
  /** Starting relation towards other factions. Missing faction = 0 (neutral). */
  initialRelations: z.record(IdSchema, z.number().finite()),
});
export type FactionDef = z.infer<typeof FactionDefSchema>;

// ---------- members.json ----------

export const MemberDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  nickname: z.string(),
  factionId: IdSchema,
  rank: RankSchema,
  trait: TraitSchema,
  stats: StatsSchema,
  loyalty: z.number().finite(),
  glyph: GlyphSchema,
});
export type MemberDef = z.infer<typeof MemberDefSchema>;

// ---------- tasks.json ----------

export const TaskDefSchema = z.object({
  id: IdSchema,
  /** Stat used to resolve the task, or null if none (e.g. "lie low"). */
  stat: StatKeySchema.nullable(),
  /** Heat added to the zone when performed (GDD §7). Negative lowers heat. */
  heat: z.number().finite(),
  /** Illegal tasks carry an arrest chance (GDD §7). */
  illegal: z.boolean(),
  /** Disabled tasks exist in the GDD but aren't implemented yet; orders for them are rejected. */
  enabled: z.boolean(),
});
export type TaskDef = z.infer<typeof TaskDefSchema>;

// ---------- goods.json ----------

export const GoodDefSchema = z.object({
  id: IdSchema,
  glyph: GlyphSchema,
});
export type GoodDef = z.infer<typeof GoodDefSchema>;

// ---------- businesses.json ----------

export const BusinessDefSchema = z.object({
  id: IdSchema,
  legal: z.boolean(),
  glyph: GlyphSchema,
});
export type BusinessDef = z.infer<typeof BusinessDefSchema>;

// ---------- events.json ----------
// Only the skeleton for now; conditions and effects arrive in phase 5.

export const EventDefSchema = z.object({
  id: IdSchema,
  options: z.array(z.object({ id: IdSchema })).min(1),
});
export type EventDef = z.infer<typeof EventDefSchema>;

// ---------- names.json ----------
// Name pools for generated recruits.

export const NamesSchema = z.object({
  first: z.array(z.string().min(1)).min(1),
  last: z.array(z.string().min(1)).min(1),
  nicknames: z.array(z.string().min(1)).min(1),
});
export type Names = z.infer<typeof NamesSchema>;

// ---------- strings.es.json ----------

export const StringsSchema = z.record(z.string().min(1), z.string());
export type Strings = z.infer<typeof StringsSchema>;

// ---------- Whole bundle ----------

export const GameDataSchema = z.object({
  balance: BalanceSchema,
  zones: z.array(ZoneDefSchema).min(1),
  factions: z.array(FactionDefSchema).min(1),
  members: z.array(MemberDefSchema),
  tasks: z.array(TaskDefSchema),
  goods: z.array(GoodDefSchema),
  businesses: z.array(BusinessDefSchema),
  events: z.array(EventDefSchema),
  names: NamesSchema,
  strings: StringsSchema,
});
export type GameData = z.infer<typeof GameDataSchema>;

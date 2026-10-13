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
  relations: z.object({
    /** Relation lost by a faction towards whoever intimidated it (GDD §12). */
    intimidatedPenalty: z.number().nonnegative(),
  }),
  loyalty: z.object({
    /** Loyalty lost by a member who wasn't paid this week (GDD §8). */
    unpaidPenalty: z.number().nonnegative(),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;

// ---------- zones.json ----------

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color como #rrggbb");

export const ZoneDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Label drawn on the map (one character per tile, so keep it short). */
  shortName: z.string().min(1).max(9),
  /** Center of the zone on the map, in tiles. Only used for drawing: the rules use `adjacent`. */
  position: z.object({ x: Int, y: Int }),
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
  /** Color for the map and the interface. */
  color: HexColorSchema,
  /** AI profile from ai.json used when the computer plays this faction, or null if it never gives orders. */
  aiProfile: z.string().nullable(),
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

// ---------- ai.json ----------
// Weights for the AI's scoring. Scores are roughly in "dollars of value" so they can be compared.

export const AiProfileSchema = z.object({
  /** Value per expected $ of income. */
  incomeWeight: z.number().nonnegative(),
  /** Value per control point gained, × zone wealth. */
  controlWeight: z.number().nonnegative(),
  /** Value per control point taken from a rival, × zone wealth. */
  takeWeight: z.number().nonnegative(),
  /** Extra value when an action makes the faction owner of the zone. */
  ownershipBonus: z.number().nonnegative(),
  /** Extra value when an intimidation hits the faction's current enemy. */
  enemyBonus: z.number().nonnegative(),
  /** Cost per heat point an action adds. */
  heatPenalty: z.number().nonnegative(),
  /** Cost × arrest chance. */
  arrestPenalty: z.number().nonnegative(),
  lieLowHeatThreshold: z.number(),
  lieLowWeight: z.number().nonnegative(),
  bribeHeatThreshold: z.number(),
  bribeWeightPerHeat: z.number().nonnegative(),
  /** The AI recruits while it has fewer living members than this. */
  recruitTargetMembers: z.number().int().nonnegative(),
  recruitWeight: z.number().nonnegative(),
  /** Money below `weeks × weekly wages` counts as "low money": income gets multiplied. */
  moneyReserveWeeks: z.number().nonnegative(),
  lowMoneyIncomeMultiplier: z.number().nonnegative(),
  /** A faction whose relation towards us is at or below this is our enemy. */
  enemyRelationThreshold: z.number(),
  /**
   * How much more a control point is worth where the faction is already strong:
   * factor = 1 − c/2 + c × ownControl/100 (0 = all zones alike, 1 = from ×0.5 at 0 control to ×1.5 at 100).
   */
  consolidationWeight: z.number().min(0).max(1),
  /** Multiplier for taking control back in zones the faction owns or where it has its HQ. */
  defenseMultiplier: z.number().nonnegative(),
  /** With low money, expansion and recruiting are worth this much (income is prioritised). */
  lowMoneyInvestmentMultiplier: z.number().nonnegative(),
  /** Random variation applied to each score (0.15 = ±15%). */
  noise: z.number().min(0).max(1),
});
export type AiProfile = z.infer<typeof AiProfileSchema>;

export const AiSchema = z.object({
  profiles: z.record(z.string(), AiProfileSchema),
});
export type AiData = z.infer<typeof AiSchema>;

// ---------- ui.json ----------
// Presentation settings: tile size, map size in tiles, colors. No game rules here.

export const UiSchema = z.object({
  tileSize: Int.positive(),
  maxScale: Int.positive(),
  map: z.object({ width: Int.positive(), height: Int.positive() }),
  font: z.object({ family: z.string().min(1), size: Int.positive() }),
  colors: z.object({
    background: HexColorSchema,
    road: HexColorSchema,
    neutral: HexColorSchema,
    glyph: HexColorSchema,
    label: HexColorSchema,
    labelDim: HexColorSchema,
    selected: HexColorSchema,
    heat: HexColorSchema,
  }),
});
export type UiConfig = z.infer<typeof UiSchema>;

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
  ai: AiSchema,
  ui: UiSchema,
  strings: StringsSchema,
});
export type GameData = z.infer<typeof GameDataSchema>;

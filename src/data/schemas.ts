// zod schemas for the content files in /data.
// These check the *shape* of each file. Cross-file references and balance
// ranges are checked afterwards in validate.ts.

import { z } from "zod";
import {
  CurrencySchema,
  FactionKindSchema,
  IdSchema,
  MoneySchema,
  RankSchema,
  StatKeySchema,
  StatsSchema,
  TraitSchema,
  VOTE_TYPES,
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
    impeachmentWeeks: Int.positive(),
    maxProposalsPerWeek: Int.nonnegative(),
    /** P(vote with the president) = base + (loyalty − 50)·perLoyaltyAbove50 + trait modifier + momentum, clamped. */
    vote: z.object({
      base: Probability,
      perLoyaltyAbove50: z.number(),
      /** Momentum = (owned zones now − owned zones `momentumWeeks` ago) × momentumPerZone. */
      momentumPerZone: z.number(),
      momentumWeeks: Int.positive(),
      minChance: Probability,
      maxChance: Probability,
    }),
    /** Loyalty gained by voters when a lost vote is respected. */
    respectBonus: z.number().nonnegative(),
    /** Loyalty lost by voters when the president forces a lost vote. */
    ignorePenalty: z.number().nonnegative(),
    promotionLoyalty: z.number().nonnegative(),
    /** Relation both sides drop to (at most) when war is declared. */
    warRelation: z.number(),
    truceWeeks: Int.positive(),
    /** A rival accepts a truce if its relation towards us is at least this, or if it's not ahead in zones. */
    truceAcceptRelation: z.number(),
  }),
  laundering: z.object({
    /** Laundering above this share of capacity draws federal attention (GDD §8). */
    federalAttentionCapacityRatio: z.number().min(0).max(1),
    /** Federal points per whole capacity laundered above the ratio. */
    federalPerExcess: z.number().nonnegative(),
  }),
  market: z.object({
    /** Price goes from base × (1 + variance) with no recent supply to base × (1 − variance) at the reference. */
    priceVariance: z.number().min(0).max(1),
    /** Share of the recent supply that remains each week. */
    supplyDecay: z.number().min(0).max(1),
  }),
  combat: z.object({
    randomMax: Int.nonnegative(),
    gunBonusPerCrate: z.number().nonnegative(),
    cratesPerFighter: Int.nonnegative(),
    hqDefenseBonus: z.number().nonnegative(),
    /** Control the winner takes from the loser in the zone. */
    controlSwing: z.number().nonnegative(),
    loserWoundChance: Probability,
    loserJailChance: Probability,
    loserDeathChance: Probability,
    winnerWoundChance: Probability,
    woundWeeksMin: Int.positive(),
    woundWeeksMax: Int.positive(),
    /** Heat a fight adds to the zone on top of the task's own heat. */
    extraHeat: z.number().nonnegative(),
  }),
  cartel: z.object({
    /** Dirty money per gun crate under a deal. */
    dealPrice: z.number().positive(),
    /** The cartel only deals with clubs it regards at least this well. */
    dealMinRelation: z.number(),
    purchaseRelationGain: z.number().nonnegative(),
    /** Weeks without buying before the cartel considers the deal broken. */
    graceWeeks: Int.positive(),
    breachRelationPenalty: z.number().nonnegative(),
    /** Where shipments are picked up. */
    portZoneId: IdSchema,
    /** Chance per heat point at the port that a shipment is seized. */
    interceptPerHeat: z.number().nonnegative(),
  }),
  events: z.object({
    weeklyChance: Probability,
    cooldownWeeks: Int.nonnegative(),
  }),
  federal: z.object({
    visibleFrom: z.number(),
    /** Per zone at or above the raid threshold where the faction has control. */
    perHotZone: z.number().nonnegative(),
    perInformant: z.number().nonnegative(),
    /** Drop for a week without any illegal task. */
    lowProfileDrop: z.number().nonnegative(),
    informantExpelledDrop: z.number().nonnegative(),
    perGunRun: z.number().nonnegative(),
    perCombat: z.number().nonnegative(),
    perDeath: z.number().nonnegative(),
    /** After a federal raid on an AI club, its investigation drops to this. */
    raidResetTo: z.number(),
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
    intimidate: z.object({
      baseGain: Int,
      strengthDivisor: Int.positive(),
      /** Extra control moved when intimidating a faction we're at war with. */
      warBonus: Int.nonnegative(),
    }),
    protection: z.object({ rate: z.number(), charmBase: z.number(), perCharm: z.number() }),
    stealBikes: z.object({ goodId: IdSchema, min: Int.nonnegative(), max: Int.nonnegative() }),
    /** Crates sold per gun run: baseCrates + Cunning / cunningDivisor (GDD §9, chain B). */
    gunRun: z.object({ goodId: IdSchema, baseCrates: Int.nonnegative(), cunningDivisor: Int.positive() }),
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
    /** At or below this relation (and without war or truce) two factions are "in tension". */
    tensionAt: z.number(),
  }),
  /** Weekly loyalty changes (GDD §6). */
  loyalty: z.object({
    unpaidPenalty: z.number().nonnegative(),
    paidBonus: z.number().nonnegative(),
    /** Weekly passive bonuses (wages, bar) don't raise loyalty above this. Victories, promotions and events can. */
    passiveCap: z.number(),
    zoneGainedBonus: z.number().nonnegative(),
    zoneLostPenalty: z.number().nonnegative(),
    /** Lost by every other member for each member of the club arrested this week. */
    arrestPenalty: z.number().nonnegative(),
    /** Lost by every member when a fellow member dies. */
    deathPenalty: z.number().nonnegative(),
    warLongWeeks: Int.nonnegative(),
    warWeeklyPenalty: z.number().nonnegative(),
    traitLikeBonus: z.number().nonnegative(),
    traitDislikePenalty: z.number().nonnegative(),
    /** Weekly chances for a member under `club.lowLoyaltyThreshold`. */
    desertChance: Probability,
    informantChance: Probability,
    /** Weekly chance that the club hears a rumour about an informant. */
    informantHintChance: Probability,
  }),
  /** Sheriff and police (GDD §10). */
  law: z.object({
    raidChance: Probability,
    /** Sheriff relation from which he warns before raiding. */
    sheriffWarnRelation: z.number(),
    crackdownArrestChance: Probability,
    crackdownHeatDrop: z.number().nonnegative(),
    /** Task heat is reduced by up to this fraction, proportional to a positive sheriff relation. */
    sheriffHeatReductionMax: Probability,
    /** The sheriff's goodwill fades this much per week towards 0. */
    sheriffRelationDecay: z.number().nonnegative(),
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
  /** Market base price (GDD §9), or null if it can't be sold directly (stolen bikes go to the chop shop). */
  basePrice: z.number().positive().nullable(),
  /** Money received when sold. */
  saleCurrency: CurrencySchema.nullable(),
  /** Units sold per week that push the price to its minimum. */
  marketReference: z.number().nonnegative(),
});
export type GoodDef = z.infer<typeof GoodDefSchema>;

// ---------- businesses.json ----------

export const BusinessDefSchema = z.object({
  id: IdSchema,
  legal: z.boolean(),
  glyph: GlyphSchema,
  /** Paid in clean money (GDD §8). */
  buildCost: z.number().nonnegative(),
  /** Weekly upkeep (GDD §8). */
  maintenance: z.number().nonnegative(),
  /** Dirty money this business can launder per week (GDD §8). */
  launderCapacity: z.number().nonnegative(),
  /** Chop shop: stolen bikes → parts (GDD §9, chain A). */
  chop: z
    .object({ inputGoodId: IdSchema, outputGoodId: IdSchema, bikesPerWeek: Int.positive(), partsPerBike: Int.positive() })
    .optional(),
  /** Garage: parts → custom bikes; members working there add capacity for the next week. */
  garage: z
    .object({
      inputGoodId: IdSchema,
      outputGoodId: IdSchema,
      baseOutput: Int.nonnegative(),
      partsPerUnit: Int.positive(),
      handsPerExtraUnit: Int.positive(),
    })
    .optional(),
  /** Club bar: small clean income and a loyalty bonus for the whole club. */
  bar: z.object({ incomePerWealth: z.number().nonnegative(), loyaltyBonus: z.number().nonnegative() }).optional(),
  /** Warehouse: how many units of a good the faction can hold. */
  storage: z.object({ goodId: IdSchema, capacity: Int.positive() }).optional(),
});
export type BusinessDef = z.infer<typeof BusinessDefSchema>;

// ---------- events.json ----------
// Narrative events (GDD §13): conditions, a subject, options and effects, all as data.

export type EventEffect =
  | { type: "money"; currency: "clean" | "dirty"; amount: number }
  | { type: "loyalty"; target: "all" | "subject" | "others"; amount: number }
  | { type: "sheriff"; amount: number }
  | { type: "rival_relation"; amount: number }
  | { type: "heat"; zoneId: string; amount: number }
  | { type: "promote_subject"; rank: "member" }
  | { type: "defect_subject" }
  | { type: "jail_random"; weeks: number }
  | { type: "expose_informant" }
  | { type: "chance"; probability: number; success: EventEffect[]; failure: EventEffect[] };

export const EventEffectSchema: z.ZodType<EventEffect> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("money"), currency: CurrencySchema, amount: z.number() }),
    z.object({ type: z.literal("loyalty"), target: z.enum(["all", "subject", "others"]), amount: z.number() }),
    z.object({ type: z.literal("sheriff"), amount: z.number() }),
    z.object({ type: z.literal("rival_relation"), amount: z.number() }),
    z.object({ type: z.literal("heat"), zoneId: IdSchema, amount: z.number() }),
    z.object({ type: z.literal("promote_subject"), rank: z.literal("member") }),
    z.object({ type: z.literal("defect_subject") }),
    z.object({ type: z.literal("jail_random"), weeks: Int.positive() }),
    z.object({ type: z.literal("expose_informant") }),
    z.object({
      type: z.literal("chance"),
      probability: Probability,
      success: z.array(EventEffectSchema),
      failure: z.array(EventEffectSchema),
    }),
  ]),
);

export const EventDefSchema = z.object({
  id: IdSchema,
  /** Relative chance among the events that can happen this week. */
  weight: z.number().positive(),
  conditions: z.object({
    minWeek: Int.optional(),
    hasProspect: z.boolean().optional(),
    hasInformant: z.boolean().optional(),
    /** The rival club (victory.rivalToExpel) has at least this many living members. */
    rivalMinMembers: Int.optional(),
  }),
  /** Who the event is about: one of our prospects, a member of the rival club, or nobody. */
  subject: z.enum(["prospect", "rival_member"]).nullable(),
  /** Applied if the player doesn't choose, or can't afford the chosen option. */
  defaultOption: IdSchema,
  options: z.array(z.object({ id: IdSchema, effects: z.array(EventEffectSchema) })).min(1),
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
  /** Value added when the member's trait enjoys the task, and subtracted when it resents it (loyalty, GDD §6). */
  traitLikeWeight: z.number().nonnegative(),
  traitDislikeWeight: z.number().nonnegative(),
  /** Cost of an illegal task that would push a zone to the crackdown threshold. */
  crackdownPenalty: z.number().nonnegative(),
  /** Value of goods relative to their market price (they still have to be processed or sold). */
  goodsWeight: z.number().nonnegative(),
  /** Value of destroying a rival business, × its build cost × the estimated chance of winning. */
  attackWeight: z.number().nonnegative(),
  /** Value of guarding a zone with our businesses that rivals can reach, × their build cost (first guard only). */
  defendWeight: z.number().nonnegative(),
  /** Money the AI keeps aside before building, laundering or buying. */
  cashReserve: z.number().nonnegative(),
  /** If set, the AI only acts in these zones (the cartel stays at the port). */
  allowedZones: z.array(IdSchema).nullable(),
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
    /** Center glyph of zones where we planned tasks this week. */
    planned: HexColorSchema,
  }),
  /** Color of each zone's center glyph by type. */
  zoneTypeColors: z.record(ZoneTypeSchema, HexColorSchema),
});
export type UiConfig = z.infer<typeof UiSchema>;

// ---------- traits.json ----------
// Which tasks each trait enjoys or resents (GDD §6: "contradecir el rasgo del miembro").

export const TraitsSchema = z.object({
  tasks: z.record(TraitSchema, z.object({ likes: z.array(IdSchema), dislikes: z.array(IdSchema) })),
});
export type TraitsData = z.infer<typeof TraitsSchema>;

// ---------- council.json ----------
// How each trait shifts the chance of voting with the president, per proposal type.


export const CouncilSchema = z.object({
  traitModifiers: z.record(z.enum(VOTE_TYPES), z.record(TraitSchema, z.number())),
});
export type CouncilData = z.infer<typeof CouncilSchema>;

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
  traits: TraitsSchema,
  council: CouncilSchema,
  strings: StringsSchema,
});
export type GameData = z.infer<typeof GameDataSchema>;

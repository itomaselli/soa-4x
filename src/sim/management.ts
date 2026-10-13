// Management orders (GDD §4 step 4 "Gestión"): build, sell, launder, buy guns.
// Same validation for the player, the AI and the UI.

import { z } from "zod";
import type { GameData } from "../data/schemas";
import { businessDef, buildProblem, launderCapacity, storageCapacity } from "./systems/businesses";
import { getStance } from "./systems/diplomacy";
import { IdSchema, type GameState } from "./state";

export const ManagementOrderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build"), factionId: IdSchema, typeId: IdSchema, zoneId: IdSchema, lot: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("sell"), factionId: IdSchema, goodId: IdSchema, quantity: z.number().int().positive() }),
  z.object({ kind: z.literal("launder"), factionId: IdSchema, amount: z.number().int().positive() }),
  z.object({ kind: z.literal("buy"), factionId: IdSchema, goodId: IdSchema, quantity: z.number().int().positive() }),
]);
export type ManagementOrder = z.infer<typeof ManagementOrderSchema>;

export function cartelId(data: GameData): string | null {
  return data.factions.find((f) => f.kind === "cartel")?.id ?? null;
}

/** Returns a strings.es.json key with the problem, or null if the order can be carried out right now. */
export function validateManagement(state: GameState, data: GameData, order: ManagementOrder): string | null {
  const faction = state.factions[order.factionId];
  if (!faction) return "management_error.unknown_faction";
  switch (order.kind) {
    case "build": {
      if (businessDef(data, order.typeId)?.legal === false) return "management_error.illegal_needs_council";
      return buildProblem(state, data, order.factionId, order.typeId, order.zoneId, order.lot);
    }
    case "sell": {
      const good = data.goods.find((g) => g.id === order.goodId);
      if (!good || good.basePrice === null) return "management_error.not_sellable";
      if (good.streetOnly) return "management_error.street_only";
      if ((faction.stock[order.goodId] ?? 0) < order.quantity) return "management_error.not_enough_stock";
      return null;
    }
    case "launder":
      if (launderCapacity(state, data, order.factionId) <= 0) return "management_error.no_laundering";
      return null;
    case "buy": {
      const cartel = cartelId(data);
      if (!cartel || getStance(state, order.factionId, cartel)?.type !== "deal") return "management_error.no_deal";
      const price = data.balance.cartel.catalog[order.goodId];
      if (price === undefined) return "management_error.not_in_catalog";
      const capacity = storageCapacity(state, data, order.factionId, order.goodId) ?? 0;
      if ((faction.stock[order.goodId] ?? 0) + order.quantity > capacity) return "management_error.no_storage";
      if (faction.money.dirty < order.quantity * price) return "management_error.no_money";
      return null;
    }
  }
}

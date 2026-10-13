// Zone control helpers (GDD §5).
// Rule: the sum of every faction's control in a zone never exceeds the control range max (100).
// Guarding only fills free space; to take control from someone you have to intimidate them.

import type { Balance } from "../../data/schemas";
import type { GameState, ZoneState } from "../state";

export function controlOf(zone: ZoneState, factionId: string): number {
  return zone.control[factionId] ?? 0;
}

export function totalControl(zone: ZoneState): number {
  return Object.values(zone.control).reduce((sum, v) => sum + v, 0);
}

export function freeControl(zone: ZoneState, balance: Balance): number {
  return Math.max(0, balance.ranges.control.max - totalControl(zone));
}

/** Adds up to `amount` control, limited by the free space. Returns what was actually gained. */
export function gainControl(zone: ZoneState, factionId: string, amount: number, balance: Balance): number {
  const gained = Math.max(0, Math.min(amount, freeControl(zone, balance)));
  if (gained > 0) zone.control[factionId] = controlOf(zone, factionId) + gained;
  return gained;
}

/** Removes up to `amount` control (never below the range min). Returns what was actually lost. */
export function loseControl(zone: ZoneState, factionId: string, amount: number, balance: Balance): number {
  const current = controlOf(zone, factionId);
  const lost = Math.max(0, Math.min(amount, current - balance.ranges.control.min));
  if (lost > 0) zone.control[factionId] = current - lost;
  return lost;
}

/**
 * Strongest other faction in the zone (ties broken by id), or null if nobody else has control.
 * Factions in `exclude` (e.g. truce partners) are skipped.
 */
export function strongestRival(zone: ZoneState, factionId: string, exclude: readonly string[] = []): string | null {
  let best: string | null = null;
  let bestValue = 0;
  for (const id of Object.keys(zone.control).sort()) {
    const value = controlOf(zone, id);
    if (id !== factionId && !exclude.includes(id) && value > bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

/**
 * Owner of a zone: the faction with more than `ownerMinimum` control that leads
 * the second one by at least `ownerLeadMargin` (GDD §5). null if nobody qualifies.
 */
export function zoneOwner(zone: ZoneState, balance: Balance): string | null {
  const sorted = Object.entries(zone.control).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [first, second] = sorted;
  if (!first) return null;
  const [leaderId, leaderControl] = first;
  const secondControl = second?.[1] ?? 0;
  if (leaderControl > balance.control.ownerMinimum && leaderControl - secondControl >= balance.control.ownerLeadMargin) {
    return leaderId;
  }
  return null;
}

/** Ids of zones owned by the faction, in state order. */
export function ownedZones(state: GameState, factionId: string, balance: Balance): string[] {
  return Object.values(state.zones)
    .filter((z) => zoneOwner(z, balance) === factionId)
    .map((z) => z.id);
}

/** Ids of zones where the faction has any control. */
export function factionZonePresence(state: GameState, factionId: string): string[] {
  return Object.values(state.zones)
    .filter((z) => controlOf(z, factionId) > 0)
    .map((z) => z.id);
}

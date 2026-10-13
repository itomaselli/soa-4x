// Stable 32-bit hash of an id (FNV-1a), used as a seed so the same id always draws the same thing:
// a zone's local map, a member's portrait.

export function hashId(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

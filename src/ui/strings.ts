import type { Strings } from "../data/schemas";

/** Looks up a Spanish UI string and fills `{placeholders}`. Missing keys show as `⟨key⟩` so they're easy to spot. */
export function t(strings: Strings, key: string, params: Record<string, string | number> = {}): string {
  const template = strings[key];
  if (template === undefined) return `⟨${key}⟩`;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

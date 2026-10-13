import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Golden rules from CLAUDE.md, checked on the source text so they hold even if lint is skipped.

const SIM_DIR = join(import.meta.dirname, "..", "src", "sim");

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listTsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const simFiles = listTsFiles(SIM_DIR).map((path) => ({ path, source: readFileSync(path, "utf8") }));

describe("reglas de oro de src/sim", () => {
  it("hay archivos de simulación para revisar", () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it("no usa Math.random ni la fecha del sistema", () => {
    for (const { path, source } of simFiles) {
      expect(source, path).not.toMatch(/Math\.random|Date\.now|new Date\b/);
    }
  });

  it("no importa render, ui, PixiJS ni APIs del navegador", () => {
    for (const { path, source } of simFiles) {
      expect(source, path).not.toMatch(/from\s+["'][^"']*\/(render|ui)\//);
      expect(source, path).not.toMatch(/from\s+["']pixi\.js/);
      expect(source, path).not.toMatch(/\b(window|document|localStorage)\./);
    }
  });

  it("de src/data solo importa tipos", () => {
    for (const { path, source } of simFiles) {
      const valueImports = source.match(/^import\s+(?!type\b)[^;]*from\s+["'][^"']*\/data\/[^"']*["']/gm) ?? [];
      expect(valueImports, path).toEqual([]);
    }
  });
});

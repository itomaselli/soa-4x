import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/", "src-tauri/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Golden rules for the pure simulation: no DOM, no rendering, no non-determinism.
  {
    files: ["src/sim/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/render/**", "**/ui/**"], message: "src/sim must not import render or ui." },
            { group: ["**/data/**"], allowTypeImports: true, message: "src/sim may only import types from src/data; content is passed in as arguments." },
            { group: ["pixi.js", "pixi.js/*"], message: "src/sim must not depend on PixiJS." },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded rng from src/sim/rng.ts." },
        { object: "Date", property: "now", message: "The simulation must not depend on wall-clock time." },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The simulation must not depend on wall-clock time." },
        { name: "window", message: "src/sim must run in Node." },
        { name: "document", message: "src/sim must run in Node." },
        { name: "localStorage", message: "src/sim must run in Node." },
      ],
    },
  },
);

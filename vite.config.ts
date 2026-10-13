import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tauri (desktop build) expects a fixed port and wants to see its own logs.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});

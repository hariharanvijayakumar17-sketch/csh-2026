import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests run against a REAL Postgres (brief §5.5 / §9).
 * They are deliberately NOT part of `npm test` (unit) so the unit suite
 * stays fast and dependency-free.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` (Next) throws in plain node; stub it for tests.
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/integration/**/*.test.ts"],
    setupFiles: ["./test/int-env.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});

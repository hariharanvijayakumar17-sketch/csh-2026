import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // integration tests run against real Postgres via `npm run test:int`
    exclude: ["**/node_modules/**", "**/e2e/**", "src/integration/**"],
    testTimeout: 30000,
  },
});

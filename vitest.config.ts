import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same alias the Next.js build uses, so route handlers can be imported
    // straight into tests.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

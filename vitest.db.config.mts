import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests that need PostgreSQL. Run with `npm run test:db` (uses the throwaway superdrive_test DB).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

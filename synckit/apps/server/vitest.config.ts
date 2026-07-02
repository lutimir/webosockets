import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Integration tests share one Fastify/Postgres/Redis stack per file; keep
    // files sequential so they never fight over ports or fixtures.
    fileParallelism: false,
    // Expose gc so the heap-leak test can measure deterministically.
    poolOptions: { forks: { execArgv: ["--expose-gc"] } },
  },
});

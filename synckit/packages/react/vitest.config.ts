import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Exposes afterEach globally so Testing Library auto-cleans the DOM.
    globals: true,
    testTimeout: 10_000,
  },
});

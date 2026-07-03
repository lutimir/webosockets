import { defineConfig } from "@playwright/test";

export const SERVER_PORT = 4101;
const DASHBOARD_PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${DASHBOARD_PORT}`,
    // Use the environment's pre-provisioned Chromium when present (its
    // revision may differ from the one this Playwright version would fetch).
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH
      ? {
          launchOptions: {
            executablePath:
              process.env.PLAYWRIGHT_CHROMIUM_PATH ??
              `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
          },
        }
      : {}),
  },
  webServer: [
    {
      command: "pnpm db:migrate && pnpm exec tsx src/index.ts",
      cwd: "../server",
      url: `http://127.0.0.1:${SERVER_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        NODE_ENV: "test",
        PORT: String(SERVER_PORT),
        HOST: "127.0.0.1",
      },
    },
    {
      command: `pnpm exec next dev --port ${DASHBOARD_PORT}`,
      url: `http://127.0.0.1:${DASHBOARD_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SERVER_INTERNAL_URL: `http://127.0.0.1:${SERVER_PORT}`,
        NEXT_PUBLIC_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`,
      },
    },
  ],
});

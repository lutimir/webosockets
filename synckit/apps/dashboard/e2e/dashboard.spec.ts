import { expect, test } from "@playwright/test";

import { SERVER_PORT } from "../playwright.config";

const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const uniq = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function mintToken(apiKey: string): Promise<{ status: number; token?: string }> {
  const response = await fetch(`${SERVER}/v1/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ externalUserId: `e2e-user-${uniq}`, displayName: "E2E User" }),
  });
  if (!response.ok) return { status: response.status };
  const body = (await response.json()) as { token: string };
  return { status: response.status, token: body.token };
}

test("signup → onboarding → live connection on dashboard → revoke kills the key", async ({
  page,
}) => {
  // ── Signup creates the organization and lands on onboarding ────────────────
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Company / organization").fill(`E2E Co ${uniq}`);
  await page.getByLabel("Email").fill(`e2e-${uniq}@example.com`);
  await page.getByLabel("Password (min 8 chars)").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");

  // ── Step 1: create a project ────────────────────────────────────────────────
  await page.getByLabel("Project name").fill("E2E App");
  await page.getByRole("button", { name: "Create project" }).click();

  // ── Step 2: the API key is shown exactly once — capture it ────────────────
  const apiKey = (await page.getByTestId("api-key").textContent())?.trim();
  expect(apiKey).toMatch(/^sk_dev_/);
  await page.getByRole("button", { name: "I stored it — continue" }).click();

  // ── Step 3: waiting for the first connection ───────────────────────────────
  await expect(page.getByTestId("connection-status")).toContainText("Waiting for first connection");

  // A scripted client connects using the captured key (customer-style flow).
  const mint = await mintToken(apiKey!);
  expect(mint.status).toBe(200);
  const ws = new WebSocket(`ws://127.0.0.1:${SERVER_PORT}/v1/realtime?token=${mint.token!}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws failed")));
  });
  ws.send(JSON.stringify({ type: "join_room", roomExternalId: "e2e-room" }));

  await expect(page.getByTestId("connection-status")).toContainText("First connection received", {
    timeout: 20_000,
  });

  // ── Overview shows the live connection ─────────────────────────────────────
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await page.waitForURL("**/projects/**");
  await expect(page.getByTestId("active-connections")).toHaveText("1", { timeout: 20_000 });

  // The room shows up with live presence.
  await page.getByRole("link", { name: "Rooms" }).click();
  await page.getByRole("link", { name: /e2e-room/ }).click();
  await expect(page.getByTestId("presence-list")).toContainText("E2E User", { timeout: 15_000 });

  // ── Revoke the key: minting new tokens must fail with 401 ─────────────────
  await page.getByRole("link", { name: "API Keys" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("revoked")).toBeVisible();

  await expect.poll(async () => (await mintToken(apiKey!)).status).toBe(401);
  ws.close();
});

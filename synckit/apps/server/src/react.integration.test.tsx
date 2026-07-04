// @vitest-environment jsdom
//
// The server runs in a CHILD PROCESS here: jsdom overrides globals like
// TextEncoder, which breaks server-side crypto (jose) when both run in one
// realm. The split also mirrors reality — the SDK is browser code.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { createClient, type SyncKitClient } from "@synckit/client";
import { RoomProvider, SyncKitProvider, useOthers, useUpdateMyPresence } from "@synckit/react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKey, createOrganization, createProject } from "./repos/index.js";
import { createTestDb } from "./test/db.js";

let server: ChildProcess;
let closeTestDb: () => Promise<void>;
let wsUrl: string;
let httpUrl: string;
let apiKey: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const testDb = await createTestDb();
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  const org = await createOrganization(testDb.db, { name: "R", slug: "react-int-org" });
  const project = await createProject(testDb.db, {
    organizationId: org.id,
    name: "R",
    slug: "react-int",
    environment: "dev",
  });
  apiKey = (await createApiKey(testDb.db, { projectId: project.id, environment: "dev" })).key;

  const port = await freePort();
  httpUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/v1/realtime`;

  // vitest runs with cwd = apps/server, where src/index.ts lives.
  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_URL: testDb.databaseUrl,
    },
    stdio: "ignore",
  });

  // Wait until the child server answers.
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("child server did not start");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}, 60_000);

afterAll(async () => {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  server.kill("SIGKILL");
  await closeTestDb();
});

function sdk(endUserId: string, displayName: string): SyncKitClient {
  return createClient({
    url: wsUrl,
    // The realistic customer setup: the backend mints tokens via REST.
    tokenProvider: async () => {
      const response = await fetch(`${httpUrl}/v1/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ externalUserId: endUserId, displayName }),
      });
      if (!response.ok) throw new Error(`token mint failed: ${response.status}`);
      const body = (await response.json()) as { token: string };
      return body.token;
    },
    // jsdom provides a browser-like global WebSocket — the SDK picks it up.
    reconnectMinDelayMs: 50,
    reconnectMaxDelayMs: 200,
  });
}

function CursorsProbe({ label }: { label: string }) {
  const others = useOthers();
  return (
    <ul data-testid={`others-${label}`}>
      {others.map((entry) => {
        const cursor = (entry.data as { cursor?: { x: number; y: number } } | null)?.cursor;
        return (
          <li key={entry.endUserId}>
            {entry.endUserId}
            {cursor ? `@${cursor.x},${cursor.y}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

function MoveButton() {
  const update = useUpdateMyPresence(1);
  return (
    <button type="button" onClick={() => update({ cursor: { x: 123, y: 456 } })}>
      move
    </button>
  );
}

describe("two React clients against a real server", () => {
  it("see each other's live cursors end to end", async () => {
    const roomId = `react-room-${randomUUID()}`;
    const alice = sdk("alice", "Alice");
    const bob = sdk("bob", "Bob");

    try {
      render(
        <>
          <SyncKitProvider client={alice}>
            <RoomProvider id={roomId} initialPresence={{ cursor: null }}>
              <CursorsProbe label="alice" />
              <MoveButton />
            </RoomProvider>
          </SyncKitProvider>
          <SyncKitProvider client={bob}>
            <RoomProvider id={roomId} initialPresence={{ cursor: { x: 1, y: 2 } }}>
              <CursorsProbe label="bob" />
            </RoomProvider>
          </SyncKitProvider>
        </>,
      );

      // Both sides see each other, including Bob's initial cursor.
      await waitFor(
        () => {
          expect(screen.getByTestId("others-alice").textContent).toContain("bob@1,2");
          expect(screen.getByTestId("others-bob").textContent).toContain("alice");
        },
        { timeout: 10_000 },
      );

      // Alice moves her cursor through the React hook — Bob's tree updates.
      act(() => {
        screen.getByRole("button", { name: "move" }).click();
      });
      await waitFor(
        () => expect(screen.getByTestId("others-bob").textContent).toContain("alice@123,456"),
        { timeout: 10_000 },
      );
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  }, 40_000);
});

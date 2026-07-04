"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

type Step = 1 | 2 | 3;

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

function snippet(kind: "react" | "js" | "curl", key: string): string {
  if (kind === "curl") {
    return `curl -X POST ${SERVER_URL}/v1/tokens \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"externalUserId":"user-1","displayName":"Ada"}'`;
  }
  if (kind === "js") {
    return `import { createClient } from "@synckit/client";

const client = createClient({
  url: "${SERVER_URL.replace("http", "ws")}/v1/realtime",
  tokenProvider: () => fetch("/api/synckit-token").then(r => r.json()).then(b => b.token),
});
const room = client.joinRoom("my-first-room", { initialPresence: { cursor: null } });
room.presence.subscribe(others => console.log("online:", others));`;
  }
  return `import { SyncKitProvider, RoomProvider, LiveCursors } from "@synckit/react";

<SyncKitProvider client={client}>
  <RoomProvider id="my-first-room">
    <LiveCursors />
  </RoomProvider>
</SyncKitProvider>`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"react" | "js" | "curl">("react");
  const [connected, setConnected] = useState(false);

  // Step 3: poll until the first realtime connection shows up.
  useEffect(() => {
    if (step !== 3 || !slug || connected) return;
    const timer = setInterval(() => {
      void fetch(`/api/projects/${slug}/stats`)
        .then((response) => response.json())
        .then((stats: { activeConnections?: number; messages24h?: number }) => {
          if ((stats.activeConnections ?? 0) > 0 || (stats.messages24h ?? 0) > 0) {
            setConnected(true);
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [step, slug, connected]);

  async function createProject() {
    setBusy(true);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: projectName, environment: "dev" }),
    });
    const body = (await response.json()) as { project?: { slug: string } };
    if (body.project) {
      setSlug(body.project.slug);
      const keyResponse = await fetch(`/api/projects/${body.project.slug}/api-keys`, {
        method: "POST",
      });
      const keyBody = (await keyResponse.json()) as { key?: string };
      setApiKey(keyBody.key ?? null);
      setStep(2);
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`flex h-6 w-6 items-center justify-center rounded-full ${
              step >= n ? "bg-indigo-600 text-white" : "bg-zinc-800"
            }`}
          >
            {n}
          </span>
        ))}
        <span className="ml-2">Get your app collaborative in 3 steps</span>
      </div>

      {step === 1 && (
        <Card>
          <h1 className="mb-4 text-lg font-semibold">1. Create your first project</h1>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Project name">
                <Input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="My App"
                />
              </Field>
            </div>
            <Button onClick={() => void createProject()} disabled={!projectName.trim() || busy}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && apiKey && (
        <Card>
          <h1 className="mb-2 text-lg font-semibold">2. Copy your API key</h1>
          <p className="mb-4 text-sm text-amber-400">
            This key is shown only once — store it in your secret manager now.
          </p>
          <div className="flex items-center gap-3">
            <code
              data-testid="api-key"
              className="flex-1 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-sm text-emerald-300"
            >
              {apiKey}
            </code>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(apiKey).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </Button>
          </div>
          <div className="mt-5 text-right">
            <Button onClick={() => setStep(3)}>I stored it — continue</Button>
          </div>
        </Card>
      )}

      {step === 3 && apiKey && slug && (
        <Card>
          <h1 className="mb-4 text-lg font-semibold">3. Make your first connection</h1>
          <div className="mb-3 flex gap-2">
            {(["react", "js", "curl"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setTab(kind)}
                className={`rounded px-3 py-1 text-sm ${
                  tab === kind ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {kind === "react" ? "React" : kind === "js" ? "JavaScript" : "curl"}
              </button>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">
            {snippet(tab, apiKey)}
          </pre>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm" data-testid="connection-status">
              {connected ? (
                <span className="text-emerald-400">✓ First connection received!</span>
              ) : (
                <span className="animate-pulse text-zinc-400">Waiting for first connection…</span>
              )}
            </p>
            <Button onClick={() => router.push(`/projects/${slug}`)}>Go to dashboard</Button>
          </div>
        </Card>
      )}
    </main>
  );
}

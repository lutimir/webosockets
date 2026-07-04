"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card } from "./ui";

export function CreateKeyButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    const response = await fetch(`/api/projects/${slug}/api-keys`, { method: "POST" });
    const body = (await response.json()) as { key?: string };
    setKey(body.key ?? null);
    setBusy(false);
  }

  return (
    <>
      <Button onClick={() => void create()} disabled={busy}>
        {busy ? "Creating…" : "Create API key"}
      </Button>
      {key && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New API key"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          <Card className="w-full max-w-lg">
            <h2 className="mb-2 text-lg font-semibold">Your new API key</h2>
            <p className="mb-4 text-sm text-amber-400">
              Copy it now — for security it will never be shown again.
            </p>
            <code
              data-testid="new-api-key"
              className="block overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-sm text-emerald-300"
            >
              {key}
            </code>
            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(key).catch(() => undefined);
                  setCopied(true);
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </Button>
              <Button
                onClick={() => {
                  setKey(null);
                  router.refresh();
                }}
              >
                Done
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export function RevokeKeyButton({ id, prefix }: { id: string; prefix: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="danger"
      disabled={busy}
      onClick={() => {
        if (!window.confirm(`Revoke key ${prefix}…? Applications using it will stop working.`)) {
          return;
        }
        setBusy(true);
        void fetch(`/api/api-keys/${id}/revoke`, { method: "POST" }).then(() => {
          router.refresh();
        });
      }}
    >
      Revoke
    </Button>
  );
}

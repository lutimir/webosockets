"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Field, Input } from "./ui";

export function RenameOrgForm({ current }: { current: string }) {
  const router = useRouter();
  const [name, setName] = useState(current);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex items-end gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void fetch("/api/organization", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        }).then(() => {
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="flex-1">
        <Field label="Organization name">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
      </div>
      <Button type="submit">{saved ? "Saved ✓" : "Save"}</Button>
    </form>
  );
}

export function InviteForm() {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/organization/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
    });
    const body = (await response.json()) as { link?: string; error?: { message?: string } };
    if (response.ok && body.link) {
      setLink(body.link);
      setError(null);
    } else {
      setError(body.error?.message ?? "invite failed");
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Email">
            <Input name="email" type="email" placeholder="teammate@company.com" required />
          </Field>
        </div>
        <Field label="Role">
          <select
            name="role"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            defaultValue="member"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </Field>
        <Button type="submit">Invite</Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {link && (
        <p className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-300">
          Invite link (email delivery arrives with production hardening):{" "}
          <code className="break-all text-indigo-300">{link}</code>
        </p>
      )}
    </form>
  );
}

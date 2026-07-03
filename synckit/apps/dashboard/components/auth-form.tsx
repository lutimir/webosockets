"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "./ui";

interface FieldSpec {
  name: string;
  label: string;
  type?: string;
}

/** Shared form shell for login / signup / invite-accept. */
export function AuthForm({
  title,
  fields,
  submitLabel,
  endpoint,
  redirectTo = "/",
  footer,
}: {
  title: string;
  fields: FieldSpec[];
  submitLabel: string;
  endpoint: string;
  redirectTo?: string;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    setError(body.error?.message ?? `request failed (${response.status})`);
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-5 text-xl font-semibold">{title}</h1>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          {fields.map((field) => (
            <Field key={field.name} label={field.label}>
              <Input name={field.name} type={field.type ?? "text"} required />
            </Field>
          ))}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : submitLabel}
          </Button>
        </form>
        {footer && <div className="mt-4 text-sm text-zinc-400">{footer}</div>}
      </Card>
    </main>
  );
}

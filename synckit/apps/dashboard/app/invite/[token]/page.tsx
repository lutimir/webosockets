import { AuthForm } from "@/components/auth-form";
import { internalJson } from "@/lib/internal";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { status, body } = await internalJson<{
    email: string;
    organizationName: string;
    role: string;
  }>(`/invites/${token}`, { session: null });

  if (status !== 200) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-400">This invite link is invalid or has expired.</p>
      </main>
    );
  }

  return (
    <AuthForm
      title={`Join ${body.organizationName} as ${body.role} (${body.email})`}
      endpoint={`/api/invites/${token}/accept`}
      submitLabel="Join organization"
      fields={[
        { name: "name", label: "Your name" },
        { name: "password", label: "Choose a password (min 8 chars)", type: "password" },
      ]}
    />
  );
}

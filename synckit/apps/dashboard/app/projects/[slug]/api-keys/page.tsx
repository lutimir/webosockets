import { CreateKeyButton, RevokeKeyButton } from "@/components/api-keys";
import { Card } from "@/components/ui";
import { internalJson } from "@/lib/internal";

interface KeyRow {
  id: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default async function ApiKeysPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { body } = await internalJson<{ keys: KeyRow[] }>(`/projects/${slug}/api-keys`);
  const keys = body.keys ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <CreateKeyButton slug={slug} />
      </div>
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-400">
            <tr>
              <th className="pb-3 font-medium">Key</th>
              <th className="pb-3 font-medium">Scopes</th>
              <th className="pb-3 font-medium">Last used</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {keys.map((key) => (
              <tr key={key.id}>
                <td className="py-3 font-mono">sk_…{key.prefix}</td>
                <td className="py-3">
                  {key.scopes.length > 0 ? key.scopes.join(", ") : "full access"}
                </td>
                <td className="py-3 text-zinc-400">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}
                </td>
                <td className="py-3">
                  {key.revokedAt ? (
                    <span className="text-red-400">revoked</span>
                  ) : (
                    <span className="text-emerald-400">active</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {!key.revokedAt && <RevokeKeyButton id={key.id} prefix={key.prefix} />}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-zinc-500">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

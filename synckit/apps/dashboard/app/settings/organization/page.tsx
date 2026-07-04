import Link from "next/link";
import { redirect } from "next/navigation";

import { InviteForm, RenameOrgForm } from "@/components/organization";
import { Card, CardTitle } from "@/components/ui";
import { getMe, internalJson } from "@/lib/internal";

interface Member {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export default async function OrganizationPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const { body } = await internalJson<{ members: Member[] }>("/organization/members");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <Link href="/" className="text-sm text-indigo-400 hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Organization</h1>
      <Card>
        <CardTitle>Settings</CardTitle>
        <RenameOrgForm current={me.organization.name} />
      </Card>
      <Card>
        <CardTitle>Members</CardTitle>
        <ul className="divide-y divide-zinc-800">
          {(body.members ?? []).map((member) => (
            <li key={member.userId} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p>{member.name}</p>
                <p className="text-zinc-500">{member.email}</p>
              </div>
              <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs">{member.role}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Invite a teammate</CardTitle>
        <InviteForm />
      </Card>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { type ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { getMe } from "@/lib/internal";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const me = await getMe();
  if (!me) redirect("/login");
  const { slug } = await params;

  const nav = [
    { href: `/projects/${slug}`, label: "Overview" },
    { href: `/projects/${slug}/api-keys`, label: "API Keys" },
    { href: `/projects/${slug}/rooms`, label: "Rooms" },
    { href: `/projects/${slug}/webhooks`, label: "Webhooks" },
    { href: "/settings/organization", label: "Organization" },
    { href: "/settings/billing", label: "Billing" },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-800 p-4">
        <Link href="/" className="mb-6 block text-lg font-bold">
          SyncKit
        </Link>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          <p className="truncate">{me.user.email}</p>
          <p className="truncate">{me.organization.name}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

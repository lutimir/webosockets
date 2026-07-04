import { redirect } from "next/navigation";

import { getMe, internalJson } from "@/lib/internal";

export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const { body } = await internalJson<{ projects: { slug: string }[] }>("/projects");
  const first = body.projects[0];
  redirect(first ? `/projects/${first.slug}` : "/onboarding");
}

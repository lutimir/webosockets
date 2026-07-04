import { notFound } from "next/navigation";

import { Overview, type Stats } from "@/components/overview";
import { internalJson } from "@/lib/internal";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { status, body } = await internalJson<Stats & { project: { name: string } }>(
    `/projects/${slug}/stats`,
  );
  if (status !== 200) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{body.project.name}</h1>
      <Overview slug={slug} initial={body} />
    </div>
  );
}

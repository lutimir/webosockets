import Link from "next/link";

import { Card } from "@/components/ui";
import { internalJson } from "@/lib/internal";

export default async function RoomsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { body } = await internalJson<{ rooms: { externalId: string; createdAt: string }[] }>(
    `/projects/${slug}/rooms`,
  );
  const rooms = body.rooms ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Rooms</h1>
      <Card>
        {rooms.length === 0 ? (
          <p className="py-4 text-center text-zinc-500">
            No rooms yet — they appear when clients join them.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {rooms.map((room) => (
              <li key={room.externalId}>
                <Link
                  href={`/projects/${slug}/rooms/${encodeURIComponent(room.externalId)}`}
                  className="flex items-center justify-between py-3 hover:text-indigo-400"
                >
                  <span className="font-mono text-sm">{room.externalId}</span>
                  <span className="text-xs text-zinc-500">
                    created {new Date(room.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

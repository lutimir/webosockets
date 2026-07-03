"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, Card, CardTitle } from "@/components/ui";

interface RoomDetail {
  room: { externalId: string; createdAt: string };
  presence: { endUserId: string; displayName: string | null }[];
  comments: {
    id: string;
    endUserId: string;
    body: string;
    threadId: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }[];
}

/** Live room view — presence and comments refresh every 5 s. */
export default function RoomDetailPage() {
  const params = useParams<{ slug: string; externalId: string }>();
  const [detail, setDetail] = useState<RoomDetail | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${params.slug}/rooms/${encodeURIComponent(params.externalId)}`,
    );
    if (response.ok) setDetail((await response.json()) as RoomDetail);
  }, [params.slug, params.externalId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!detail) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-2xl font-semibold">{detail.room.externalId}</h1>

      <Card>
        <CardTitle>Live presence ({detail.presence.length})</CardTitle>
        {detail.presence.length === 0 ? (
          <p className="text-sm text-zinc-500">Nobody is in this room right now.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="presence-list">
            {detail.presence.map((entry) => (
              <li
                key={entry.endUserId}
                className="rounded-full bg-emerald-950 px-3 py-1 text-sm text-emerald-300"
              >
                {entry.displayName ?? entry.endUserId}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Comments ({detail.comments.length})</CardTitle>
        {detail.comments.length === 0 ? (
          <p className="text-sm text-zinc-500">No comments in this room.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {detail.comments.map((comment) => (
              <li key={comment.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm">
                    <span className="font-semibold">{comment.endUserId}</span>{" "}
                    <span className="text-xs text-zinc-500">
                      {new Date(comment.createdAt).toLocaleString()}
                      {comment.threadId && " · reply"}
                      {comment.resolvedAt && " · resolved"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">{comment.body}</p>
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm("Delete this comment?")) return;
                    void fetch(`/api/comments/${comment.id}/delete`, { method: "POST" }).then(() =>
                      load(),
                    );
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardTitle } from "./ui";

export interface Stats {
  activeConnections: number;
  activeUsers30d: number;
  messages24h: number;
  messagesDaily: { day: string; total: number }[];
}

/** Overview stat tiles + 30-day chart; connections refresh every 5 s. */
export function Overview({ slug, initial }: { slug: string; initial: Stats }) {
  const [stats, setStats] = useState(initial);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetch(`/api/projects/${slug}/stats`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: Stats | null) => {
          if (body) setStats(body);
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [slug]);

  const tiles = [
    { label: "Active connections", value: stats.activeConnections, testId: "active-connections" },
    { label: "Active users (30d)", value: stats.activeUsers30d, testId: "active-users" },
    { label: "Messages (24h)", value: stats.messages24h, testId: "messages-24h" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-sm text-zinc-400">{tile.label}</p>
            <p className="mt-1 text-3xl font-semibold" data-testid={tile.testId}>
              {tile.value}
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>Messages per day (30d)</CardTitle>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.messagesDaily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                labelStyle={{ color: "#e4e4e7" }}
              />
              <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

import { Radio } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500">
          <Radio className="h-7 w-7 text-white" aria-hidden />
        </span>
        <h1 className="text-4xl font-bold tracking-tight">SyncKit</h1>
      </div>
      <p className="max-w-md text-center text-lg text-zinc-400">
        Real-time collaboration infrastructure — presence, comments and notifications for your app
        in hours, not months.
      </p>
    </main>
  );
}

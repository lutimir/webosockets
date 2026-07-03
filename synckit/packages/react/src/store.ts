/** Tiny external store compatible with useSyncExternalStore. */
export class ValueStore<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set = (next: T): void => {
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Leading + trailing throttle — presence updates coalesce to one per window. */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let lastCall = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: Args | undefined;

  return (...args: Args) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastCall);
    lastArgs = args;
    if (remaining <= 0) {
      lastCall = now;
      fn(...args);
      return;
    }
    if (!trailing) {
      trailing = setTimeout(() => {
        trailing = undefined;
        lastCall = Date.now();
        if (lastArgs) fn(...lastArgs);
      }, remaining);
    }
  };
}

/** Deterministic hue per user id — stable cursor/avatar colors. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 45%)`;
}

export function initialsOf(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback;
  const parts = source.split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

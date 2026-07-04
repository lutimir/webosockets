export interface BackoffOptions {
  minDelayMs: number;
  maxDelayMs: number;
}

/**
 * Exponential backoff with full jitter: delay grows min * 2^attempt capped at
 * max, then jittered into [delay/2, delay] so reconnect storms spread out.
 */
export function computeBackoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(options.maxDelayMs, options.minDelayMs * 2 ** attempt);
  return Math.floor(exponential / 2 + random() * (exponential / 2));
}

/**
 * A ceiling on coach requests.
 *
 * This is a runaway guard, not a quota. The app has exactly one user, so the
 * threat is not abuse but a loop — a retrying client, a stuck component, a
 * mistake in this codebase — quietly spending money against a real API key.
 *
 * State is per process, and serverless means several processes. A determined
 * caller could therefore exceed the limit by spreading requests across warm
 * instances. That is fine for what this is for: nothing here is a security
 * boundary, and the request is already behind the session gate. A hard quota
 * would need to live in Postgres, which is a worse trade for a single user than
 * catching the loop that would actually happen.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;

let timestamps: number[] = [];

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(now = Date.now()): RateLimitResult {
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = timestamps[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
    };
  }

  timestamps.push(now);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - timestamps.length };
}

/** Test seam. */
export function resetRateLimit(): void {
  timestamps = [];
}

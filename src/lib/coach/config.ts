/**
 * Coach configuration and availability.
 *
 * The key never leaves the server. Every path into the model goes through the
 * route handler, so nothing here may be imported from a client component.
 */

/**
 * Claude Opus 5.
 *
 * The coach's job is analysis — reading a stalled bench against a fatigue
 * pattern and a volume history and saying something true about it. That is not
 * a task to economise on, and the whole conversation is a handful of requests a
 * week. Swap to `claude-sonnet-5` here if that trade ever looks wrong.
 */
export const COACH_MODEL = "claude-opus-5";

/**
 * Effort, which controls how deeply the model reasons before answering.
 *
 * Left at `high` (the API default) deliberately. `low` and `medium` are strong
 * on this model and would cut latency, but the questions worth asking a coach
 * are the ones where an under-considered answer is worse than a slower one.
 */
export const COACH_EFFORT = "high" as const;

/**
 * Generous, because thinking tokens count against this ceiling too. A truncated
 * answer mid-sentence is a bad failure mode for a chat surface.
 */
export const COACH_MAX_TOKENS = 16_000;

/**
 * How many times the model may call tools before the turn is cut off.
 *
 * Eight is comfortably more than any real question needs — the usual shape is
 * two or three reads — and exists to bound a loop that has gone wrong rather
 * than to constrain normal use.
 */
export const MAX_TOOL_ITERATIONS = 8;

/** Longest question accepted, to bound a single request. */
export const MAX_MESSAGE_LENGTH = 4_000;

export type CoachAvailability =
  | { available: true }
  | { available: false; reason: "disabled" | "no_key" };

/**
 * Whether the coach can run at all.
 *
 * Two separate switches on purpose: a key can be present while the feature is
 * off (during setup), and the feature can be on before a key is added. Telling
 * the two apart is the difference between a useful setup screen and a shrug.
 */
export function coachAvailability(): CoachAvailability {
  if (!isEnabled(process.env.FEATURE_COACH)) return { available: false, reason: "disabled" };
  if (!process.env.ANTHROPIC_API_KEY) return { available: false, reason: "no_key" };
  return { available: true };
}

/**
 * Reads the flag leniently.
 *
 * A strict `=== "true"` is a trap for a value typed into a dashboard field:
 * `True` and `TRUE` are obviously intended to mean on, and reading them as off
 * produces a page insisting the feature is disabled while the variable plainly
 * says otherwise. Anything unrecognised is still off, so the default holds.
 */
function isEnabled(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function isCoachAvailable(): boolean {
  return coachAvailability().available;
}

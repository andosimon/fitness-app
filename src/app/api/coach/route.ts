import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { coachAvailability, MAX_MESSAGE_LENGTH } from "@/lib/coach/config";
import { checkRateLimit } from "@/lib/coach/rate-limit";
import { runCoachTurn, type CoachEvent } from "@/lib/coach/run";

/**
 * The coach endpoint.
 *
 * The API key lives here and nowhere else — no model call is ever made from the
 * browser, and nothing under `src/lib/coach` may be imported by a client
 * component.
 *
 * The response is newline-delimited JSON rather than SSE. The events are
 * consumed by one bespoke client that reads them in order and never reconnects,
 * so SSE's replay and event-type machinery would be ceremony; a stream of JSON
 * lines is three lines to parse and trivial to read in a terminal while
 * debugging.
 */

/**
 * A turn runs several model requests back to back, each of which may reason for
 * a while. The platform default of ten seconds would cut off almost every
 * question worth asking.
 */
export const maxDuration = 60;

const requestSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export async function POST(request: Request) {
  /*
   * The only authorisation check for the whole turn, and it has to be here.
   * Everything downstream runs while the response streams — after this function
   * has returned, outside the request scope, where `cookies()` no longer
   * resolves. That is why the coach reads through `unsafe_` queries: the check
   * happens once, at the last moment it still can.
   */
  await requireAuth();

  const availability = coachAvailability();
  if (!availability.available) {
    return Response.json(
      {
        error:
          availability.reason === "disabled"
            ? "The coach is switched off. Set FEATURE_COACH=true."
            : "No ANTHROPIC_API_KEY is configured.",
      },
      { status: 503 },
    );
  }

  const limit = checkRateLimit();
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many coach requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const turn = runCoachTurn({
    conversationId: parsed.data.conversationId ?? null,
    message: parsed.data.message,
  });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await turn.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(value satisfies CoachEvent)}\n`));
    },
    /*
     * Fired when the browser navigates away mid-answer. Returning the generator
     * runs its `finally`, which is what persists the partial turn — without
     * this, closing the tab would silently drop the exchange.
     */
    async cancel() {
      await turn.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Streaming through a proxy that buffers would defeat the whole point.
      "x-accel-buffering": "no",
    },
  });
}

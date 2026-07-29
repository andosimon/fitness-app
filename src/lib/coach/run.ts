import Anthropic from "@anthropic-ai/sdk";

import {
  titleFrom,
  unsafe_appendMessages,
  unsafe_ensureConversation,
  unsafe_getConversationMessages,
  type AppendableMessage,
} from "@/lib/db/queries/conversations";

import {
  COACH_EFFORT,
  COACH_MAX_TOKENS,
  COACH_MODEL,
  MAX_TOOL_ITERATIONS,
} from "./config";
import { unsafe_getLifterSnapshot } from "./context";
import { buildSystemPrompt } from "./prompt";
import { COACH_TOOLS, runTool } from "./tools";

/**
 * One turn of the coach.
 *
 * Written as an async generator so the route handler can pipe events straight
 * to the browser without knowing anything about the tool loop, and so the loop
 * itself stays readable top to bottom.
 *
 * **This body runs outside the request scope.** The runtime pumps the response
 * stream after the handler has returned, so `cookies()` is gone by the time the
 * first event is pulled and every guarded query would throw. Authorisation is
 * therefore established once in the route handler, and everything from here
 * down uses `unsafe_` reads. See the note at the top of `tools.ts`.
 *
 * The turn is persisted only once it completes. A tool loop abandoned halfway —
 * a dropped connection, a thrown handler — would otherwise leave an assistant
 * `tool_use` in history with no matching `tool_result`, and the API rejects
 * every later request in that conversation.
 */

export type CoachEvent =
  | { type: "conversation"; conversationId: string }
  /** Summarised reasoning, so a long tool loop is not a blank screen. */
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; label: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  | { type: "error"; message: string }
  | { type: "done" };

export type CoachTurnInput = {
  conversationId: string | null;
  message: string;
};

/** What each tool is doing, in the lifter's terms rather than the schema's. */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "get_recent_sessions":
      return "Reading recent sessions";
    case "get_exercise_history":
      return `Reading your ${String(input.exercise ?? "exercise")} history`;
    case "get_strength_estimates":
      return "Checking estimated maxima";
    case "get_volume_by_muscle":
      return "Checking weekly volume against the landmarks";
    case "get_training_cadence":
      return "Checking training consistency";
    case "get_program_schedule":
      return "Reading the programme";
    case "get_next_session":
      return "Reading your next session";
    case "search_exercises":
      return "Searching the exercise library";
    default:
      return `Running ${name}`;
  }
}

export async function* runCoachTurn(input: CoachTurnInput): AsyncGenerator<CoachEvent> {
  const client = new Anthropic();

  /*
   * The id is minted here and the row written later, so the browser can start
   * deep-linking immediately without a conversation existing for a turn that
   * never produced an answer.
   */
  const conversationId = input.conversationId ?? crypto.randomUUID();
  const isNewConversation = input.conversationId === null;
  yield { type: "conversation", conversationId };

  const [snapshot, history] = await Promise.all([
    unsafe_getLifterSnapshot(),
    input.conversationId ? unsafe_getConversationMessages(input.conversationId) : Promise.resolve([]),
  ]);

  const system = buildSystemPrompt(snapshot);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role,
      content: m.content as Anthropic.MessageParam["content"],
    })),
    { role: "user" as const, content: input.message },
  ];

  // Everything produced this turn, written in one go at the end.
  const turn: AppendableMessage[] = [{ role: "user", content: input.message }];

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const stream = client.messages.stream({
        model: COACH_MODEL,
        max_tokens: COACH_MAX_TOKENS,
        system,
        tools: COACH_TOOLS,
        messages,
        /*
         * Summarised rather than the default `omitted`. Without it the thinking
         * blocks arrive with empty text and a question that takes twenty
         * seconds to reason through looks like a hung request.
         */
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: COACH_EFFORT },
      });

      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        } else if (event.delta.type === "thinking_delta") {
          yield { type: "thinking", text: event.delta.thinking };
        }
      }

      const message = await stream.finalMessage();

      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
      cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

      // Content is echoed back verbatim, thinking blocks included: continuing a
      // conversation on the same model requires them unchanged.
      messages.push({ role: "assistant", content: message.content });
      turn.push({
        role: "assistant",
        content: message.content,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? null,
      });

      // Checked before reading content: a refused response can carry none.
      if (message.stop_reason === "refusal") {
        yield {
          type: "error",
          message: "The model declined to answer that. Try rephrasing the question.",
        };
        break;
      }

      if (message.stop_reason !== "tool_use") break;

      const toolUses = message.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      /*
       * Tools run concurrently and every result goes back in a single user
       * message. Splitting them across messages is accepted by the API but
       * trains the model out of asking for parallel calls, which is exactly the
       * behaviour worth keeping when a question needs three different reads.
       */
      const results = await Promise.all(
        toolUses.map(async (block) => {
          const label = describeToolCall(block.name, (block.input ?? {}) as Record<string, unknown>);
          const result = await runTool(block.name, block.input);
          return { block, label, result };
        }),
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const { block, label, result } of results) {
        yield { type: "tool", label };
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
      turn.push({ role: "user", content: toolResults });

      if (iteration === MAX_TOOL_ITERATIONS - 1) {
        yield {
          type: "error",
          message: "Stopped after too many lookups without an answer. Try a narrower question.",
        };
      }
    }

    yield { type: "usage", inputTokens, outputTokens, cacheReadTokens };
  } catch (error) {
    // Surfaced in-stream rather than thrown: the browser has already received
    // a 200 and part of an answer, so a rejected promise here would simply cut
    // the response off with no explanation.
    yield { type: "error", message: describeApiError(error) };
  } finally {
    /*
     * Persisted in `finally` so an interrupted turn still records what was
     * exchanged — but only when there is an answer and the history is
     * well-formed.
     */
    if (isWorthKeeping(turn)) {
      if (isNewConversation) {
        await unsafe_ensureConversation(conversationId, titleFrom(input.message));
      }
      await unsafe_appendMessages(conversationId, turn);
    }
  }

  yield { type: "done" };
}

/**
 * Turns an SDK failure into something worth reading.
 *
 * The typed error classes exist precisely so this does not become string
 * matching on messages, and the distinctions matter to whoever is looking at
 * the screen: a rate limit means wait, a bad key means go fix the environment,
 * an overload means try again.
 */
function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the API. Give it a minute.";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "The API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the API. Check your connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `The API returned ${error.status ?? "an error"}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Whether a turn should be stored.
 *
 * Two conditions, for different reasons. It must contain an assistant message,
 * because a question the API never answered is not a conversation — storing it
 * would litter the history with titled, empty threads every time the key was
 * wrong or the service was down.
 *
 * And it must not end on an assistant `tool_use`, because the API requires
 * every `tool_use` to have a matching `tool_result`. A turn cut short mid-loop
 * has none, and storing it would make every later message in that conversation
 * a 400. Rather than try to repair it, the exchange is dropped: losing one turn
 * is a smaller cost than a conversation that can never be continued.
 */
function isWorthKeeping(turn: AppendableMessage[]): boolean {
  if (!turn.some((message) => message.role === "assistant")) return false;

  const last = turn[turn.length - 1];
  if (last.role !== "assistant") return true;
  return !(
    Array.isArray(last.content) &&
    last.content.some((block) => (block as { type?: string })?.type === "tool_use")
  );
}

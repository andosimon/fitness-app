import { desc, eq } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";

/**
 * Storage for coach conversations.
 *
 * Content is persisted as the Anthropic content-block array, verbatim. That is
 * the whole reason `messages.content` is jsonb rather than text: a turn where
 * the coach called a tool is an assistant message containing a `tool_use` block
 * followed by a user message containing the matching `tool_result`, and the API
 * rejects a history where one appears without the other. Flattening either to a
 * string would make the conversation unreplayable.
 */

/** Anthropic content blocks. Deliberately loose — we store, we do not inspect. */
export type StoredContent = unknown;

export type StoredMessage = {
  role: "user" | "assistant";
  content: StoredContent;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listConversations(limit = 30): Promise<ConversationSummary[]> {
  await requireAuth();

  return getDb()
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

/**
 * Titles a conversation from its opening question.
 *
 * A first message is almost always the actual subject ("why has my bench
 * stalled?"), so asking the model for a title would spend a request restating
 * what the user already wrote.
 */
export function titleFrom(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  const cut = cleaned.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Creates the conversation row if it is not already there.
 *
 * Takes the id rather than generating one so the caller can hand it to the
 * browser the moment a turn starts, while the row itself is only written once
 * there is something worth saving. A misconfigured key would otherwise leave a
 * titled, empty conversation behind on every attempt.
 */
export async function ensureConversation(id: string, title: string): Promise<void> {
  await requireAuth();
  return unsafe_ensureConversation(id, title);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_ensureConversation(id: string, title: string): Promise<void> {
  await getDb().insert(conversations).values({ id, title }).onConflictDoNothing();
}

/** The full message history, oldest first, ready to send back to the API. */
export async function getConversationMessages(
  conversationId: string,
): Promise<StoredMessage[]> {
  await requireAuth();
  return unsafe_getConversationMessages(conversationId);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_getConversationMessages(
  conversationId: string,
): Promise<StoredMessage[]> {
  const rows = await getDb()
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

export type AppendableMessage = StoredMessage & {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
};

/**
 * Appends a turn's messages in one write.
 *
 * Written after the turn completes rather than incrementally: a tool loop
 * abandoned halfway through would otherwise leave a `tool_use` in history with
 * no result, poisoning every later request in that conversation.
 */
export async function appendMessages(
  conversationId: string,
  turn: AppendableMessage[],
): Promise<void> {
  await requireAuth();
  return unsafe_appendMessages(conversationId, turn);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_appendMessages(
  conversationId: string,
  turn: AppendableMessage[],
): Promise<void> {
  if (turn.length === 0) return;

  const db = getDb();

  /*
   * Timestamps are assigned here rather than by `defaultNow()`. Postgres gives
   * every row in a single statement the same transaction timestamp, and history
   * is ordered by `created_at` — without distinct values the ordering of a
   * tool_use and its tool_result within a turn would be arbitrary.
   */
  const base = Date.now();

  await db.insert(messages).values(
    turn.map((message, index) => ({
      conversationId,
      role: message.role,
      content: message.content,
      model: message.model ?? null,
      inputTokens: message.inputTokens ?? null,
      outputTokens: message.outputTokens ?? null,
      cacheReadTokens: message.cacheReadTokens ?? null,
      createdAt: new Date(base + index),
    })),
  );

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await requireAuth();
  // Messages cascade.
  await getDb().delete(conversations).where(eq(conversations.id, conversationId));
}

/** Token spend for a conversation, so cost is visible rather than a surprise. */
export async function getConversationUsage(conversationId: string) {
  await requireAuth();

  const rows = await getDb()
    .select({
      inputTokens: messages.inputTokens,
      outputTokens: messages.outputTokens,
      cacheReadTokens: messages.cacheReadTokens,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

  return rows.reduce<{ inputTokens: number; outputTokens: number; cacheReadTokens: number }>(
    (total, row) => ({
      inputTokens: total.inputTokens + (row.inputTokens ?? 0),
      outputTokens: total.outputTokens + (row.outputTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (row.cacheReadTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  );
}

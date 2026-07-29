import type { StoredMessage } from "@/lib/db/queries/conversations";

/**
 * Turning stored content blocks back into something readable.
 *
 * History is stored as the API's content blocks so it can be replayed, which
 * means a saved conversation contains thinking, tool calls and tool results
 * alongside the actual words. Reloading a conversation should show what was
 * said, not the machinery — the tool calls were narrated live and there is no
 * value in a transcript of "get_volume_by_muscle" three days later.
 */

export type TranscriptEntry = { role: "user" | "assistant"; text: string };

type Block = { type?: string; text?: string };

export function toTranscript(messages: StoredMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const message of messages) {
    const text = extractText(message.content);
    if (text.trim() === "") continue;
    entries.push({ role: message.role, text });
  }

  return entries;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return (content as Block[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

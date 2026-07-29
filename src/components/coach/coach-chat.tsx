"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The coach conversation.
 *
 * Reads the newline-delimited event stream from `/api/coach` and paints it as
 * it arrives. Nothing here talks to the model — the key stays on the server and
 * this component only ever sees text.
 */

type Message = {
  role: "user" | "assistant";
  text: string;
  /** Summarised reasoning, collapsed once an answer starts arriving. */
  thinking: string;
  /** What was looked up, in order, narrated while the turn runs. */
  tools: string[];
  error: string | null;
};

type CoachEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; label: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  | { type: "error"; message: string }
  | { type: "done" };

const SUGGESTIONS = [
  "Why has my bench stalled?",
  "Is my weekly volume where it should be?",
  "Review the last four weeks",
  "What should I do in today's session?",
];

export function CoachChat({
  conversationId: initialConversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: { role: "user" | "assistant"; text: string }[];
}) {
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages.map((m) => ({ ...m, thinking: "", tools: [], error: null })),
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  /*
   * The conversation id is held in a ref, not state. It is set once mid-request
   * and read by the next request; putting it in state would re-render the whole
   * transcript at the exact moment the first token arrives, for no visible
   * change.
   */
  const conversationId = useRef(initialConversationId);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /** Applies an update to the in-flight assistant message. */
  const updateLast = useCallback((change: (message: Message) => Message) => {
    setMessages((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      next[next.length - 1] = change(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (trimmed === "" || streaming) return;

      setInput("");
      setStreaming(true);
      setMessages((current) => [
        ...current,
        { role: "user", text: trimmed, thinking: "", tools: [], error: null },
        { role: "assistant", text: "", thinking: "", tools: [], error: null },
      ]);

      try {
        const response = await fetch("/api/coach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: conversationId.current, message: trimmed }),
        });

        if (!response.ok || !response.body) {
          const detail = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => null);
          updateLast((m) => ({ ...m, error: detail ?? `Request failed (${response.status}).` }));
          return;
        }

        for await (const event of readEvents(response.body)) {
          switch (event.type) {
            case "conversation":
              conversationId.current = event.conversationId;
              // Deep-linkable without a navigation, which would remount this
              // component and discard the answer currently streaming into it.
              window.history.replaceState(null, "", `/coach?c=${event.conversationId}`);
              break;
            case "thinking":
              updateLast((m) => ({ ...m, thinking: m.thinking + event.text }));
              break;
            case "text":
              updateLast((m) => ({ ...m, text: m.text + event.text }));
              break;
            case "tool":
              updateLast((m) => ({ ...m, tools: [...m.tools, event.label] }));
              break;
            case "error":
              updateLast((m) => ({ ...m, error: event.message }));
              break;
            default:
              break;
          }
        }
      } catch {
        updateLast((m) => ({ ...m, error: "Lost the connection before the answer finished." }));
      } finally {
        setStreaming(false);
      }
    },
    [streaming, updateLast],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted">
              Ask about anything you have logged. The coach reads your actual sessions, volume
              and estimated maxima before answering — it will tell you when the data is too
              thin rather than guess.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((message, index) => (
              <li key={index}>
                <Bubble
                  message={message}
                  streaming={streaming && index === messages.length - 1}
                />
              </li>
            ))}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-0 mt-4 flex items-end gap-2 border-t border-border bg-bg/90 py-3 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. This is a chat box, and
            // most questions are one line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Ask the coach…"
          aria-label="Message"
          className="max-h-40 min-h-11 flex-1 resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={streaming || input.trim() === ""}
          className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function Bubble({ message, streaming }: { message: Message; streaming: boolean }) {
  if (message.role === "user") {
    return (
      <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-surface-2 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
        {message.text}
      </p>
    );
  }

  const waiting = streaming && message.text === "";

  return (
    <div className="max-w-[95%]">
      {message.tools.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {message.tools.map((tool, index) => (
            <li key={index} className="flex items-center gap-2 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
              {tool}
            </li>
          ))}
        </ul>
      ) : null}

      {message.thinking.trim() !== "" ? (
        <details className="mb-2 text-xs text-muted" open={waiting}>
          <summary className="cursor-pointer select-none">
            {waiting ? "Thinking…" : "Reasoning"}
          </summary>
          <p className="mt-1.5 border-l border-border pl-3 whitespace-pre-wrap">
            {message.thinking}
          </p>
        </details>
      ) : null}

      {message.text !== "" ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
      ) : null}

      {waiting && message.thinking.trim() === "" && message.tools.length === 0 ? (
        <p className="text-sm text-muted">Reading your training…</p>
      ) : null}

      {message.error ? (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {message.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Parses the newline-delimited event stream.
 *
 * Chunk boundaries fall wherever the network puts them, so a line can arrive in
 * pieces; the tail is carried forward until its newline shows up.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CoachEvent> {
  const reader = body.getReader();
  // Decoding by hand rather than piping through TextDecoderStream: `stream: true`
  // is what makes a multi-byte character split across chunks survive.
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== "") yield JSON.parse(line) as CoachEvent;
        newline = buffer.indexOf("\n");
      }
    }

    const rest = buffer.trim();
    if (rest !== "") yield JSON.parse(rest) as CoachEvent;
  } finally {
    reader.releaseLock();
  }
}

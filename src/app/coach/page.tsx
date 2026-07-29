import Link from "next/link";
import { connection } from "next/server";

import { AppNav } from "@/components/app-nav";
import { CoachChat } from "@/components/coach/coach-chat";
import { COACH_MODEL, coachAvailability } from "@/lib/coach/config";
import { toTranscript } from "@/lib/coach/transcript";
import {
  getConversationMessages,
  listConversations,
} from "@/lib/db/queries/conversations";

export const metadata = {
  title: "Coach · Fitness Tracker",
};

/**
 * The coach.
 *
 * `connection()` forces this to render per request so the feature flag and key
 * are read from the environment at runtime. Without it Next would be free to
 * inline whatever was set at build time, and the page would insist the coach
 * was off long after the key was added in Vercel.
 */
export default async function CoachPage(props: {
  searchParams: Promise<{ c?: string }>;
}) {
  await connection();

  const availability = coachAvailability();
  if (!availability.available) {
    return (
      <>
        <AppNav />
        <main className="mx-auto w-full max-w-2xl flex-1 p-4">
          <h1 className="text-xl font-semibold tracking-tight">Coach</h1>
          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm">
              {availability.reason === "disabled"
                ? "The coach is switched off."
                : "The coach has no API key."}
            </p>
            <p className="mt-2 text-sm text-muted">
              {availability.reason === "disabled"
                ? "Set FEATURE_COACH to \"true\" in the environment to turn it on."
                : "Add ANTHROPIC_API_KEY to the environment. It is billed separately from a Claude.ai subscription."}
            </p>
            <p className="mt-3 text-sm text-muted">
              Everything else in the app works without it.
            </p>
          </div>
        </main>
      </>
    );
  }

  const { c: conversationId } = await props.searchParams;

  const [conversations, stored] = await Promise.all([
    listConversations(),
    conversationId ? getConversationMessages(conversationId) : Promise.resolve([]),
  ]);

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Coach</h1>
          {conversationId ? (
            <Link href="/coach" className="text-sm text-muted hover:text-text">
              New conversation
            </Link>
          ) : null}
        </div>

        {conversations.length > 0 ? (
          <details className="mt-3 rounded-xl border border-border bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted select-none">
              Past conversations ({conversations.length})
            </summary>
            <ul className="border-t border-border">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/coach?c=${conversation.id}`}
                    className={`flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2 ${
                      conversation.id === conversationId ? "text-accent" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate">{conversation.title ?? "Untitled"}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {conversation.updatedAt.toISOString().slice(0, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <CoachChat
            key={conversationId ?? "new"}
            conversationId={conversationId ?? null}
            initialMessages={toTranscript(stored)}
          />
        </div>

        <p className="mt-2 pb-2 text-xs text-muted">
          {COACH_MODEL}, reading your logged training. Not medical advice — see a clinician
          about pain or injury.
        </p>
      </main>
    </>
  );
}

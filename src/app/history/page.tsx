import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { listCompletedSessions } from "@/lib/db/queries/sessions";

export const metadata = {
  title: "History · Fitness Tracker",
};

/**
 * Session duration, or null when it plainly wasn't measured.
 *
 * A session entered after the fact spans only the time spent typing, so a
 * 21-set workout can report four minutes. Reporting that as duration is worse
 * than reporting nothing, so anything under about forty seconds per set is
 * treated as backfilled.
 */
function formatDuration(
  startedAt: Date,
  completedAt: Date | null,
  setCount: number,
): string | null {
  if (!completedAt) return null;
  const seconds = (completedAt.getTime() - startedAt.getTime()) / 1000;
  if (setCount > 0 && seconds / setCount < 40) return null;

  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function HistoryPage() {
  const sessions = await listCompletedSessions();

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          {sessions.length > 0 ? (
            <p className="text-sm text-muted">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>

        {sessions.length === 0 ? (
          <p className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            No finished sessions yet. Sessions appear here once you tap{" "}
            <span className="text-text">Finish session</span> on Today.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {sessions.map((s) => {
              const duration = formatDuration(s.startedAt, s.completedAt, s.setCount);
              return (
                <li key={s.id}>
                  <Link
                    href={`/history/${s.id}`}
                    className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="font-medium">{s.name}</h2>
                      <time
                        dateTime={s.startedAt.toISOString()}
                        className="shrink-0 text-xs text-muted"
                      >
                        {s.startedAt.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </time>
                    </div>

                    <p className="mt-1 font-mono text-xs text-muted">
                      {s.setCount} set{s.setCount === 1 ? "" : "s"}
                      {s.volumeKg > 0
                        ? ` · ${Math.round(s.volumeKg).toLocaleString()} kg volume`
                        : ""}
                      {duration ? ` · ${duration}` : ""}
                    </p>

                    {s.exerciseNames.length > 0 ? (
                      <p className="mt-1.5 text-sm text-muted">
                        {s.exerciseNames.slice(0, 4).join(" · ")}
                        {s.exerciseNames.length > 4
                          ? ` +${s.exerciseNames.length - 4} more`
                          : ""}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

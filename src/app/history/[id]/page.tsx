import Link from "next/link";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { getSessionDetail, type LoggedSet } from "@/lib/db/queries/sessions";

/** Renders a set the way it was performed, per the exercise's load type. */
function describeSet(set: LoggedSet): string {
  const parts: string[] = [];
  if (set.weightKg != null) parts.push(`${set.weightKg} kg`);
  if (set.reps != null) parts.push(`${parts.length ? "× " : ""}${set.reps}`);
  if (set.timeSeconds != null) parts.push(`${set.timeSeconds}s`);
  let text = parts.join(" ") || "—";
  if (set.rir != null) text += `  @ RIR ${set.rir}`;
  else if (set.rpe != null) text += `  @ RPE ${set.rpe}`;
  return text;
}

export default async function SessionDetailPage(props: {
  // `params` is a Promise as of Next.js 16.
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const session = await getSessionDetail(id);

  if (!session) notFound();

  const workingSets = session.blocks.flatMap((b) => b.sets.filter((s) => !s.isWarmup));
  const volume = workingSets.reduce(
    (sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0),
    0,
  );

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Link href="/history" className="text-sm text-muted transition-colors hover:text-text">
          ← History
        </Link>

        <header className="mt-3">
          <h1 className="text-xl font-semibold tracking-tight">{session.name}</h1>
          <p className="mt-1 font-mono text-xs text-muted">
            {session.startedAt.toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
            {` · ${workingSets.length} working set${workingSets.length === 1 ? "" : "s"}`}
            {volume > 0 ? ` · ${Math.round(volume).toLocaleString()} kg volume` : ""}
            {session.perceivedEffort != null ? ` · session RPE ${session.perceivedEffort}` : ""}
          </p>
        </header>

        {session.notes ? (
          <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm">
            {session.notes}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          {session.blocks.map((block) => (
            <section
              key={block.exerciseId}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <h2 className="font-medium">{block.exerciseName}</h2>
              <ol className="mt-2 flex flex-col gap-1">
                {block.sets.map((set, i) => (
                  <li
                    key={set.id}
                    className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm"
                  >
                    <span className="w-5 shrink-0 text-muted">{i + 1}</span>
                    <span className="flex-1">{describeSet(set)}</span>
                    {set.isWarmup ? (
                      <span className="shrink-0 text-xs text-muted">warm-up</span>
                    ) : null}
                    {set.isAmrap ? (
                      <span className="shrink-0 text-xs text-accent">AMRAP</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        {session.blocks.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No sets were logged in this session.</p>
        ) : null}
      </main>
    </>
  );
}

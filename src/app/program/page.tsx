import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { getActiveProgram } from "@/lib/db/queries/programs";

import { archiveProgramAction } from "./actions";

export const metadata = { title: "Programme · Fitness Tracker" };

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

export default async function ProgramPage() {
  const program = await getActiveProgram();

  if (!program) {
    return (
      <>
        <AppNav />
        <main className="mx-auto w-full max-w-2xl flex-1 p-4">
          <h1 className="text-xl font-semibold tracking-tight">Programme</h1>
          <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            No active programme. Generate one and it will drive what appears on Today.
          </p>
          <Link
            href="/program/new"
            className="mt-4 block rounded-xl bg-accent px-4 py-3.5 text-center text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Create a programme
          </Link>
        </main>
      </>
    );
  }

  const byWeek = new Map<number, typeof program.sessions>();
  for (const s of program.sessions) {
    byWeek.set(s.weekNumber, [...(byWeek.get(s.weekNumber) ?? []), s]);
  }
  const done = program.sessions.filter((s) => s.completed).length;

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{program.name}</h1>
            <p className="mt-1 font-mono text-xs text-muted">
              {humanise(program.splitType)} · {program.daysPerWeek} days ·{" "}
              {program.minutesPerSession} min · {program.totalWeeks} weeks
            </p>
          </div>
          <p className="shrink-0 text-sm text-muted">
            {done}/{program.sessions.length} done
          </p>
        </div>

        {program.notes ? (
          <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            {program.notes}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-4">
          {[...byWeek.entries()].map(([week, weekSessions]) => (
            <section key={week}>
              <h2 className="text-sm font-medium text-muted">
                Week {week}
                {week === program.totalWeeks ? " · deload" : ""}
              </h2>
              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {weekSessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        s.completed ? "bg-success" : "bg-border"
                      }`}
                      aria-hidden
                    />
                    <span className={`text-sm ${s.completed ? "text-muted line-through" : ""}`}>
                      {s.name}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <form action={archiveProgramAction} className="mt-8 border-t border-border pt-4">
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-danger"
          >
            Archive and start a new programme
          </button>
        </form>
      </main>
    </>
  );
}

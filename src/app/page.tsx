import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { logout } from "@/app/login/actions";
import { getDb, isDatabaseConfigured } from "@/lib/db";

type DbStatus =
  | { state: "not_configured" }
  | { state: "connected" }
  | { state: "error"; message: string };

/**
 * Proves the deploy is genuinely wired end-to-end rather than merely rendering.
 * `connection()` forces per-request execution so `process.env` is read at
 * runtime instead of being inlined at build time.
 */
async function checkDatabase(): Promise<DbStatus> {
  await connection();

  if (!isDatabaseConfigured()) return { state: "not_configured" };

  try {
    await getDb().execute(sql`select 1`);
    return { state: "connected" };
  } catch (error) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  const dot = ok === null ? "bg-warning" : ok ? "bg-success" : "bg-danger";
  return (
    <div className="flex items-start gap-3 py-3.5">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-sm break-words text-muted">{detail}</p>
      </div>
    </div>
  );
}

const ROADMAP = [
  { phase: "Phase 1", label: "Exercise library and offline set logging" },
  { phase: "Phase 2", label: "Workout generation engine" },
  { phase: "Phase 3", label: "Progression, autoregulation and travel mode" },
  { phase: "Phase 4", label: "Claude coach" },
  { phase: "Phase 5", label: "Cardio and conditioning" },
];

export default async function HomePage() {
  const db = await checkDatabase();
  const coachEnabled = process.env.FEATURE_COACH === "true";
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fitness Tracker</h1>
          <p className="mt-1 text-sm text-muted">Setup status</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8 divide-y divide-border rounded-2xl border border-border bg-surface px-5 py-1">
        <StatusRow label="Application" ok detail="Next.js 16 running, session gate active." />

        <StatusRow
          label="Database"
          ok={db.state === "connected" ? true : db.state === "not_configured" ? null : false}
          detail={
            db.state === "connected"
              ? "Connected to Neon."
              : db.state === "not_configured"
                ? "DATABASE_URL not set. Create a Neon database and add the connection string."
                : `Connection failed: ${db.message}`
          }
        />

        <StatusRow
          label="Claude coach"
          ok={coachEnabled && hasApiKey ? true : null}
          detail={
            coachEnabled && hasApiKey
              ? "Enabled."
              : hasApiKey
                ? "API key present but FEATURE_COACH is not set to 'true'."
                : "Waiting on ANTHROPIC_API_KEY. Everything else works without it."
          }
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Roadmap</h2>
        <ol className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {ROADMAP.map((item) => (
            <li key={item.phase} className="flex items-baseline gap-3 px-5 py-3.5">
              <span className="w-16 shrink-0 font-mono text-xs text-accent">{item.phase}</span>
              <span className="text-sm">{item.label}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { logout } from "@/app/login/actions";
import { AppNav } from "@/components/app-nav";
import { getDb, resolveConnection } from "@/lib/db";

const EXPECTED_DATABASE = "fitness";

type DbStatus =
  | { state: "not_configured" }
  | { state: "connected"; database: string; exercises: number; source: string }
  | { state: "error"; message: string; source: string };

/**
 * Proves the deploy is genuinely wired end-to-end rather than merely rendering.
 *
 * Checks which database it reached and counts a real table, rather than running
 * `select 1`. That distinction matters: `select 1` succeeds against *any*
 * database, so it would report a healthy connection while pointing somewhere the
 * schema does not exist. Naming the database and proving the tables are present
 * is what actually tells you the deployment is correct.
 *
 * `connection()` forces per-request execution so `process.env` is read at runtime
 * instead of being inlined at build time.
 */
async function checkDatabase(): Promise<DbStatus> {
  await connection();

  const conn = resolveConnection();
  if (!conn) return { state: "not_configured" };

  try {
    const result = await getDb().execute<{ db: string; n: number }>(
      sql`select current_database() as db, (select count(*)::int from exercises) as n`,
    );
    const meta = result.rows[0];
    return {
      state: "connected",
      database: String(meta.db),
      exercises: Number(meta.n),
      source: conn.source,
    };
  } catch (error) {
    return { state: "error", message: describeDbError(error), source: conn.source };
  }
}

/**
 * Drizzle wraps driver errors in a generic "Failed query" message that omits the
 * actual reason, so the underlying Postgres error is unwrapped from `cause`.
 * Without this, a missing table reads as an unexplained failure rather than
 * "relation does not exist" — which is the one thing worth knowing.
 */
function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return error.message;
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

export const metadata = {
  title: "Setup · Fitness Tracker",
};

export default async function SetupPage() {
  const db = await checkDatabase();
  const coachEnabled = process.env.FEATURE_COACH === "true";
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Setup</h1>
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
          ok={
            db.state === "not_configured"
              ? null
              : db.state === "connected" && db.database === EXPECTED_DATABASE
          }
          detail={
            db.state === "connected"
              ? db.database === EXPECTED_DATABASE
                ? `Connected to "${db.database}" via ${db.source}. ${db.exercises} exercises loaded.`
                : `Connected to "${db.database}", but expected "${EXPECTED_DATABASE}". ` +
                  `Point ${db.source} at the ${EXPECTED_DATABASE} database.`
              : db.state === "not_configured"
                ? "No connection string. Set FITNESS_DATABASE_URL or DATABASE_URL."
                : `Query failed via ${db.source}: ${db.message}`
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
    </>
  );
}

import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exercises, sessions, setLogs } from "@/lib/db/schema";
import type { MuscleGroup } from "@/lib/domain/types";

/**
 * Reads that answer analytical questions rather than drive a screen.
 *
 * These exist for the coach: "how much chest work am I actually doing?" and
 * "what has my bench done over the last two months?" are questions the app's
 * pages never ask, because a page shows a session and these look across many.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Volume by muscle
// ---------------------------------------------------------------------------

export type MuscleWeek = {
  /** ISO date of the Monday that week started. */
  week: string;
  muscle: MuscleGroup;
  /** Credited sets: primary at 1, secondary at 0.5. */
  sets: number;
  /** Sets where this muscle was the primary target. */
  directSets: number;
};

/**
 * Weekly working sets per muscle.
 *
 * Secondary involvement counts at half, matching `credit()` in the selection
 * engine exactly. That symmetry is the point: if the planner thinks it
 * prescribed 14 sets of chest and this read said 20, every conversation about
 * whether volume is on target would be built on two different meanings of the
 * word "set".
 */
export async function getWeeklyVolumeByMuscle(weeks = 8): Promise<MuscleWeek[]> {
  await requireAuth();
  return unsafe_getWeeklyVolumeByMuscle(weeks);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_getWeeklyVolumeByMuscle(weeks = 8): Promise<MuscleWeek[]> {
  const since = new Date(Date.now() - weeks * 7 * DAY_MS);

  const result = await getDb().execute(sql`
    with working as (
      select s.started_at, e.primary_muscles, e.secondary_muscles
      from ${setLogs} sl
      join ${sessions} s on s.id = sl.session_id
      join ${exercises} e on e.id = sl.exercise_id
      where sl.is_warmup = false and s.started_at >= ${since.toISOString()}
    ),
    credited as (
      select started_at, m as muscle, 1.0::real as weight
      from working, unnest(primary_muscles) m
      union all
      select started_at, m as muscle, 0.5::real as weight
      from working, unnest(secondary_muscles) m
    )
    select
      to_char(date_trunc('week', started_at), 'YYYY-MM-DD') as week,
      muscle,
      sum(weight)::real as sets,
      sum(case when weight = 1 then 1 else 0 end)::int as direct_sets
    from credited
    group by 1, 2
    order by 1 desc, 3 desc
  `);

  // `db.execute` returns a NeonHttpQueryResult, not an array.
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    week: String(row.week),
    muscle: row.muscle as MuscleGroup,
    sets: Math.round(Number(row.sets) * 10) / 10,
    directSets: Number(row.direct_sets),
  }));
}

// ---------------------------------------------------------------------------
// History for one exercise
// ---------------------------------------------------------------------------

export type ExerciseSetRecord = {
  performedAt: Date;
  sessionName: string;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  isAmrap: boolean;
};

export type ExerciseHistory = {
  exerciseId: string;
  exerciseName: string;
  slug: string;
  loadType: string;
  sets: ExerciseSetRecord[];
};

/**
 * Every working set logged for one exercise, most recent first.
 *
 * Matched by free text because the coach is answering a question phrased in
 * human terms — "my bench", "RDLs" — and the alias column exists precisely so
 * those resolve. Returns the single best match rather than a list: answering a
 * question about the wrong lift is worse than admitting the name was ambiguous.
 */
export async function findExerciseHistory(
  query: string,
  limit = 60,
): Promise<ExerciseHistory | null> {
  await requireAuth();
  return unsafe_findExerciseHistory(query, limit);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_findExerciseHistory(
  query: string,
  limit = 60,
): Promise<ExerciseHistory | null> {
  const exact = query.trim();
  const term = `%${exact}%`;
  const db = getDb();

  /*
   * Ranking, in the order that matters for the question being asked.
   *
   * An exact name wins outright. Otherwise **history wins over alphabetical
   * order**, which is the fix for a genuinely bad failure: "squat" matched
   * thirty exercises, and picking the alphabetically first returned "Assisted
   * Pistol Squat" — never performed — for someone with months of back squats
   * logged. Someone asking about "my squat" means the one they actually do.
   *
   * The expression is ordered by directly rather than by output alias: Drizzle
   * does not alias a computed select column, so `order by rank` referenced a
   * column that did not exist and the query failed outright.
   */
  const hasHistory = sql`exists (
    select 1 from ${setLogs} sl
    where sl.exercise_id = ${exercises.id} and sl.is_warmup = false
  )`;

  const rank = sql`case
    when lower(${exercises.name}) = lower(${exact}) then 0
    when lower(${exercises.slug}) = lower(${exact}) then 1
    when ${hasHistory} and ${exercises.name} ilike ${term} then 2
    when ${hasHistory} then 3
    when ${exercises.name} ilike ${term} then 4
    else 5
  end`;

  const [match] = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      slug: exercises.slug,
      loadType: exercises.loadType,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.isActive, true),
        or(
          sql`${exercises.name} ilike ${term}`,
          sql`${exercises.slug} ilike ${term}`,
          sql`exists (select 1 from unnest(${exercises.aliases}) a where a ilike ${term})`,
        ),
      ),
    )
    .orderBy(rank, exercises.name)
    .limit(1);

  if (!match) return null;

  const rows = await db
    .select({
      performedAt: setLogs.completedAt,
      sessionName: sessions.name,
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      isAmrap: setLogs.isAmrap,
    })
    .from(setLogs)
    .innerJoin(sessions, eq(sessions.id, setLogs.sessionId))
    .where(and(eq(setLogs.exerciseId, match.id), eq(setLogs.isWarmup, false)))
    .orderBy(desc(setLogs.completedAt))
    .limit(limit);

  return {
    exerciseId: match.id,
    exerciseName: match.name,
    slug: match.slug,
    loadType: match.loadType,
    sets: rows,
  };
}

// ---------------------------------------------------------------------------
// Training frequency
// ---------------------------------------------------------------------------

export type TrainingCadence = {
  sessionsLogged: number;
  /** The window that was asked about. */
  windowDays: number;
  /** Days from the first session in that window to now — the span with data. */
  daysObserved: number;
  /** Sessions per week across the observed span, not across the whole window. */
  sessionsPerWeek: number;
  /** Days since the last logged session, or null when nothing is logged. */
  daysSinceLast: number | null;
  longestGapDays: number;
  note: string;
};

/**
 * How consistently training actually happened.
 *
 * Adherence is usually the answer when someone asks why progress stalled, and
 * it is the one thing a programme cannot infer about itself.
 *
 * Frequency is reported over the span that actually has data rather than the
 * whole window, matching how weekly volume is averaged. Dividing four sessions
 * in the last five days by an eight-week window reports 0.5 sessions a week —
 * a number that would have the coach diagnosing an absence that is really just
 * a short history. The trailing gap is what catches genuine drop-off, and
 * `daysSinceLast` reports it directly.
 */
export async function getTrainingCadence(days = 56): Promise<TrainingCadence> {
  await requireAuth();
  return unsafe_getTrainingCadence(days);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_getTrainingCadence(days = 56): Promise<TrainingCadence> {
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

  const rows = await getDb()
    .select({ startedAt: sessions.startedAt })
    .from(sessions)
    .where(gte(sessions.startedAt, since))
    .orderBy(desc(sessions.startedAt));

  if (rows.length === 0) {
    return {
      sessionsLogged: 0,
      windowDays: days,
      daysObserved: 0,
      sessionsPerWeek: 0,
      daysSinceLast: null,
      longestGapDays: days,
      note: `Nothing logged in the last ${days} days.`,
    };
  }

  const times = rows.map((r) => r.startedAt.getTime());
  const oldest = times[times.length - 1];
  const daysObserved = Math.max(1, Math.round((now - oldest) / DAY_MS));

  // The trailing gap counts: an eight-week history that stops three weeks ago
  // has a three-week gap, and that is the most important number here.
  let longestGap = (now - times[0]) / DAY_MS;
  for (let i = 0; i < times.length - 1; i += 1) {
    longestGap = Math.max(longestGap, (times[i] - times[i + 1]) / DAY_MS);
  }

  return {
    sessionsLogged: rows.length,
    windowDays: days,
    daysObserved,
    sessionsPerWeek: Math.round((rows.length / (daysObserved / 7)) * 10) / 10,
    daysSinceLast: Math.floor((now - times[0]) / DAY_MS),
    longestGapDays: Math.round(longestGap),
    note:
      daysObserved < 21
        ? `Only ${daysObserved} days of history — too short to read a trend from.`
        : `Frequency is measured over the ${daysObserved} days with logged sessions, not the full ${days}-day window.`,
  };
}

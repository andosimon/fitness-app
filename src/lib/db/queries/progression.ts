import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exerciseMaxes, exercises, sessions, setLogs } from "@/lib/db/schema";
import {
  bestEstimateFrom,
  incrementForLoadType,
  readFatigue,
  suggestLoad,
  type FatigueReading,
  type LoadSuggestion,
  type LoggedSet,
} from "@/lib/engine/progression";

/**
 * Reads logged history and turns it into load suggestions.
 *
 * The arithmetic lives in the engine; this module only supplies it with data
 * and stores what it computes.
 */

/** How far back to look when reading fatigue. */
const FATIGUE_WINDOW_DAYS = 10;

type PlannedForSuggestion = {
  plannedExerciseId: string;
  exerciseId: string;
  loadType: string;
  repMin: number | null;
  repMax: number | null;
  targetRir: number | null;
  targetRpe: number | null;
  targetPercent1rm: number | null;
};

/**
 * History from a related lift, used when the planned exercise itself has none.
 *
 * A programme prescribing paused bench press to someone who has only logged
 * ordinary bench press would otherwise offer nothing at all — which is the
 * common case whenever the engine rotates a variant. Deliberately no conversion
 * factor is applied: the relationship between a lift and its variants differs
 * per person, and inventing a percentage would be false precision. The related
 * load is offered as a reference point, clearly attributed, for the lifter to
 * adjust from.
 */
type RelatedReference = { exerciseName: string; weightKg: number; reps: number };

export type ExerciseSuggestion = LoadSuggestion & {
  plannedExerciseId: string;
  exerciseId: string;
  /** Estimated max, when history supports one. */
  estimatedOneRepMax: number | null;
};

/**
 * Suggests a load for each exercise in a planned session.
 *
 * All history is fetched in two queries rather than per exercise: a session has
 * a dozen exercises and this runs on page load, so a query per exercise would
 * be a dozen round trips to a database in another region.
 */
export async function suggestLoadsForSession(
  planned: PlannedForSuggestion[],
): Promise<ExerciseSuggestion[]> {
  await requireAuth();
  return unsafe_suggestLoadsForSession(planned);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_suggestLoadsForSession(
  planned: PlannedForSuggestion[],
): Promise<ExerciseSuggestion[]> {
  if (planned.length === 0) return [];

  const db = getDb();
  const exerciseIds = [...new Set(planned.map((p) => p.exerciseId))];

  // The substitution groups of the planned exercises, so history from a related
  // variant can stand in when the exact lift has never been logged.
  const groups = await db
    .select({ id: exercises.id, substitutionGroup: exercises.substitutionGroup })
    .from(exercises)
    .where(inArray(exercises.id, exerciseIds));
  const groupOf = new Map(groups.map((g) => [g.id, g.substitutionGroup]));
  const wantedGroups = [
    ...new Set(groups.map((g) => g.substitutionGroup).filter((g): g is string => g !== null)),
  ];

  const rows = await db
    .select({
      exerciseId: setLogs.exerciseId,
      exerciseName: exercises.name,
      substitutionGroup: exercises.substitutionGroup,
      sessionId: setLogs.sessionId,
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      completedAt: setLogs.completedAt,
      isWarmup: setLogs.isWarmup,
      startedAt: sessions.startedAt,
    })
    .from(setLogs)
    .innerJoin(sessions, eq(sessions.id, setLogs.sessionId))
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(
      wantedGroups.length > 0
        ? or(
            inArray(setLogs.exerciseId, exerciseIds),
            inArray(exercises.substitutionGroup, wantedGroups),
          )
        : inArray(setLogs.exerciseId, exerciseIds),
    )
    .orderBy(desc(sessions.startedAt), desc(setLogs.completedAt));

  const byExercise = new Map<string, typeof rows>();
  const byGroup = new Map<string, typeof rows>();
  for (const row of rows) {
    byExercise.set(row.exerciseId, [...(byExercise.get(row.exerciseId) ?? []), row]);
    if (row.substitutionGroup) {
      byGroup.set(row.substitutionGroup, [...(byGroup.get(row.substitutionGroup) ?? []), row]);
    }
  }

  return planned.map((p) => {
    const history = byExercise.get(p.exerciseId) ?? [];
    const asLogged: LoggedSet[] = history.map((h) => ({
      weightKg: h.weightKg,
      reps: h.reps,
      rir: h.rir,
      rpe: h.rpe,
      completedAt: h.completedAt,
      isWarmup: h.isWarmup,
    }));

    // Only the most recent session informs the progression decision; older
    // sessions would drag a suggestion toward loads already progressed past.
    const latestSessionId = history[0]?.sessionId;
    const lastSession = asLogged.filter(
      (_, i) => history[i]?.sessionId === latestSessionId,
    );

    const suggestion = suggestLoad({
      lastSession,
      allHistory: asLogged,
      targetRepMin: p.repMin ?? 5,
      targetRepMax: p.repMax ?? 10,
      targetRir: p.targetRir,
      targetRpe: p.targetRpe,
      targetPercent1rm: p.targetPercent1rm,
      incrementKg: incrementForLoadType(p.loadType),
    });

    const best = bestEstimateFrom(asLogged);

    // Nothing logged for this exact lift: offer a related variant as a
    // reference rather than nothing at all.
    if (suggestion.confidence === "none") {
      const related = findRelatedReference(byGroup, groupOf.get(p.exerciseId), p.exerciseId);
      if (related) {
        return {
          loadKg: null,
          reason:
            `Not logged before. Your ${related.exerciseName} is ${related.weightKg} kg for ` +
            `${related.reps} — a useful reference, though the variants rarely match exactly.`,
          confidence: "low" as const,
          plannedExerciseId: p.plannedExerciseId,
          exerciseId: p.exerciseId,
          estimatedOneRepMax: null,
        };
      }
    }

    return {
      ...suggestion,
      plannedExerciseId: p.plannedExerciseId,
      exerciseId: p.exerciseId,
      estimatedOneRepMax: best ? Math.round(best.oneRepMax) : null,
    };
  });
}

/** Heaviest recent working set from a different exercise in the same group. */
function findRelatedReference(
  byGroup: Map<string, { exerciseId: string; exerciseName: string; weightKg: number | null; reps: number | null; isWarmup: boolean }[]>,
  group: string | null | undefined,
  excludeExerciseId: string,
): RelatedReference | null {
  if (!group) return null;

  const candidates = (byGroup.get(group) ?? []).filter(
    (r) => r.exerciseId !== excludeExerciseId && !r.isWarmup && r.weightKg != null && r.reps != null,
  );
  if (candidates.length === 0) return null;

  const heaviest = candidates.reduce((best, r) => ((r.weightKg ?? 0) > (best.weightKg ?? 0) ? r : best));
  return {
    exerciseName: heaviest.exerciseName,
    weightKg: heaviest.weightKg!,
    reps: heaviest.reps!,
  };
}

/**
 * Reads training effort over the recent past.
 *
 * Reports a pattern rather than a verdict — an app cannot know how someone
 * feels, only what they logged.
 */
export async function getRecentFatigue(targetRir = 2): Promise<FatigueReading> {
  await requireAuth();

  const since = new Date(Date.now() - FATIGUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await getDb()
    .select({
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      completedAt: setLogs.completedAt,
      isWarmup: setLogs.isWarmup,
    })
    .from(setLogs)
    .innerJoin(sessions, eq(sessions.id, setLogs.sessionId))
    .where(and(gte(sessions.startedAt, since), eq(setLogs.isWarmup, false)));

  return readFatigue(rows, targetRir);
}

export type StrengthEstimate = {
  exerciseId: string;
  exerciseName: string;
  slug: string;
  estimatedOneRepMax: number;
  fromWeightKg: number;
  fromReps: number;
  fromRir: number | null;
  achievedAt: Date;
};

/**
 * Current estimated maxima across everything logged.
 *
 * Restricted to compound lifts: an estimated max on a lateral raise is noise,
 * and listing it invites treating a number as meaningful when it is not.
 */
export async function getStrengthEstimates(limit = 12): Promise<StrengthEstimate[]> {
  await requireAuth();

  const rows = await getDb()
    .select({
      exerciseId: setLogs.exerciseId,
      exerciseName: exercises.name,
      slug: exercises.slug,
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      completedAt: setLogs.completedAt,
      isWarmup: setLogs.isWarmup,
    })
    .from(setLogs)
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(and(eq(exercises.isCompound, true), eq(setLogs.isWarmup, false)))
    .orderBy(desc(setLogs.completedAt));

  const byExercise = new Map<string, typeof rows>();
  for (const row of rows) {
    byExercise.set(row.exerciseId, [...(byExercise.get(row.exerciseId) ?? []), row]);
  }

  const estimates: StrengthEstimate[] = [];
  for (const [exerciseId, sets] of byExercise) {
    const best = bestEstimateFrom(sets);
    if (!best || best.oneRepMax <= 0) continue;
    const source = sets.find((s) => s.completedAt === best.from.completedAt) ?? sets[0];
    estimates.push({
      exerciseId,
      exerciseName: source.exerciseName,
      slug: source.slug,
      estimatedOneRepMax: Math.round(best.oneRepMax),
      fromWeightKg: best.from.weightKg!,
      fromReps: best.from.reps!,
      fromRir: best.from.rir,
      achievedAt: best.from.completedAt,
    });
  }

  return estimates
    .sort((a, b) => b.estimatedOneRepMax - a.estimatedOneRepMax)
    .slice(0, limit);
}

/**
 * Records current estimates so strength trends survive later edits to history.
 *
 * Appended rather than updated: the table is a log, so a percentage-based block
 * can reference the max that was current when it was written.
 */
export async function recordStrengthEstimates(): Promise<number> {
  await requireAuth();
  const estimates = await getStrengthEstimates(50);
  if (estimates.length === 0) return 0;

  await getDb()
    .insert(exerciseMaxes)
    .values(
      estimates.map((e) => ({
        exerciseId: e.exerciseId,
        estimated1rmKg: e.estimatedOneRepMax,
        formula: "epley-rir",
        calculatedAt: new Date(),
      })),
    );

  return estimates.length;
}

/** Total working volume per week, for a simple trend. */
export async function getWeeklyVolume(weeks = 8) {
  await requireAuth();

  return getDb()
    .select({
      week: sql<string>`to_char(date_trunc('week', ${sessions.startedAt}), 'YYYY-MM-DD')`,
      volumeKg: sql<number>`coalesce(sum(${setLogs.weightKg} * ${setLogs.reps}), 0)::real`,
      sets: sql<number>`count(${setLogs.id})::int`,
    })
    .from(setLogs)
    .innerJoin(sessions, eq(sessions.id, setLogs.sessionId))
    .where(eq(setLogs.isWarmup, false))
    .groupBy(sql`date_trunc('week', ${sessions.startedAt})`)
    .orderBy(desc(sql`date_trunc('week', ${sessions.startedAt})`))
    .limit(weeks);
}

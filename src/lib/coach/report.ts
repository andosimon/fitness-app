import type { ExerciseHistory, MuscleWeek } from "@/lib/db/queries/analysis";
import type { MuscleGroup } from "@/lib/domain/types";
import { bestEstimateFrom } from "@/lib/engine/progression";
import { WEEKLY_VOLUME_LANDMARKS } from "@/lib/engine/volume";

/**
 * Turning raw history into the shapes the coach reads.
 *
 * These are pure so they can be tested without a database, and so the
 * judgements they encode — what counts as "below MEV", which week is still in
 * progress, when an estimate is worth quoting — live in one place rather than
 * being re-derived in a prompt every time.
 */

// ---------------------------------------------------------------------------
// Volume against the landmarks
// ---------------------------------------------------------------------------

export type VolumeVerdict =
  | "below_mev"
  | "productive"
  | "near_ceiling"
  | "above_mrv"
  | "indirect_only";

export type MuscleVolumeReport = {
  muscle: MuscleGroup;
  /** Average credited sets per completed week in the window. */
  weeklyAverage: number;
  /** This week so far. Partial by definition, so never fed into the average. */
  currentWeekSets: number;
  /** Sets where the muscle was the primary target, averaged the same way. */
  weeklyDirectAverage: number;
  landmarks: { mev: number; mav: number; mrv: number };
  verdict: VolumeVerdict;
  note: string;
};

/** Monday 00:00 of the week containing `date`, as an ISO date string. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. Postgres date_trunc('week') starts Monday, so match it.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function verdictFor(average: number, landmarks: { mev: number; mav: number; mrv: number }): {
  verdict: VolumeVerdict;
  note: string;
} {
  const { mev, mav, mrv } = landmarks;

  /*
   * A zero minimum is not "you need none of this" — it means the muscle gets
   * enough from compound work that a direct target would over-programme it.
   * Front delts and lower back sit here. Reporting them as "below MEV" would
   * read as a gap and invite adding work that is already being done.
   */
  if (mev === 0 && average <= mav) {
    return {
      verdict: "indirect_only",
      note: "No direct minimum — this gets worked hard indirectly. Nothing to fix.",
    };
  }

  if (average < mev) {
    return {
      verdict: "below_mev",
      note: `Under the minimum effective volume of ${mev} sets. Little adaptation expected here.`,
    };
  }
  if (average <= mav) {
    return {
      verdict: "productive",
      note: `Inside the productive range (${mev}-${mav} sets).`,
    };
  }
  if (average <= mrv) {
    return {
      verdict: "near_ceiling",
      note: `Above the maximum adaptive volume of ${mav}, still under the recoverable ceiling of ${mrv}. Sustainable for a block, not indefinitely.`,
    };
  }
  return {
    verdict: "above_mrv",
    note: `Over the maximum recoverable volume of ${mrv} sets. Fatigue is likely outpacing adaptation.`,
  };
}

/**
 * Weekly volume per muscle, judged against the landmarks the engine plans to.
 *
 * The in-progress week is separated out rather than averaged in. On a Tuesday
 * it holds one session, and folding that into the mean would make every
 * midweek reading look like a volume crash.
 */
export type VolumeReport = {
  windowWeeks: number;
  /** Completed weeks the averages are divided by. */
  weeksAveragedOver: number;
  note: string;
  muscles: MuscleVolumeReport[];
};

export function summariseVolume(
  rows: MuscleWeek[],
  windowWeeks: number,
  now = new Date(),
): VolumeReport {
  const current = weekStart(now);

  const byMuscle = new Map<MuscleGroup, { total: number; direct: number; currentWeek: number }>();
  const completedWeeks = new Set<string>();

  for (const row of rows) {
    const entry = byMuscle.get(row.muscle) ?? { total: 0, direct: 0, currentWeek: 0 };
    if (row.week === current) {
      entry.currentWeek += row.sets;
    } else {
      entry.total += row.sets;
      entry.direct += row.directSets;
      completedWeeks.add(row.week);
    }
    byMuscle.set(row.muscle, entry);
  }

  /*
   * Divide by the weeks the data actually spans, not by the count of weeks
   * containing sets and not by the whole window.
   *
   * Both simpler options mislead in opposite directions. Dividing by weeks-with-
   * data reports someone who trained hard once and then vanished for a month as
   * being on target; dividing by the full window reports someone two weeks into
   * using the app as doing a quarter of the volume they are actually doing.
   * The span — first logged week through last completed week — counts the gaps
   * inside a training history without inventing gaps before it started.
   */
  const divisor = Math.min(windowWeeks, spanInWeeks(completedWeeks));

  const reports: MuscleVolumeReport[] = [];
  for (const [muscle, entry] of byMuscle) {
    const landmarks = WEEKLY_VOLUME_LANDMARKS[muscle];
    if (!landmarks) continue;

    const weeklyAverage = round1(entry.total / divisor);
    const { verdict, note } = verdictFor(weeklyAverage, landmarks);

    reports.push({
      muscle,
      weeklyAverage,
      currentWeekSets: round1(entry.currentWeek),
      weeklyDirectAverage: round1(entry.direct / divisor),
      landmarks,
      verdict,
      note,
    });
  }

  // Problems first: the muscles that are outside the productive range are what
  // a question about volume is usually really about.
  const severity: Record<VolumeVerdict, number> = {
    above_mrv: 0,
    below_mev: 1,
    near_ceiling: 2,
    productive: 3,
    indirect_only: 4,
  };
  reports.sort(
    (a, b) => severity[a.verdict] - severity[b.verdict] || b.weeklyAverage - a.weeklyAverage,
  );

  return {
    windowWeeks,
    weeksAveragedOver: divisor,
    /*
     * The divisor is reported because it changes what the verdicts mean. One
     * completed week of data can put every muscle under MEV, and that reads as
     * a programme problem when it is really a short history — a distinction
     * worth stating outright rather than hoping it gets inferred.
     */
    note:
      completedWeeks.size === 0
        ? "No completed weeks yet — everything logged is from the week in progress."
        : divisor <= 2
          ? `Averages rest on only ${divisor} completed week${divisor === 1 ? "" : "s"}. Too little to call anything a trend.`
          : `Averages are over ${divisor} completed weeks. The week in progress is reported separately.`,
    muscles: reports,
  };
}

// ---------------------------------------------------------------------------
// One exercise over time
// ---------------------------------------------------------------------------

export type ExerciseSessionSummary = {
  date: string;
  sessionName: string;
  workingSets: number;
  /** Heaviest working set that day. */
  topSet: string;
  estimatedOneRepMax: number | null;
};

export type ExerciseReport = {
  exercise: string;
  loadType: string;
  sessionsLogged: number;
  best: { estimatedOneRepMax: number; date: string } | null;
  latest: { estimatedOneRepMax: number; date: string } | null;
  /** Change between the first and last estimate in the window, in kg. */
  changeKg: number | null;
  sessions: ExerciseSessionSummary[];
};

/**
 * Collapses a stream of sets into one row per session.
 *
 * A lifter asking "what has my bench done?" wants a dozen dates, not sixty
 * rows. Sending every set would also crowd out the rest of the context for no
 * additional signal — the top set and the estimate carry the trend.
 */
export function summariseExerciseHistory(history: ExerciseHistory): ExerciseReport {
  const byDay = new Map<string, ExerciseHistory["sets"]>();

  for (const set of history.sets) {
    const date = set.performedAt.toISOString().slice(0, 10);
    byDay.set(date, [...(byDay.get(date) ?? []), set]);
  }

  const sessions: ExerciseSessionSummary[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, sets]) => {
      const heaviest = sets.reduce((best, set) =>
        (set.weightKg ?? 0) > (best.weightKg ?? 0) ? set : best,
      );

      /*
       * The session's estimate comes from the engine, not from taking the
       * highest per-set number.
       *
       * `bestEstimateFrom` uses only the sets closest to failure, because reps
       * in reserve are judged badly when fresh. Max-ing across the session
       * instead would systematically pick the *first* set — the one where the
       * RIR call is least trustworthy — and the coach would then quote a
       * different max from the one the app's own strength page shows. On this
       * lifter's real bench session that difference is 93 kg against 88 kg.
       */
      const best = bestEstimateFrom(
        sets.map((set) => ({
          weightKg: set.weightKg,
          reps: set.reps,
          rir: set.rir,
          rpe: set.rpe,
          completedAt: set.performedAt,
          isWarmup: false,
        })),
      );

      return {
        date,
        sessionName: sets[0].sessionName,
        workingSets: sets.length,
        topSet: describeSet(heaviest),
        estimatedOneRepMax: best ? Math.round(best.oneRepMax) : null,
      };
    });

  const estimated = sessions.filter((s) => s.estimatedOneRepMax !== null);
  const best = estimated.reduce<ExerciseReport["best"]>((current, session) => {
    if (current && current.estimatedOneRepMax >= session.estimatedOneRepMax!) return current;
    return { estimatedOneRepMax: session.estimatedOneRepMax!, date: session.date };
  }, null);

  const latest = estimated[0]
    ? { estimatedOneRepMax: estimated[0].estimatedOneRepMax!, date: estimated[0].date }
    : null;
  const oldest = estimated[estimated.length - 1];

  return {
    exercise: history.exerciseName,
    loadType: history.loadType,
    sessionsLogged: sessions.length,
    best,
    latest,
    changeKg:
      latest && oldest && estimated.length > 1
        ? Math.round((latest.estimatedOneRepMax - oldest.estimatedOneRepMax!) * 10) / 10
        : null,
    sessions,
  };
}

function describeSet(set: {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  isAmrap: boolean;
}): string {
  const load = set.weightKg !== null ? `${set.weightKg} kg` : "bodyweight";
  const reps = set.reps !== null ? ` x ${set.reps}` : "";
  const effort =
    set.rir !== null ? ` @ RIR ${set.rir}` : set.rpe !== null ? ` @ RPE ${set.rpe}` : "";
  return `${load}${reps}${effort}${set.isAmrap ? " (AMRAP)" : ""}`;
}

/** Weeks from the earliest to the latest entry, inclusive. Never below one. */
function spanInWeeks(weeks: Set<string>): number {
  if (weeks.size === 0) return 1;
  const times = [...weeks].map((week) => Date.parse(week));
  const span = (Math.max(...times) - Math.min(...times)) / (7 * 24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(span) + 1);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

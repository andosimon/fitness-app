import type {
  ExperienceLevel,
  GoalWeights,
  MuscleGroup,
  SplitType,
} from "@/lib/domain/types";

/**
 * Weekly volume planning.
 *
 * ## On the numbers below
 *
 * These follow the widely used MEV/MAV/MRV framework. It is the most practical
 * scheme available, but the evidence underneath it is noisier than the precision
 * implies: meta-analyses support roughly 10-20 hard sets per muscle per week for
 * hypertrophy with a dose-response that flattens toward the top, and individual
 * variation is large. Treat these as informed starting points that autoregulation
 * corrects, not as measured constants.
 *
 * Volume is counted in hard working sets per muscle per week. Warm-ups do not
 * count. A set counts fully toward its primary muscles and half toward its
 * secondary ones, which is how indirect work is credited.
 */

export type VolumeLandmarks = {
  /** Minimum effective volume: below this, little adaptation. */
  mev: number;
  /** Maximum adaptive volume: the productive working range's upper end. */
  mav: number;
  /** Maximum recoverable volume: beyond this, fatigue outpaces adaptation. */
  mrv: number;
};

/**
 * Some muscles carry low minimums because they receive heavy indirect work.
 * Front delts are hammered by all pressing; lower back by every squat and
 * hinge. Programming them as though they were isolated is how people end up
 * chronically overreached on the small stuff.
 */
export const WEEKLY_VOLUME_LANDMARKS: Record<MuscleGroup, VolumeLandmarks> = {
  chest: { mev: 8, mav: 16, mrv: 22 },
  lats: { mev: 10, mav: 18, mrv: 25 },
  upper_back: { mev: 8, mav: 16, mrv: 24 },
  traps: { mev: 0, mav: 12, mrv: 20 },
  lower_back: { mev: 0, mav: 8, mrv: 14 },

  front_delts: { mev: 0, mav: 8, mrv: 14 },
  side_delts: { mev: 8, mav: 18, mrv: 26 },
  rear_delts: { mev: 6, mav: 14, mrv: 24 },

  biceps: { mev: 8, mav: 16, mrv: 24 },
  triceps: { mev: 6, mav: 12, mrv: 20 },
  forearms: { mev: 0, mav: 8, mrv: 14 },

  quads: { mev: 8, mav: 15, mrv: 20 },
  hamstrings: { mev: 6, mav: 12, mrv: 18 },
  glutes: { mev: 4, mav: 12, mrv: 18 },
  adductors: { mev: 0, mav: 6, mrv: 12 },
  abductors: { mev: 0, mav: 6, mrv: 12 },
  calves: { mev: 8, mav: 14, mrv: 20 },

  abs: { mev: 0, mav: 14, mrv: 22 },
  obliques: { mev: 0, mav: 10, mrv: 16 },
  neck: { mev: 0, mav: 6, mrv: 12 },
};

/**
 * Where in the MEV-to-MAV range a lifter starts.
 *
 * Beginners adapt to very little and recover poorly from a lot; advanced
 * lifters need more stimulus to progress and tolerate it better.
 */
const EXPERIENCE_POSITION: Record<ExperienceLevel, number> = {
  beginner: 0.15,
  intermediate: 0.55,
  advanced: 0.85,
};

export type Specialization = {
  /**
   * Muscles to bring up. Pushed toward MRV, paid for by cutting others.
   * More than two at once defeats the purpose.
   */
  priorityMuscles?: MuscleGroup[];
  /**
   * A lift being specifically pursued, e.g. a max squat. The muscles it trains
   * receive priority treatment, and the engine raises its frequency elsewhere.
   */
  priorityMuscleGroupsFromLift?: MuscleGroup[];
};

export type VolumePlan = {
  /** Target hard sets per muscle per week. */
  weeklySets: Partial<Record<MuscleGroup, number>>;
  /** Muscles pushed toward MRV. */
  prioritised: MuscleGroup[];
  /** Muscles trimmed toward MEV to pay for the priorities. */
  trimmed: MuscleGroup[];
  totalWeeklySets: number;
  /** Sets the schedule can actually deliver, from the time budget. */
  capacityWeeklySets: number;
  /** True when targets were scaled down to fit the available time. */
  scaledToFit: boolean;
};

export type VolumeInput = {
  goals: GoalWeights;
  experience: ExperienceLevel;
  /** Total hard sets the week's sessions can hold, from `budgetSession`. */
  capacityWeeklySets: number;
  specialization?: Specialization;
  /** Muscles to leave out entirely, e.g. around an injury. */
  excludedMuscles?: MuscleGroup[];
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Scales values to sum to exactly `target`, using largest-remainder rounding.
 *
 * Rounding each value independently can round most of them up and overshoot the
 * target — the very thing the scaling exists to prevent. Flooring first and then
 * handing the leftover sets to the largest fractional parts keeps the sum exact.
 */
function scaleToTarget(
  entries: { muscle: MuscleGroup; raw: number }[],
  target: number,
): [MuscleGroup, number][] {
  const rawTotal = entries.reduce((sum, e) => sum + e.raw, 0);
  if (rawTotal === 0 || target <= 0) return entries.map((e) => [e.muscle, 0]);

  const factor = target / rawTotal;
  const scaled = entries.map((e) => {
    const exact = e.raw * factor;
    return { muscle: e.muscle, exact, value: Math.floor(exact) };
  });

  let sum = scaled.reduce((acc, e) => acc + e.value, 0);
  const byRemainder = [...scaled].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; i < byRemainder.length && sum < target; i++) {
    byRemainder[i].value += 1;
    sum += 1;
  }

  return scaled.map((e) => [e.muscle, e.value]);
}

/**
 * Strength work carries lower volume at higher intensity; hypertrophy the
 * reverse. Fat-loss blocks hold volume roughly steady, since the training job
 * during a deficit is to retain muscle rather than add it.
 */
function goalVolumeMultiplier(goals: GoalWeights): number {
  const strength = goals.strength ?? 0;
  const hypertrophy = goals.hypertrophy ?? 0;
  const fatLoss = goals.fat_loss ?? 0;
  const endurance = goals.endurance ?? 0;
  const total = strength + hypertrophy + fatLoss + endurance;
  if (total === 0) return 1;

  const weighted =
    (strength * 0.85 + hypertrophy * 1.1 + fatLoss * 0.95 + endurance * 0.9) / total;
  return weighted;
}

/**
 * Builds weekly per-muscle set targets.
 *
 * Specialisation is zero-sum on purpose. Adding volume to a priority muscle
 * without removing it elsewhere just raises total fatigue, which is how a
 * specialisation block turns into a stalled block. Non-priority muscles are
 * therefore trimmed toward MEV — enough to hold what you have, not to grow.
 */
export function planWeeklyVolume(input: VolumeInput): VolumePlan {
  const { goals, experience, capacityWeeklySets, specialization, excludedMuscles = [] } = input;

  const priority = new Set<MuscleGroup>([
    ...(specialization?.priorityMuscles ?? []),
    ...(specialization?.priorityMuscleGroupsFromLift ?? []),
  ]);
  const excluded = new Set(excludedMuscles);
  const hasSpecialisation = priority.size > 0;

  const position = EXPERIENCE_POSITION[experience];
  const goalMultiplier = goalVolumeMultiplier(goals);

  const weeklySets: Partial<Record<MuscleGroup, number>> = {};
  const prioritised: MuscleGroup[] = [];
  const trimmed: MuscleGroup[] = [];

  for (const [muscle, landmarks] of Object.entries(WEEKLY_VOLUME_LANDMARKS) as [
    MuscleGroup,
    VolumeLandmarks,
  ][]) {
    if (excluded.has(muscle)) continue;

    let target: number;

    if (priority.has(muscle)) {
      // Toward MRV, but not at it: sitting on the ceiling leaves no room to add
      // volume later in the block when adaptation slows.
      target = lerp(landmarks.mav, landmarks.mrv, 0.6);
      prioritised.push(muscle);
    } else {
      /**
       * Non-priority muscles keep their normal target here and are trimmed by
       * the capacity scaling below, which reserves the priority target first.
       *
       * Trimming them here as well would double-count: a lower raw total makes
       * the scaling gentler, handing the freed volume straight back. An earlier
       * version did exactly that and chest volume went *up* under a squat
       * specialisation.
       */
      target = lerp(landmarks.mev, landmarks.mav, position);
      if (hasSpecialisation) trimmed.push(muscle);
    }

    target *= goalMultiplier;

    const rounded = Math.round(target);
    if (rounded > 0) weeklySets[muscle] = rounded;
  }

  let total = Object.values(weeklySets).reduce((sum, n) => sum + (n ?? 0), 0);
  let scaledToFit = false;

  /**
   * Volume that will not fit in the week's sessions is not a plan, it is a
   * wish. Targets are scaled proportionally to the time actually available —
   * this is what ties volume planning to the session time budget.
   */
  if (capacityWeeklySets > 0 && total > capacityWeeklySets) {
    scaledToFit = true;

    const priorityMuscles = (Object.keys(weeklySets) as MuscleGroup[]).filter((m) =>
      priority.has(m),
    );
    const otherMuscles = (Object.keys(weeklySets) as MuscleGroup[]).filter(
      (m) => !priority.has(m),
    );
    const priorityTotal = priorityMuscles.reduce((sum, m) => sum + (weeklySets[m] ?? 0), 0);

    /**
     * The cut lands on non-priority work, not proportionally across everything.
     *
     * Scaling every muscle by the same factor preserves their ratios, which
     * quietly undoes the specialisation: trimming the non-priority muscles
     * lowers the raw total, which makes the scaling gentler, which hands the
     * freed volume straight back. The priority target has to be reserved first
     * and the remainder shared out among the rest.
     */
    if (priorityTotal > 0 && priorityTotal < capacityWeeklySets) {
      const scaled = scaleToTarget(
        otherMuscles.map((m) => ({ muscle: m, raw: weeklySets[m] ?? 0 })),
        capacityWeeklySets - priorityTotal,
      );
      for (const [muscle, value] of scaled) {
        if (value > 0) weeklySets[muscle] = value;
        else delete weeklySets[muscle];
      }
    } else {
      // Either nothing is prioritised, or the priorities alone exceed capacity.
      // Both cases fall back to scaling everything.
      const scaled = scaleToTarget(
        (Object.keys(weeklySets) as MuscleGroup[]).map((m) => ({
          muscle: m,
          raw: weeklySets[m] ?? 0,
        })),
        capacityWeeklySets,
      );
      for (const [muscle, value] of scaled) {
        if (value > 0) weeklySets[muscle] = value;
        else delete weeklySets[muscle];
      }
    }

    total = Object.values(weeklySets).reduce((sum, n) => sum + (n ?? 0), 0);
  }

  return {
    weeklySets,
    prioritised,
    trimmed,
    totalWeeklySets: total,
    capacityWeeklySets,
    scaledToFit,
  };
}

/**
 * How many times a week each muscle is trained under a given split.
 *
 * Frequency matters because per-session volume has a ceiling: past roughly ten
 * hard sets for one muscle in one session, the later sets contribute little.
 * Spreading the same weekly volume over more sessions keeps every set useful.
 */
export const SPLIT_FREQUENCY: Record<SplitType, (daysPerWeek: number) => number> = {
  full_body: (days) => days,
  upper_lower: (days) => Math.max(1, Math.floor(days / 2)),
  push_pull_legs: (days) => Math.max(1, Math.floor(days / 3)),
  push_pull: (days) => Math.max(1, Math.floor(days / 2)),
  upper_lower_full: (days) => Math.max(1, Math.round((days * 2) / 3)),
  body_part: () => 1,
  hybrid_conditioning: (days) => Math.max(1, Math.floor(days / 2)),
};

/** Beyond this many sets for one muscle in one session, returns diminish sharply. */
export const PER_SESSION_SET_CEILING = 10;

export type SessionVolumeTarget = {
  muscle: MuscleGroup;
  setsPerSession: number;
  sessionsPerWeek: number;
  /** Weekly sets actually deliverable, after the per-session ceiling. */
  effectiveWeeklySets: number;
  /** True when the ceiling prevented the weekly target being met. */
  cappedByCeiling: boolean;
};

/**
 * Splits weekly targets into per-session targets for a given split.
 *
 * Reports where the per-session ceiling bites rather than silently dropping the
 * excess: a weekly target that the chosen split cannot deliver is a reason to
 * change the split, and the caller should be able to see that.
 */
export function distributeAcrossSessions(
  weeklySets: Partial<Record<MuscleGroup, number>>,
  split: SplitType,
  daysPerWeek: number,
): SessionVolumeTarget[] {
  const sessionsPerWeek = SPLIT_FREQUENCY[split](daysPerWeek);

  return (Object.entries(weeklySets) as [MuscleGroup, number][])
    .map(([muscle, weekly]) => {
      const ideal = weekly / sessionsPerWeek;
      const setsPerSession = Math.min(Math.round(ideal), PER_SESSION_SET_CEILING);
      const effectiveWeeklySets = setsPerSession * sessionsPerWeek;
      return {
        muscle,
        setsPerSession,
        sessionsPerWeek,
        effectiveWeeklySets,
        cappedByCeiling: ideal > PER_SESSION_SET_CEILING,
      };
    })
    .filter((t) => t.setsPerSession > 0)
    .sort((a, b) => b.effectiveWeeklySets - a.effectiveWeeklySets);
}

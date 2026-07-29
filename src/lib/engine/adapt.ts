import type { Equipment, MuscleGroup } from "@/lib/domain/types";

import { isPerformable, type SelectableExercise } from "./selection";

/**
 * Adapting a planned session to different equipment.
 *
 * Travel mode. The session already knows what it owes — so many sets of this
 * muscle, that movement pattern — and the job is to deliver as much of that as
 * the available kit allows, changing only what has to change.
 *
 * Two principles:
 *
 * - **Substitute, don't regenerate.** Keeping every exercise that still works
 *   means a hotel session is recognisably the session you were going to do, and
 *   the loads you have logged still apply to most of it. Regenerating from
 *   scratch would silently throw that away.
 * - **Report what was lost.** Some volume genuinely cannot be covered in a bare
 *   room. Saying so is more useful than quietly substituting a token movement
 *   and pretending the session is intact.
 */

export type PlannedForAdaptation = {
  plannedExerciseId: string;
  exercise: SelectableExercise;
  sets: number;
  supersetGroup: string | null;
};

export type AdaptationOutcome = "kept" | "substituted" | "dropped";

export type AdaptedExercise = {
  plannedExerciseId: string;
  original: SelectableExercise;
  /** Null when nothing available could stand in. */
  replacement: SelectableExercise | null;
  sets: number;
  supersetGroup: string | null;
  outcome: AdaptationOutcome;
  /** Explains the swap, shown to the lifter. */
  note: string;
};

export type AdaptedSession = {
  exercises: AdaptedExercise[];
  kept: number;
  substituted: number;
  dropped: number;
  /** Primary-muscle volume the available equipment could not deliver. */
  uncovered: { muscle: MuscleGroup; sets: number }[];
};

export type AdaptationInput = {
  planned: PlannedForAdaptation[];
  availableEquipment: Equipment[];
  library: SelectableExercise[];
  excludeExerciseIds?: string[];
};

/**
 * Ranks how well a candidate stands in for an exercise.
 *
 * Ordered by how much of the original's job it does: the same substitution
 * group is a near-equivalent by definition, the same pattern and muscle is a
 * fair trade, and sharing only a muscle is a last resort that keeps the volume
 * even though the movement differs.
 */
function substitutionScore(
  original: SelectableExercise,
  candidate: SelectableExercise,
): number {
  if (candidate.id === original.id) return -1;

  const sharesPrimary = candidate.primaryMuscles.some((m) =>
    original.primaryMuscles.includes(m),
  );
  const samePattern = candidate.movementPattern === original.movementPattern;
  const sameGroup =
    original.substitutionGroup !== null &&
    candidate.substitutionGroup === original.substitutionGroup;

  /**
   * A shared muscle, or an explicit substitution group, is required.
   *
   * Matching on movement pattern alone is not enough: `isolation_upper` covers
   * shrugs, curls, lateral raises and triceps pushdowns alike. Allowing it
   * produced real nonsense — a dumbbell shrug substituted by a band curl, and a
   * biceps curl replaced by its own antagonist. A substitution has to do some
   * part of the original's job, and training a different muscle does not.
   */
  if (!sharesPrimary && !sameGroup) return -1;

  let score = 0;
  if (sameGroup) score += 100;
  if (samePattern) score += 40;
  if (sharesPrimary) score += 30;

  // Among equals, prefer the higher stimulus-to-fatigue option, and something
  // of comparable complexity — a hotel substitute should not be a skill lift.
  score += candidate.stimulusFatigueRatio * 3;
  score -= Math.abs(candidate.complexity - original.complexity) * 2;
  if (candidate.isCompound === original.isCompound) score += 5;

  return score;
}

export function adaptSessionToEquipment(input: AdaptationInput): AdaptedSession {
  const { planned, availableEquipment, library, excludeExerciseIds = [] } = input;

  const excluded = new Set(excludeExerciseIds);
  const performable = library.filter(
    (e) => !excluded.has(e.id) && isPerformable(e, availableEquipment),
  );

  const used = new Set<string>();
  const exercises: AdaptedExercise[] = [];

  for (const item of planned) {
    const { exercise, sets, plannedExerciseId, supersetGroup } = item;

    if (isPerformable(exercise, availableEquipment) && !excluded.has(exercise.id)) {
      used.add(exercise.id);
      exercises.push({
        plannedExerciseId,
        original: exercise,
        replacement: exercise,
        sets,
        supersetGroup,
        outcome: "kept",
        note: "Unchanged — you have the kit for this.",
      });
      continue;
    }

    const candidates = performable
      .filter((c) => !used.has(c.id))
      .map((c) => ({ candidate: c, score: substitutionScore(exercise, c) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0]?.candidate;

    if (!best) {
      exercises.push({
        plannedExerciseId,
        original: exercise,
        replacement: null,
        sets,
        supersetGroup,
        outcome: "dropped",
        note: `Nothing here covers ${exercise.name}. That volume is lost this session.`,
      });
      continue;
    }

    used.add(best.id);
    const sameGroup =
      exercise.substitutionGroup !== null &&
      best.substitutionGroup === exercise.substitutionGroup;

    exercises.push({
      plannedExerciseId,
      original: exercise,
      replacement: best,
      // The substitute keeps the set count: the point is to preserve the volume
      // owed, not to redesign the session.
      sets,
      supersetGroup,
      outcome: "substituted",
      note: sameGroup
        ? `Standing in for ${exercise.name} — same job, different kit.`
        : `Closest available to ${exercise.name}. Expect it to feel different; the loads will not carry over.`,
    });
  }

  // What the equipment could not deliver, by primary muscle.
  const uncoveredByMuscle = new Map<MuscleGroup, number>();
  for (const item of exercises) {
    if (item.outcome !== "dropped") continue;
    for (const muscle of item.original.primaryMuscles) {
      uncoveredByMuscle.set(muscle, (uncoveredByMuscle.get(muscle) ?? 0) + item.sets);
    }
  }

  return {
    exercises,
    kept: exercises.filter((e) => e.outcome === "kept").length,
    substituted: exercises.filter((e) => e.outcome === "substituted").length,
    dropped: exercises.filter((e) => e.outcome === "dropped").length,
    uncovered: [...uncoveredByMuscle.entries()]
      .map(([muscle, sets]) => ({ muscle, sets }))
      .sort((a, b) => b.sets - a.sets),
  };
}

/**
 * A one-line summary of how much the session changed.
 *
 * Worth surfacing before the lifter commits: "everything unchanged" and "half
 * of this is a compromise" are very different sessions to walk into.
 */
export function describeAdaptation(session: AdaptedSession): string {
  const parts: string[] = [];
  if (session.kept > 0) parts.push(`${session.kept} unchanged`);
  if (session.substituted > 0) parts.push(`${session.substituted} swapped`);
  if (session.dropped > 0) parts.push(`${session.dropped} not possible`);

  if (session.dropped === 0 && session.substituted === 0) {
    return "Everything in this session works with that equipment.";
  }

  const summary = parts.join(", ");
  if (session.uncovered.length === 0) return `${summary}. Volume is preserved.`;

  const worst = session.uncovered
    .slice(0, 3)
    .map((u) => `${u.muscle.replace(/_/g, " ")} (${u.sets})`)
    .join(", ");
  return `${summary}. Sets you will not get here: ${worst}.`;
}

import {
  FOUNDATIONAL_PATTERNS,
  type Equipment,
  type ExperienceLevel,
  type GoalWeights,
  type MovementPattern,
  type MuscleGroup,
  type SessionType,
  type SplitType,
} from "@/lib/domain/types";

import { prescribeSession, type SetPrescription } from "./prescription";
import {
  chooseAnchorPatterns,
  selectSessionExercises,
  type ExerciseRole,
  type SelectableExercise,
} from "./selection";
import { planLiftSpecialisation } from "./specialisation";
import { buildRotation, isRollingSchedule } from "./splits";
import { budgetSession } from "./time-budget";
import { distributeAcrossSessions, planWeeklyVolume } from "./volume";

/**
 * Composes the engine modules into a complete programme.
 *
 * Pure: takes the library as an argument and returns a plain structure. The
 * database layer is responsible for loading the library and writing the result,
 * which keeps the whole of the programming logic testable without a connection.
 */

export const ENGINE_VERSION = "0.2.0";

export type GenerationInput = {
  name: string;
  daysPerWeek: number;
  /** Lifting minutes per session, excluding warm-up. */
  minutesPerSession: number;
  goalWeights: GoalWeights;
  experience: ExperienceLevel;
  splitType: SplitType;
  /** Total weeks including the deload. */
  weeks: number;
  availableEquipment: Equipment[];
  /** A movement pattern to bring up, e.g. squat for a bigger max. */
  specialisationPattern?: MovementPattern;
  excludedExerciseIds?: string[];
  /** Distinguishes programmes so two do not generate identically. */
  seed: string;
  /** Rotates anchor selection between mesocycles. */
  blockIndex?: number;
};

/**
 * One row of a session as it will be stored and displayed.
 *
 * Sets sharing an identical prescription are grouped, so a top set and its
 * back-offs become two rows of the same exercise rather than one row that
 * cannot express the difference.
 */
export type GeneratedExerciseRow = {
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  role: ExerciseRole;
  supersetGroup: string | null;
  sets: number;
  repMin: number;
  repMax: number;
  targetRir: number | null;
  targetRpe: number | null;
  targetPercent1rm: number | null;
  restSeconds: number;
  tempo: string | null;
  notes: string | null;
};

export type GeneratedSession = {
  dayIndex: number;
  name: string;
  sessionType: SessionType;
  targetMinutes: number;
  focus: string[];
  estimatedSeconds: number;
  rows: GeneratedExerciseRow[];
  shortfalls: { muscle: MuscleGroup; target: number; delivered: number }[];
};

export type GeneratedWeek = {
  weekNumber: number;
  isDeload: boolean;
  targetVolume: Partial<Record<MuscleGroup, number>>;
  intensityModifier: number;
  note: string;
  sessions: GeneratedSession[];
};

export type GeneratedProgram = {
  input: GenerationInput;
  engineVersion: string;
  weeks: GeneratedWeek[];
  /** Surfaced to the user: a rolling split lays out differently each week. */
  rolling: boolean;
  /** Weekly per-muscle targets before the split distributes them. */
  weeklyVolume: Partial<Record<MuscleGroup, number>>;
  specialisationNote: string | null;
};

/** Groups consecutive sets with identical prescriptions into one row. */
function groupSets(
  sets: SetPrescription[],
): Omit<GeneratedExerciseRow, "exerciseId" | "exerciseName" | "orderIndex" | "role" | "supersetGroup">[] {
  const rows: ReturnType<typeof groupSets> = [];

  for (const set of sets) {
    const last = rows[rows.length - 1];
    const sameAsLast =
      last &&
      last.repMin === set.repMin &&
      last.repMax === set.repMax &&
      last.targetRir === set.targetRir &&
      last.targetRpe === set.targetRpe &&
      last.targetPercent1rm === set.targetPercent1rm &&
      last.tempo === (set.tempo ?? null) &&
      last.notes === (set.note ?? null);

    if (sameAsLast) {
      last.sets += 1;
      continue;
    }

    rows.push({
      sets: 1,
      repMin: set.repMin,
      repMax: set.repMax,
      targetRir: set.targetRir,
      targetRpe: set.targetRpe,
      targetPercent1rm: set.targetPercent1rm,
      restSeconds: set.restSeconds,
      tempo: set.tempo ?? null,
      notes: set.note ?? null,
    });
  }

  return rows;
}

export function generateProgram(
  input: GenerationInput,
  library: SelectableExercise[],
): GeneratedProgram {
  const {
    daysPerWeek,
    minutesPerSession,
    goalWeights,
    experience,
    splitType,
    weeks,
    availableEquipment,
    specialisationPattern,
    excludedExerciseIds,
    seed,
    blockIndex = 0,
  } = input;

  const budget = budgetSession(minutesPerSession, goalWeights);
  const capacityWeeklySets = budget.totalSets * daysPerWeek;

  const specialisation = specialisationPattern
    ? planLiftSpecialisation({
        pattern: specialisationPattern,
        split: splitType,
        daysPerWeek,
        weeklySetsForPattern: Math.round(capacityWeeklySets * 0.15),
      })
    : undefined;

  const volume = planWeeklyVolume({
    goals: goalWeights,
    experience,
    capacityWeeklySets,
    specialization: specialisation
      ? { priorityMuscleGroupsFromLift: specialisation.supportingMuscles.slice(0, 2) }
      : undefined,
  });

  const perSession = distributeAcrossSessions(volume.weeklySets, splitType, daysPerWeek);
  const rotation = buildRotation(splitType, daysPerWeek, weeks);

  const generatedWeeks: GeneratedWeek[] = rotation.map((days, weekIdx) => {
    const weekNumber = weekIdx + 1;
    const isDeload = weekNumber >= weeks;

    // Day variants are counted within the week, so a day type appearing twice
    // gets an A and a B rather than two identical sessions.
    const seenThisWeek = new Map<string, number>();

    const sessions: GeneratedSession[] = days.map((day, dayIndex) => {
      const variant = seenThisWeek.get(day.key) ?? 0;
      seenThisWeek.set(day.key, variant + 1);

      const muscleTargets: Partial<Record<MuscleGroup, number>> = {};
      for (const target of perSession) {
        if (day.muscles.includes(target.muscle)) {
          muscleTargets[target.muscle] = target.setsPerSession;
        }
      }

      const anchorPatterns = chooseAnchorPatterns(
        day.patterns,
        FOUNDATIONAL_PATTERNS as MovementPattern[],
        variant,
      );

      // A specialised pattern always anchors the session that trains it.
      if (specialisationPattern && day.patterns.includes(specialisationPattern)) {
        const withoutIt = anchorPatterns.filter((p) => p !== specialisationPattern);
        anchorPatterns.length = 0;
        anchorPatterns.push(specialisationPattern, ...withoutIt.slice(0, 1));
      }

      const selected = selectSessionExercises({
        day,
        muscleTargets,
        secondsBudget: minutesPerSession * 60,
        anchorPatterns,
        setsPerAnchor: Math.max(3, Math.round(budget.heavySets / Math.max(1, anchorPatterns.length))),
        library,
        context: {
          availableEquipment,
          excludedExerciseIds,
          blockIndex,
          dayVariantIndex: variant,
          seed,
        },
      });

      const prescribed = prescribeSession({
        selected,
        goals: goalWeights,
        weekInBlock: weekNumber,
        blockLength: weeks,
        specialisation,
      });

      const rows: GeneratedExerciseRow[] = [];
      for (const item of prescribed.exercises) {
        for (const group of groupSets(item.sets)) {
          rows.push({
            exerciseId: item.selected.exercise.id,
            exerciseName: item.selected.exercise.name,
            orderIndex: rows.length,
            role: item.selected.role,
            supersetGroup: item.selected.supersetGroup ?? null,
            ...group,
          });
        }
      }

      const variantLabel = seenThisWeek.get(day.key)! > 1 || variant > 0
        ? ` ${String.fromCharCode(65 + variant)}`
        : "";

      return {
        dayIndex,
        name: `${day.label}${variantLabel}`,
        sessionType: (goalWeights.strength ?? 0) >= (goalWeights.hypertrophy ?? 0)
          ? "strength"
          : "hypertrophy",
        targetMinutes: minutesPerSession,
        focus: day.muscles.slice(0, 4),
        estimatedSeconds: selected.estimatedSeconds,
        rows,
        shortfalls: selected.shortfalls,
      };
    });

    return {
      weekNumber,
      isDeload,
      targetVolume: volume.weeklySets,
      intensityModifier: isDeload ? 0.6 : 1,
      note: prescribeSession({
        selected: { exercises: [], totalSets: 0, estimatedSeconds: 0, deliveredSets: {}, shortfalls: [] },
        goals: goalWeights,
        weekInBlock: weekNumber,
        blockLength: weeks,
      }).weekNote,
      sessions,
    };
  });

  return {
    input,
    engineVersion: ENGINE_VERSION,
    weeks: generatedWeeks,
    rolling: isRollingSchedule(splitType, daysPerWeek),
    weeklyVolume: volume.weeklySets,
    specialisationNote: specialisation?.rationale ?? null,
  };
}

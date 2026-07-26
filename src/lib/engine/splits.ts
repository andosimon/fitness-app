import type { MovementPattern, MuscleGroup, SplitType } from "@/lib/domain/types";

/**
 * Split templates and the rotations they produce.
 *
 * The important idea here is that a split is a *cycle of day types*, not a fixed
 * weekly calendar. Push/pull/legs run four days a week does not mean each day
 * type happens once and one is dropped — it rolls:
 *
 *   week 1  push pull legs push
 *   week 2  pull legs push pull
 *   week 3  legs push pull legs
 *
 * Over three weeks that is four of each. So the frequency of any day type is
 * `daysPerWeek x (matching day types / total day types)`, which is fractional
 * and must not be floored. An earlier version floored it, reporting one leg
 * session per week instead of 1.33, which then inflated per-session volume.
 */

export type SplitDay = {
  key: string;
  label: string;
  /** Movement patterns this day is responsible for. */
  patterns: MovementPattern[];
  /** Muscles this day trains directly. */
  muscles: MuscleGroup[];
};

const UPPER_PUSH_MUSCLES: MuscleGroup[] = ["chest", "front_delts", "side_delts", "triceps"];
const UPPER_PULL_MUSCLES: MuscleGroup[] = [
  "lats",
  "upper_back",
  "rear_delts",
  "biceps",
  "traps",
  "forearms",
];
const LOWER_MUSCLES: MuscleGroup[] = [
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
  "lower_back",
];
const CORE_MUSCLES: MuscleGroup[] = ["abs", "obliques"];

const PUSH_PATTERNS: MovementPattern[] = ["horizontal_push", "vertical_push", "isolation_upper"];
const PULL_PATTERNS: MovementPattern[] = ["horizontal_pull", "vertical_pull", "isolation_upper"];
const LEG_PATTERNS: MovementPattern[] = ["squat", "hinge", "lunge", "isolation_lower"];
const CORE_PATTERNS: MovementPattern[] = [
  "core_anti_extension",
  "core_anti_rotation",
  "core_flexion",
  "core_lateral_flexion",
];

const FULL_BODY_DAY: SplitDay = {
  key: "full",
  label: "Full Body",
  patterns: [...LEG_PATTERNS, ...PUSH_PATTERNS, ...PULL_PATTERNS, ...CORE_PATTERNS, "carry"],
  muscles: [...LOWER_MUSCLES, ...UPPER_PUSH_MUSCLES, ...UPPER_PULL_MUSCLES, ...CORE_MUSCLES],
};

export const SPLIT_DEFINITIONS: Record<SplitType, SplitDay[]> = {
  full_body: [FULL_BODY_DAY],

  upper_lower: [
    {
      key: "upper",
      label: "Upper",
      patterns: [...PUSH_PATTERNS, ...PULL_PATTERNS],
      muscles: [...UPPER_PUSH_MUSCLES, ...UPPER_PULL_MUSCLES],
    },
    {
      key: "lower",
      label: "Lower",
      patterns: [...LEG_PATTERNS, ...CORE_PATTERNS, "carry"],
      muscles: [...LOWER_MUSCLES, ...CORE_MUSCLES],
    },
  ],

  push_pull_legs: [
    {
      key: "push",
      label: "Push",
      patterns: PUSH_PATTERNS,
      muscles: UPPER_PUSH_MUSCLES,
    },
    {
      key: "pull",
      label: "Pull",
      patterns: PULL_PATTERNS,
      muscles: UPPER_PULL_MUSCLES,
    },
    {
      key: "legs",
      label: "Legs",
      patterns: [...LEG_PATTERNS, ...CORE_PATTERNS],
      muscles: [...LOWER_MUSCLES, ...CORE_MUSCLES],
    },
  ],

  push_pull: [
    {
      key: "push",
      label: "Push",
      patterns: [...PUSH_PATTERNS, "squat", "lunge", "isolation_lower"],
      muscles: [...UPPER_PUSH_MUSCLES, "quads", "calves"],
    },
    {
      key: "pull",
      label: "Pull",
      patterns: [...PULL_PATTERNS, "hinge", ...CORE_PATTERNS],
      muscles: [...UPPER_PULL_MUSCLES, "hamstrings", "glutes", "lower_back", ...CORE_MUSCLES],
    },
  ],

  upper_lower_full: [
    {
      key: "upper",
      label: "Upper",
      patterns: [...PUSH_PATTERNS, ...PULL_PATTERNS],
      muscles: [...UPPER_PUSH_MUSCLES, ...UPPER_PULL_MUSCLES],
    },
    {
      key: "lower",
      label: "Lower",
      patterns: [...LEG_PATTERNS, ...CORE_PATTERNS],
      muscles: [...LOWER_MUSCLES, ...CORE_MUSCLES],
    },
    FULL_BODY_DAY,
  ],

  body_part: [
    { key: "chest_tri", label: "Chest & Triceps", patterns: [...PUSH_PATTERNS], muscles: ["chest", "triceps", "front_delts"] },
    { key: "back_bi", label: "Back & Biceps", patterns: [...PULL_PATTERNS], muscles: ["lats", "upper_back", "biceps", "rear_delts", "traps"] },
    { key: "legs", label: "Legs", patterns: LEG_PATTERNS, muscles: LOWER_MUSCLES },
    { key: "delts_core", label: "Shoulders & Core", patterns: ["vertical_push", "isolation_upper", ...CORE_PATTERNS], muscles: ["side_delts", "front_delts", "rear_delts", ...CORE_MUSCLES] },
  ],

  hybrid_conditioning: [
    {
      key: "strength",
      label: "Strength",
      patterns: [...LEG_PATTERNS, ...PUSH_PATTERNS, ...PULL_PATTERNS],
      muscles: [...LOWER_MUSCLES, ...UPPER_PUSH_MUSCLES, ...UPPER_PULL_MUSCLES],
    },
    {
      key: "conditioning",
      label: "Conditioning",
      patterns: ["conditioning", "carry", ...CORE_PATTERNS],
      muscles: [...CORE_MUSCLES, "quads", "glutes"],
    },
  ],
};

/**
 * The rolling sequence of day types.
 *
 * Continues across week boundaries rather than restarting, which is what makes
 * a three-day cycle work on a four-day week.
 */
export function buildRotation(
  split: SplitType,
  daysPerWeek: number,
  weeks: number,
): SplitDay[][] {
  const cycle = SPLIT_DEFINITIONS[split];
  const result: SplitDay[][] = [];
  let index = 0;

  for (let week = 0; week < weeks; week++) {
    const days: SplitDay[] = [];
    for (let day = 0; day < daysPerWeek; day++) {
      days.push(cycle[index % cycle.length]);
      index++;
    }
    result.push(days);
  }
  return result;
}

/**
 * How often a day type comes round per week, averaged over the rotation.
 *
 * Fractional on purpose: a three-day cycle on a four-day week gives each day
 * type 1.33 sessions per week. Rounding that down to 1 is what caused
 * per-session volume to be overstated.
 */
export function dayFrequencyPerWeek(split: SplitType, daysPerWeek: number): number {
  const cycle = SPLIT_DEFINITIONS[split];
  return daysPerWeek / cycle.length;
}

/** How often a given movement pattern is trained per week under a split. */
export function patternFrequencyPerWeek(
  split: SplitType,
  pattern: MovementPattern,
  daysPerWeek: number,
): number {
  const cycle = SPLIT_DEFINITIONS[split];
  const matching = cycle.filter((day) => day.patterns.includes(pattern)).length;
  return (daysPerWeek * matching) / cycle.length;
}

/** How often a given muscle is trained per week under a split. */
export function muscleFrequencyPerWeek(
  split: SplitType,
  muscle: MuscleGroup,
  daysPerWeek: number,
): number {
  const cycle = SPLIT_DEFINITIONS[split];
  const matching = cycle.filter((day) => day.muscles.includes(muscle)).length;
  return (daysPerWeek * matching) / cycle.length;
}

/**
 * Whether a split divides evenly into the week.
 *
 * A rolling schedule is perfectly workable, but it means the week-to-week layout
 * differs, which is worth telling the user rather than silently producing an
 * uneven plan.
 */
export function isRollingSchedule(split: SplitType, daysPerWeek: number): boolean {
  return daysPerWeek % SPLIT_DEFINITIONS[split].length !== 0;
}

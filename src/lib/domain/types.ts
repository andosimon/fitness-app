/**
 * Core domain vocabulary for the training engine.
 *
 * These are deliberately kept free of any database or framework imports so the
 * programming engine can be unit-tested in isolation. `src/lib/db/schema.ts`
 * imports from here, never the reverse.
 */

// ---------------------------------------------------------------------------
// Movement patterns
// ---------------------------------------------------------------------------

/**
 * Programming works in movement patterns rather than muscles, because a
 * balanced session is built from patterns (push/pull/hinge/squat) while volume
 * is *accounted for* in muscles. The engine needs both views.
 */
export const MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "carry",
  "core_anti_extension",
  "core_anti_rotation",
  "core_flexion",
  "core_lateral_flexion",
  "isolation_upper",
  "isolation_lower",
  "olympic",
  "conditioning",
  "mobility",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/** Patterns that must appear across a well-formed training week. */
export const FOUNDATIONAL_PATTERNS: MovementPattern[] = [
  "squat",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
];

// ---------------------------------------------------------------------------
// Muscle groups
// ---------------------------------------------------------------------------

export const MUSCLE_GROUPS = [
  "quads",
  "hamstrings",
  "glutes",
  "adductors",
  "abductors",
  "calves",
  "chest",
  "lats",
  "upper_back",
  "traps",
  "lower_back",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "neck",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/**
 * Equipment is the hard filter that makes "travel mode" work. An exercise is
 * only selectable when the active equipment profile is a superset of the
 * exercise's `requiredEquipment`.
 */
export const EQUIPMENT = [
  // Free weights
  "barbell",
  "ez_bar",
  "trap_bar",
  "dumbbell",
  "kettlebell",
  "weight_plate",
  "med_ball",
  "slam_ball",
  "sandbag",
  // Machines & cables
  "cable_machine",
  "lat_pulldown",
  "leg_press",
  "leg_curl_machine",
  "leg_extension_machine",
  "chest_press_machine",
  "row_machine_seated",
  "pec_deck",
  "smith_machine",
  "hack_squat",
  "glute_ham_raise",
  "back_extension_bench",
  "preacher_curl_bench",
  "calf_raise_machine",
  "assisted_pullup_machine",
  // Racks, benches, bars
  "squat_rack",
  "power_rack",
  "bench_flat",
  "bench_adjustable",
  "pullup_bar",
  "dip_bars",
  "gymnastic_rings",
  "landmine",
  "preacher_pad",
  "box_plyo",
  // Portable / travel-friendly
  "resistance_band_long",
  "mini_band",
  "suspension_trainer",
  "ab_wheel",
  "jump_rope",
  "weight_vest",
  "dip_belt",
  "ankle_straps",
  // Conditioning machines
  "treadmill",
  "stationary_bike",
  "air_bike",
  "rower",
  "ski_erg",
  "elliptical",
  "stair_climber",
  "sled",
  "battle_ropes",
  // Baseline
  "bodyweight",
  "wall",
  "bench_or_chair",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Always available, so exercises requiring only these are never filtered out. */
export const UNIVERSAL_EQUIPMENT: Equipment[] = ["bodyweight"];

/** Preset profiles seeded for a new user; the travel ones matter most. */
export const EQUIPMENT_PRESETS = {
  bodyweight_only: ["bodyweight", "wall", "bench_or_chair"],
  hotel_room: ["bodyweight", "wall", "bench_or_chair", "resistance_band_long", "mini_band"],
  hotel_gym: [
    "bodyweight",
    "wall",
    "bench_or_chair",
    "dumbbell",
    "bench_adjustable",
    "treadmill",
    "stationary_bike",
    "cable_machine",
  ],
  home_gym: [
    "bodyweight",
    "wall",
    "bench_or_chair",
    "barbell",
    "weight_plate",
    "squat_rack",
    "bench_adjustable",
    "dumbbell",
    "kettlebell",
    "pullup_bar",
    "resistance_band_long",
  ],
  commercial_gym: [...EQUIPMENT] as Equipment[],
} satisfies Record<string, Equipment[]>;

export type EquipmentPresetKey = keyof typeof EQUIPMENT_PRESETS;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Determines which input fields the logger shows and how load progresses.
 * A plank progresses in seconds; a barbell squat progresses in kilos.
 */
export const LOAD_TYPES = [
  "barbell",            // bar + plates; progresses in plate increments
  "dumbbell_pair",      // load recorded per dumbbell
  "dumbbell_single",
  "kettlebell",
  "machine_load",       // pin/plate stack
  "cable_load",
  "bodyweight",         // reps only
  "bodyweight_loaded",  // bodyweight + external load (weighted dips/pull-ups)
  "bodyweight_assisted",// bodyweight - assistance
  "band",               // band tension, not a precise load
  "time",               // planks, carries, holds
  "distance",           // carries, runs
  "calories",           // ergometers
  "reps_only",
] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

/** Load types where a numeric weight is meaningful for e1RM tracking. */
export const LOADABLE_TYPES: LoadType[] = [
  "barbell",
  "dumbbell_pair",
  "dumbbell_single",
  "kettlebell",
  "machine_load",
  "cable_load",
  "bodyweight_loaded",
];

// ---------------------------------------------------------------------------
// Goals & experience
// ---------------------------------------------------------------------------

export const GOALS = ["hypertrophy", "strength", "fat_loss", "endurance", "general"] as const;
export type Goal = (typeof GOALS)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/**
 * Goals are weighted rather than exclusive, because "build muscle while
 * leaning out" is the common real request. Weights sum to 1.
 */
export type GoalWeights = Partial<Record<Goal, number>>;

// ---------------------------------------------------------------------------
// Sessions & splits
// ---------------------------------------------------------------------------

export const SESSION_TYPES = [
  "strength",
  "hypertrophy",
  "conditioning",
  "cardio",
  "mobility",
  "rest",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SPLIT_TYPES = [
  "full_body",
  "upper_lower",
  "push_pull_legs",
  "push_pull",
  "upper_lower_full",
  "body_part",
  "hybrid_conditioning",
] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const CARDIO_MODALITIES = [
  "run_outdoor",
  "run_treadmill",
  "cycle_outdoor",
  "cycle_stationary",
  "row",
  "ski_erg",
  "air_bike",
  "swim",
  "walk",
  "hike",
  "elliptical",
  "stair_climber",
  "jump_rope",
  "circuit",
  "other",
] as const;
export type CardioModality = (typeof CARDIO_MODALITIES)[number];

/** Structure of a conditioning block, which drives how it is rendered and logged. */
export const CONDITIONING_FORMATS = [
  "steady_state",
  "intervals",
  "emom",
  "amrap",
  "for_time",
  "tabata",
  "circuit",
  "finisher",
] as const;
export type ConditioningFormat = (typeof CONDITIONING_FORMATS)[number];

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const UNITS = ["kg", "lb"] as const;
export type Unit = (typeof UNITS)[number];

/**
 * All weights are persisted in kilograms and converted at the display boundary.
 * Mixing units in storage is the classic source of corrupted training logs.
 */
export const KG_PER_LB = 0.45359237;

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

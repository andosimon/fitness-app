import type {
  Equipment,
  LoadType,
  MovementPattern,
  MuscleGroup,
} from "@/lib/domain/types";

import type { SplitDay } from "./splits";
import { PER_SESSION_SET_CEILING } from "./volume";

/**
 * Exercise selection.
 *
 * ## Variety versus progression
 *
 * These pull in opposite directions. Progressive overload needs the same lift
 * week after week — you cannot add five kilos to something you did once. But a
 * programme that never changes goes stale, and the app becomes a spreadsheet you
 * stop opening.
 *
 * The resolution used here is to treat exercises as having different jobs:
 *
 * - **Anchors** are the main compound of each pattern. They are *fixed within a
 *   block* so load can be progressed and tracked, and rotated *between* blocks
 *   so a squat cycle might run back squats, then front squats, then pause
 *   squats.
 * - **Secondary** compounds change less often than accessories but are not
 *   sacred.
 * - **Accessories** rotate freely. Nobody is tracking a five-kilo PR on a lateral
 *   raise, so variety costs nothing there and keeps sessions interesting.
 *
 * Selection is deterministic given its inputs: the same programme regenerates
 * identically, which is a promise the whole engine makes. Variety comes from
 * the block index and day variant feeding a seeded shuffle, not from randomness.
 */

export type SelectableExercise = {
  id: string;
  slug: string;
  name: string;
  movementPattern: MovementPattern;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  requiredEquipment: Equipment[];
  loadType: LoadType;
  isCompound: boolean;
  isUnilateral: boolean;
  complexity: number;
  stimulusFatigueRatio: number;
  defaultRepMin: number;
  defaultRepMax: number;
  substitutionGroup: string | null;
};

export type ExerciseRole = "anchor" | "secondary" | "accessory";

export type SelectedExercise = {
  exercise: SelectableExercise;
  sets: number;
  role: ExerciseRole;
  /** Exercises sharing a value are performed as a superset. */
  supersetGroup?: string;
};

export type SelectedSession = {
  exercises: SelectedExercise[];
  totalSets: number;
  /** Sets delivered per muscle, for checking the plan against its targets. */
  deliveredSets: Partial<Record<MuscleGroup, number>>;
  /** Targets that could not be met with the available equipment and time. */
  shortfalls: { muscle: MuscleGroup; target: number; delivered: number }[];
};

export type SelectionContext = {
  availableEquipment: Equipment[];
  excludedExerciseIds?: string[];
  /** Mesocycle number. Rotates anchors between blocks. */
  blockIndex: number;
  /** Which occurrence of this day type within the week, 0-based. */
  dayVariantIndex: number;
  /** Distinguishes programmes so two do not select identically. */
  seed?: string;
};

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** FNV-1a. Small, fast, and good enough to spread seeds across the range. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Picks an item deterministically from a ranked shortlist.
 *
 * Not `Math.random`: regenerating a programme must produce the same result, or
 * the reproducibility the engine promises is a lie. Variety instead comes from
 * varying the key — block index, day variant, pattern.
 */
function pickDeterministic<T>(candidates: T[], key: string): T | undefined {
  if (candidates.length === 0) return undefined;
  return candidates[hashString(key) % candidates.length];
}

// ---------------------------------------------------------------------------
// Antagonist pairing
// ---------------------------------------------------------------------------

/**
 * Muscles that superset well together.
 *
 * Pairing must not share a muscle: supersetting two chest movements does not
 * save time, it just makes the second one worse. Antagonists work because each
 * rests while the other is trained.
 */
const ANTAGONISTS: Partial<Record<MuscleGroup, MuscleGroup[]>> = {
  chest: ["lats", "upper_back", "rear_delts"],
  lats: ["chest", "front_delts"],
  upper_back: ["chest", "front_delts"],
  rear_delts: ["chest", "front_delts"],
  front_delts: ["lats", "upper_back", "rear_delts"],
  biceps: ["triceps"],
  triceps: ["biceps"],
  quads: ["hamstrings"],
  hamstrings: ["quads"],
  glutes: ["quads"],
  abs: ["lower_back"],
  lower_back: ["abs"],
  side_delts: ["biceps", "triceps"],
  calves: ["abs", "obliques"],
};

function isAntagonistPair(a: SelectableExercise, b: SelectableExercise): boolean {
  const aMuscles = new Set([...a.primaryMuscles, ...a.secondaryMuscles]);
  const bMuscles = new Set([...b.primaryMuscles, ...b.secondaryMuscles]);

  // Any shared muscle disqualifies the pairing.
  for (const muscle of aMuscles) if (bMuscles.has(muscle)) return false;

  return a.primaryMuscles.some((m) => (ANTAGONISTS[m] ?? []).some((x) => bMuscles.has(x)));
}

// ---------------------------------------------------------------------------
// Filtering and ranking
// ---------------------------------------------------------------------------

/** Every required item must be available. This is the hard travel-mode filter. */
export function isPerformable(
  exercise: SelectableExercise,
  availableEquipment: Equipment[],
): boolean {
  return exercise.requiredEquipment.every((item) => availableEquipment.includes(item));
}

/**
 * Suitability of an exercise as the anchor for a pattern.
 *
 * Deliberately does *not* reward stimulus-to-fatigue. That is an accessory
 * criterion: an anchor is the lift you go heavy on and try to add weight to, so
 * being fatiguing is the cost of doing its job. An earlier version weighted SFR
 * here and consequently chose hip thrusts over deadlifts to anchor the hinge,
 * because the deadlift is correctly tagged as high-fatigue.
 *
 * The strongest available signal for "this is a heavy lift" is its rep range:
 * a movement whose sensible range starts at 1-3 reps is a strength lift, one
 * starting at 12 is not.
 */
function anchorScore(exercise: SelectableExercise): number {
  const loadBonus =
    exercise.loadType === "barbell"
      ? 25
      : exercise.loadType === "dumbbell_pair" || exercise.loadType === "machine_load"
        ? 12
        : exercise.loadType === "bodyweight_loaded"
          ? 8
          : 0;

  return (
    (exercise.isCompound ? 40 : 0) +
    loadBonus +
    // Lower rep ranges indicate a lift built for heavy loading.
    Math.max(0, 12 - exercise.defaultRepMin) * 2 +
    (exercise.isUnilateral ? 0 : 10) -
    // Only genuinely technical lifts are penalised; an advanced lifter can
    // anchor a deadlift at complexity 4 perfectly well.
    (exercise.complexity >= 5 ? 15 : 0)
  );
}

/** Suitability as accessory work: stimulus per unit of fatigue, kept simple. */
function accessoryScore(exercise: SelectableExercise): number {
  return exercise.stimulusFatigueRatio * 10 - exercise.complexity * 3;
}

/**
 * Whether an exercise is reasonable as accessory filler.
 *
 * Excludes the heavy, systemically expensive compounds. A conventional deadlift
 * is a superb lift and a terrible accessory: putting three sets of it after the
 * main work costs more recovery than the volume is worth. If a lift is worth
 * doing it should be anchoring the session, not filling it.
 */
function isSuitableAccessory(exercise: SelectableExercise): boolean {
  if (exercise.defaultRepMin <= 3) return false;
  if (exercise.isCompound && exercise.stimulusFatigueRatio <= 2) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Movement families, used to keep a session's anchors balanced.
 *
 * Without this, an upper day's foundational patterns are listed push-first and
 * a naive "take the first two" yields two presses and no pull — a push-only
 * upper day, which is exactly the imbalance a split is supposed to prevent.
 */
const PATTERN_FAMILY: Partial<Record<MovementPattern, string>> = {
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  squat: "knee",
  lunge: "knee",
  hinge: "hip",
};

/**
 * Chooses which patterns a session anchors, one per movement family.
 *
 * `variant` rotates the choice so a repeated day type leads with a different
 * lift — Upper A opening on a horizontal press, Upper B on a vertical one.
 */
export function chooseAnchorPatterns(
  dayPatterns: MovementPattern[],
  foundational: MovementPattern[],
  variant: number,
  count = 2,
): MovementPattern[] {
  const available = foundational.filter((p) => dayPatterns.includes(p));

  const families = new Map<string, MovementPattern[]>();
  for (const pattern of available) {
    const family = PATTERN_FAMILY[pattern] ?? pattern;
    families.set(family, [...(families.get(family) ?? []), pattern]);
  }

  const picked: MovementPattern[] = [];
  for (const [, patterns] of families) {
    // Rotate within the family so repeat days differ.
    picked.push(patterns[variant % patterns.length]);
  }

  // Rotate across families too, so which family leads also varies.
  const offset = variant % Math.max(1, picked.length);
  const rotated = [...picked.slice(offset), ...picked.slice(0, offset)];
  return rotated.slice(0, count);
}

export type SessionSelectionInput = {
  day: SplitDay;
  /** Sets to deliver per muscle in this session. */
  muscleTargets: Partial<Record<MuscleGroup, number>>;
  /** Total working sets the session's time budget allows. */
  setBudget: number;
  /** Patterns to anchor, most important first. */
  anchorPatterns: MovementPattern[];
  /** Sets for each anchor. */
  setsPerAnchor: number;
  library: SelectableExercise[];
  context: SelectionContext;
};

export function selectSessionExercises(input: SessionSelectionInput): SelectedSession {
  const { day, muscleTargets, setBudget, anchorPatterns, setsPerAnchor, library, context } = input;

  const excluded = new Set(context.excludedExerciseIds ?? []);
  const performable = library.filter(
    (e) => !excluded.has(e.id) && isPerformable(e, context.availableEquipment),
  );

  const chosen: SelectedExercise[] = [];
  const usedIds = new Set<string>();
  const usedGroups = new Set<string>();
  const delivered: Partial<Record<MuscleGroup, number>> = {};

  const credit = (exercise: SelectableExercise, sets: number) => {
    for (const muscle of exercise.primaryMuscles) {
      delivered[muscle] = (delivered[muscle] ?? 0) + sets;
    }
    // Secondary involvement counts at half. A row trains biceps, but not as
    // much as a curl does, and crediting it fully would understate arm volume.
    for (const muscle of exercise.secondaryMuscles) {
      delivered[muscle] = (delivered[muscle] ?? 0) + sets * 0.5;
    }
  };

  let remaining = setBudget;

  // --- Anchors -------------------------------------------------------------
  for (const pattern of anchorPatterns) {
    if (remaining < setsPerAnchor) break;

    const candidates = performable
      .filter((e) => e.movementPattern === pattern && !usedIds.has(e.id))
      .sort((a, b) => anchorScore(b) - anchorScore(a));
    if (candidates.length === 0) continue;

    /**
     * Shortlist the genuinely good options, then rotate among them by block.
     * Taking only the top-scoring exercise would give the same anchor forever;
     * shortlisting keeps the choice defensible while allowing a squat cycle to
     * move from back squat to front squat to pause squat across blocks.
     */
    const shortlist = candidates.slice(0, Math.min(3, candidates.length));
    /**
     * Keyed on the day variant as well as the block.
     *
     * Stability that matters is *per variant*: Lower A always opens on the same
     * lift week after week, so its load can be progressed, but Lower B opens on
     * a different one. Keying on the block alone made both lower days pick the
     * same squat and the same deadlift, so the two sessions were near-identical.
     */
    const key = `${context.seed ?? ""}|anchor|${pattern}|${context.blockIndex}|${context.dayVariantIndex}`;
    const picked = pickDeterministic(shortlist, key)!;

    chosen.push({ exercise: picked, sets: setsPerAnchor, role: "anchor" });
    usedIds.add(picked.id);
    if (picked.substitutionGroup) usedGroups.add(picked.substitutionGroup);
    credit(picked, setsPerAnchor);
    remaining -= setsPerAnchor;
  }

  // --- Accessories ---------------------------------------------------------
  // Repeatedly serve whichever muscle is furthest from its target, so volume
  // lands where the plan asked rather than wherever the ranking happens to point.
  const dayMuscles = new Set(day.muscles);

  /**
   * Targets are a floor, not a cap.
   *
   * Weekly volume is shared across all muscles, but a split does not divide it
   * evenly between day types: an upper day covers ten muscles and a lower day
   * covers fewer with smaller targets. Serving only the stated targets left
   * lower sessions using 13 of 25 available sets — half the session unspent
   * while the lifter is standing in the gym with time on the clock.
   *
   * So once every target is met, remaining budget tops muscles up toward a
   * ceiling rather than being discarded.
   */
  const TOP_UP_MULTIPLIER = 1.6;

  let allowOverfill = false;

  while (remaining >= 2) {
    const ceilingFor = (target: number) =>
      allowOverfill
        ? Math.min(target * TOP_UP_MULTIPLIER, PER_SESSION_SET_CEILING)
        : target;

    const deficits = (Object.entries(muscleTargets) as [MuscleGroup, number][])
      .filter(([muscle]) => dayMuscles.has(muscle))
      .map(([muscle, target]) => ({
        muscle,
        deficit: ceilingFor(target) - (delivered[muscle] ?? 0),
      }))
      .filter((d) => d.deficit > 0.5)
      .sort((a, b) => b.deficit - a.deficit);

    if (deficits.length === 0) {
      // Every stated target met and budget still left: raise the ceiling once
      // and keep going, rather than ending the session early.
      if (!allowOverfill) {
        allowOverfill = true;
        continue;
      }
      break;
    }

    let progressed = false;
    for (const { muscle, deficit } of deficits) {
      const candidates = performable
        .filter(
          (e) =>
            !usedIds.has(e.id) &&
            isSuitableAccessory(e) &&
            e.primaryMuscles.includes(muscle) &&
            day.patterns.includes(e.movementPattern) &&
            // One exercise per substitution group: two near-identical movements
            // in one session is redundancy, not volume.
            (!e.substitutionGroup || !usedGroups.has(e.substitutionGroup)),
        )
        .sort((a, b) => accessoryScore(b) - accessoryScore(a));

      if (candidates.length === 0) continue;

      const shortlist = candidates.slice(0, Math.min(4, candidates.length));
      // Accessories rotate per day variant too, so Lower A and Lower B differ.
      const key = `${context.seed ?? ""}|acc|${muscle}|${context.blockIndex}|${context.dayVariantIndex}|${chosen.length}`;
      const picked = pickDeterministic(shortlist, key)!;

      // Match the prescription to what is actually owed. Always assigning three
      // sets overshoots small deficits, which is how forearms end up with a
      // full slot while chest is still short.
      const sets = Math.min(deficit >= 3 ? 3 : 2, remaining);

      chosen.push({ exercise: picked, sets, role: "accessory" });
      usedIds.add(picked.id);
      if (picked.substitutionGroup) usedGroups.add(picked.substitutionGroup);
      credit(picked, sets);
      remaining -= sets;
      progressed = true;
      break;
    }

    if (!progressed) {
      // Nothing in the library can serve any remaining deficit at this ceiling.
      // Try once with the ceiling raised, then stop rather than spin.
      if (!allowOverfill) {
        allowOverfill = true;
        continue;
      }
      break;
    }
  }

  pairAntagonists(chosen);

  const shortfalls = (Object.entries(muscleTargets) as [MuscleGroup, number][])
    .filter(([muscle]) => dayMuscles.has(muscle))
    .map(([muscle, target]) => ({
      muscle,
      target,
      delivered: Math.round((delivered[muscle] ?? 0) * 10) / 10,
    }))
    .filter((s) => s.delivered + 0.5 < s.target);

  return {
    exercises: chosen,
    totalSets: chosen.reduce((sum, e) => sum + e.sets, 0),
    deliveredSets: delivered,
    shortfalls,
  };
}

/**
 * Groups accessories into antagonist supersets, in place.
 *
 * Anchors are deliberately left alone: pairing something off a heavy top set
 * compromises it, and the whole point of the anchor is that it is the lift you
 * are trying to progress.
 */
function pairAntagonists(chosen: SelectedExercise[]): void {
  const accessories = chosen.filter((e) => e.role === "accessory");
  const paired = new Set<string>();
  let group = 0;

  for (let i = 0; i < accessories.length; i++) {
    const a = accessories[i];
    if (paired.has(a.exercise.id)) continue;

    for (let j = i + 1; j < accessories.length; j++) {
      const b = accessories[j];
      if (paired.has(b.exercise.id)) continue;
      if (!isAntagonistPair(a.exercise, b.exercise)) continue;

      const label = `ss${++group}`;
      a.supersetGroup = label;
      b.supersetGroup = label;
      paired.add(a.exercise.id);
      paired.add(b.exercise.id);
      break;
    }
  }
}

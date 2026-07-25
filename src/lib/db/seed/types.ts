import type {
  Equipment,
  LoadType,
  MovementPattern,
  MuscleGroup,
} from "@/lib/domain/types";

/**
 * Authoring format for the exercise library.
 *
 * Short keys and optional fields with sensible defaults, because the library is
 * hand-curated and hundreds of entries long — verbose keys would make errors
 * harder to spot, and the tags are what the engine depends on being correct.
 *
 * The mapping to database rows lives in `seed/index.ts`.
 */
export type ExerciseSeed = {
  slug: string;
  name: string;
  /** Alternate names, so search finds "RDL" as well as "Romanian deadlift". */
  aliases?: string[];

  pattern: MovementPattern;
  primary: MuscleGroup[];
  secondary?: MuscleGroup[];

  /**
   * EVERY item here must be present in the active equipment profile for this
   * exercise to be selectable. Getting this wrong is precisely what would break
   * travel mode, so err toward listing what you genuinely cannot do without.
   */
  equipment: Equipment[];
  /** Helps but is not required — a rack for squats, a belt for weighted dips. */
  optional?: Equipment[];

  load: LoadType;

  unilateral?: boolean;
  compound?: boolean;

  /** 1 = trivial to learn, 5 = high skill. Default 2. */
  complexity?: number;
  /**
   * Stimulus-to-fatigue ratio, 1-5. Higher means more training effect per unit
   * of systemic fatigue, so the selector prefers these when time is tight.
   * Deadlifts rate low here despite being excellent lifts. Default 3.
   */
  sfr?: number;

  /** Sensible rep range for this movement. Default [6, 12]. */
  reps?: [number, number];

  /**
   * Interchangeable exercises share a group, which is how travel-mode swaps
   * stay sensible: the engine substitutes within the group to keep hitting the
   * same pattern and muscles under different equipment constraints.
   */
  sub: string;

  setup?: string;
  cues?: string;
};

export const SEED_DEFAULTS = {
  complexity: 2,
  sfr: 3,
  reps: [6, 12] as [number, number],
} as const;

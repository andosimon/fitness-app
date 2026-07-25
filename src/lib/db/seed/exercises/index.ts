import type { ExerciseSeed } from "../types";
import { CORE_CONDITIONING } from "./core-conditioning";
import { ISOLATION } from "./isolation";
import { LOWER_BODY } from "./lower-body";
import { HORIZONTAL_PUSH, VERTICAL_PUSH } from "./upper-push";
import { HORIZONTAL_PULL, VERTICAL_PULL } from "./upper-pull";

/**
 * The complete curated exercise library.
 *
 * Curated by hand rather than bulk-imported, because the engine's output is only
 * as good as these tags: a wrong `equipment` entry silently produces a workout
 * the user cannot perform, and a wrong `pattern` quietly unbalances a program.
 */
export const ALL_EXERCISE_SEEDS: ExerciseSeed[] = [
  ...LOWER_BODY,
  ...HORIZONTAL_PUSH,
  ...VERTICAL_PUSH,
  ...HORIZONTAL_PULL,
  ...VERTICAL_PULL,
  ...ISOLATION,
  ...CORE_CONDITIONING,
];

export {
  CORE_CONDITIONING,
  HORIZONTAL_PULL,
  HORIZONTAL_PUSH,
  ISOLATION,
  LOWER_BODY,
  VERTICAL_PULL,
  VERTICAL_PUSH,
};

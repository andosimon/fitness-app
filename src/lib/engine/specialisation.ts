import type { MovementPattern, MuscleGroup, SplitType } from "@/lib/domain/types";

import { isRollingSchedule, patternFrequencyPerWeek } from "./splits";
import { PER_SESSION_SET_CEILING } from "./volume";

/**
 * Bringing up a specific lift.
 *
 * The central constraint: how often you can train a lift is decided by the
 * split, not by wanting it. A full-body programme can squat three times a week
 * because every session covers every pattern. A rolling push/pull/legs on four
 * days reaches the squat about 1.3 times a week and no amount of intent changes
 * that.
 *
 * So specialisation takes two different forms. Where frequency is available, it
 * adds sessions and varies the stimulus across them. Where it is not, it
 * concentrates within the one session that trains the pattern: more working
 * sets, back-off work after the top set, pauses and tempo to extract more from
 * the same load, and accessories aimed at the lift's limiting factors.
 */

export type SpecialisationTechnique =
  | "added_frequency"
  | "heavy_light_variation"
  | "back_off_sets"
  | "pause_reps"
  | "tempo_work"
  | "concentrated_volume";

/** Muscles that limit each pattern, and so deserve accessory attention. */
export const PATTERN_SUPPORT: Partial<Record<MovementPattern, MuscleGroup[]>> = {
  squat: ["quads", "glutes", "hamstrings", "lower_back", "abs", "adductors"],
  hinge: ["hamstrings", "glutes", "lower_back", "upper_back", "traps", "forearms"],
  horizontal_push: ["chest", "triceps", "front_delts", "upper_back"],
  vertical_push: ["front_delts", "triceps", "side_delts", "upper_back", "abs"],
  horizontal_pull: ["lats", "upper_back", "rear_delts", "biceps", "forearms"],
  vertical_pull: ["lats", "biceps", "upper_back", "forearms", "abs"],
  lunge: ["quads", "glutes", "hamstrings", "adductors"],
};

export type LiftSpecialisationPlan = {
  pattern: MovementPattern;
  /** Sessions per week that train this pattern. Fractional on rolling splits. */
  frequencyPerWeek: number;
  /** Working sets of the lift and its close variants, per training session. */
  setsPerSession: number;
  /** Delivered weekly sets, frequency times per-session. */
  weeklySets: number;
  techniques: SpecialisationTechnique[];
  /** Muscles to bias accessory selection toward. */
  supportingMuscles: MuscleGroup[];
  /** True when the split rolls, so week-to-week layout differs. */
  rolling: boolean;
  /** Plain-language explanation, shown in the UI and given to the coach. */
  rationale: string;
};

/**
 * Frequency at or above this means the lift can be trained across multiple
 * sessions with genuinely different intent — a heavy day and a volume day.
 * Below it, there is effectively one session to work with.
 */
const MULTI_SESSION_THRESHOLD = 1.75;

export type LiftSpecialisationInput = {
  pattern: MovementPattern;
  split: SplitType;
  daysPerWeek: number;
  /** Weekly sets available for this pattern, from the volume plan. */
  weeklySetsForPattern: number;
};

export function planLiftSpecialisation(
  input: LiftSpecialisationInput,
): LiftSpecialisationPlan {
  const { pattern, split, daysPerWeek, weeklySetsForPattern } = input;

  const frequencyPerWeek = patternFrequencyPerWeek(split, pattern, daysPerWeek);
  const rolling = isRollingSchedule(split, daysPerWeek);
  const supportingMuscles = PATTERN_SUPPORT[pattern] ?? [];

  if (frequencyPerWeek === 0) {
    return {
      pattern,
      frequencyPerWeek: 0,
      setsPerSession: 0,
      weeklySets: 0,
      techniques: [],
      supportingMuscles,
      rolling,
      rationale: `This split never trains ${humanise(pattern)}, so it cannot be specialised. Choose a split that includes it.`,
    };
  }

  const idealPerSession = weeklySetsForPattern / frequencyPerWeek;
  const setsPerSession = Math.max(1, Math.min(Math.round(idealPerSession), PER_SESSION_SET_CEILING));
  const weeklySets = Math.round(setsPerSession * frequencyPerWeek);

  const multiSession = frequencyPerWeek >= MULTI_SESSION_THRESHOLD;

  const techniques: SpecialisationTechnique[] = multiSession
    ? ["added_frequency", "heavy_light_variation", "back_off_sets"]
    : // One session to work with, so the stimulus has to come from within it.
      ["concentrated_volume", "back_off_sets", "pause_reps", "tempo_work"];

  const accessories = supportingMuscles.slice(0, 3).join(", ");

  // Wording has to track the actual frequency: describing four sessions as
  // "one heavy and one light" is simply wrong.
  const variationPhrase =
    frequencyPerWeek >= 3
      ? "alternating heavier and lighter sessions through the week"
      : "one heavier session and one at lighter load for volume";

  const rationale = multiSession
    ? `${capitalise(humanise(pattern))} is trained ${formatFrequency(frequencyPerWeek)} on this split, ` +
      `so the specialisation adds frequency: ${variationPhrase}, roughly ${setsPerSession} sets each time. ` +
      `Accessories favour ${accessories}.`
    : `This split reaches ${humanise(pattern)} only ${formatFrequency(frequencyPerWeek)}, ` +
      `so frequency cannot carry the specialisation. That session concentrates the work instead: ` +
      `${setsPerSession} sets built around a top set with back-offs, plus pause and tempo variations to ` +
      `add stimulus without adding load. Accessories favour ${accessories}.`;

  return {
    pattern,
    frequencyPerWeek,
    setsPerSession,
    weeklySets,
    techniques,
    supportingMuscles,
    rolling,
    rationale,
  };
}

/**
 * Ranks splits by how well each supports specialising a pattern.
 *
 * Useful at goal-setting time: if the stated goal is a bigger squat, it is worth
 * saying plainly that full body will get there faster than a rolling
 * push/pull/legs, rather than quietly generating the weaker programme.
 */
export function rankSplitsForPattern(
  pattern: MovementPattern,
  daysPerWeek: number,
  candidates: SplitType[] = ["full_body", "upper_lower", "push_pull_legs", "push_pull"],
): { split: SplitType; frequencyPerWeek: number; rolling: boolean }[] {
  return candidates
    .map((split) => ({
      split,
      frequencyPerWeek: patternFrequencyPerWeek(split, pattern, daysPerWeek),
      rolling: isRollingSchedule(split, daysPerWeek),
    }))
    .sort((a, b) => b.frequencyPerWeek - a.frequencyPerWeek);
}

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatFrequency(times: number): string {
  const rounded = Math.round(times * 10) / 10;
  if (Number.isInteger(rounded)) {
    return rounded === 1 ? "once a week" : `${rounded} times a week`;
  }
  return `about ${rounded} times a week`;
}

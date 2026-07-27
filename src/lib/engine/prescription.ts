import type { GoalWeights } from "@/lib/domain/types";

import type { LiftSpecialisationPlan } from "./specialisation";
import type { SelectedExercise, SelectedSession } from "./selection";
import { SET_COST } from "./time-budget";

/**
 * Turning selected exercises into an actual prescription.
 *
 * Two ideas drive everything here.
 *
 * **Intensity is expressed differently by goal.** Strength work is prescribed
 * against a percentage of maximum and an RPE, because the load is the point.
 * Hypertrophy work is prescribed in reps in reserve, because proximity to
 * failure is the point and the exact load is whatever achieves it. Giving an
 * experienced lifter a bare rep count and no intensity target is useless — three
 * sets of eight could be a warm-up or a near-death experience.
 *
 * **Effort ramps across a block.** A mesocycle starts with a set or two in
 * reserve and finishes close to failure, then deloads. Prescribing maximal
 * effort in week one leaves nowhere to progress and arrives at the end of the
 * block already fried.
 */

export type SetKindLabel = "working" | "top" | "back_off";

export type SetPrescription = {
  setNumber: number;
  kind: SetKindLabel;
  repMin: number;
  repMax: number;
  /** Reps in reserve. The primary cue for hypertrophy work. */
  targetRir: number | null;
  /** RPE. The primary cue for heavy strength work. */
  targetRpe: number | null;
  /** Percentage of estimated 1RM, when running true percentage work. */
  targetPercent1rm: number | null;
  restSeconds: number;
  tempo: string | null;
  note: string | null;
};

export type PrescribedExercise = {
  selected: SelectedExercise;
  sets: SetPrescription[];
  /** One-line summary for the session view, e.g. "4 x 3-5 @ RPE 8". */
  summary: string;
};

export type PrescribedSession = {
  exercises: PrescribedExercise[];
  weekInBlock: number;
  isDeload: boolean;
  /** Plain-language note explaining this week's intent. */
  weekNote: string;
};

export type PrescriptionInput = {
  selected: SelectedSession;
  goals: GoalWeights;
  /** 1-based week within the mesocycle. */
  weekInBlock: number;
  /** Total weeks including the deload. */
  blockLength: number;
  /** Present when this session's anchor is being specialised. */
  specialisation?: LiftSpecialisationPlan;
};

function strengthBias(goals: GoalWeights): number {
  const strength = goals.strength ?? 0;
  const hypertrophy = goals.hypertrophy ?? 0;
  const fatLoss = goals.fat_loss ?? 0;
  const total = strength + hypertrophy + fatLoss;
  return total === 0 ? 0.5 : strength / total;
}

/**
 * Reps in reserve for a given week.
 *
 * Ramps from two or three in reserve down to roughly one by the last working
 * week. Deload weeks sit well clear of failure — the point is to shed fatigue,
 * and a "light" week taken to RIR 1 is not a deload.
 */
function rirForWeek(weekInBlock: number, blockLength: number, isDeload: boolean): number {
  if (isDeload) return 4;
  const workingWeeks = Math.max(1, blockLength - 1);
  const progress = (weekInBlock - 1) / Math.max(1, workingWeeks - 1);
  return Math.round(3 - progress * 2); // 3 -> 1
}

/** Percentage of maximum for heavy work, rising across the block. */
function percentForWeek(weekInBlock: number, blockLength: number, isDeload: boolean): number {
  if (isDeload) return 60;
  const workingWeeks = Math.max(1, blockLength - 1);
  const progress = (weekInBlock - 1) / Math.max(1, workingWeeks - 1);
  return Math.round(78 + progress * 9); // 78% -> 87%
}

export function prescribeSession(input: PrescriptionInput): PrescribedSession {
  const { selected, goals, weekInBlock, blockLength, specialisation } = input;

  const isDeload = weekInBlock >= blockLength;
  const bias = strengthBias(goals);
  const rir = rirForWeek(weekInBlock, blockLength, isDeload);
  const percent = percentForWeek(weekInBlock, blockLength, isDeload);

  const exercises = selected.exercises.map((item) =>
    prescribeExercise(item, { bias, rir, percent, isDeload, specialisation }),
  );

  const weekNote = isDeload
    ? `Deload. Load around ${percent}% and stop well short of failure — this week exists to shed fatigue, not to add stimulus.`
    : `Week ${weekInBlock} of ${blockLength}. Working sets at about ${rir} rep${rir === 1 ? "" : "s"} in reserve.`;

  return { exercises, weekInBlock, isDeload, weekNote };
}

type ExerciseContext = {
  bias: number;
  rir: number;
  percent: number;
  isDeload: boolean;
  specialisation?: LiftSpecialisationPlan;
};

function prescribeExercise(
  item: SelectedExercise,
  ctx: ExerciseContext,
): PrescribedExercise {
  const { exercise, role } = item;

  // Deloads cut volume as well as intensity; halving the sets is what actually
  // sheds fatigue, since dropping load alone leaves the session just as long.
  const setCount = ctx.isDeload ? Math.max(1, Math.round(item.sets / 2)) : item.sets;

  const isAnchor = role === "anchor";
  const isStrengthAnchor = isAnchor && ctx.bias >= 0.4;

  const rest = isAnchor
    ? SET_COST.heavy_compound.restSeconds
    : role === "secondary"
      ? SET_COST.moderate_compound.restSeconds
      : SET_COST.isolation.restSeconds;

  const specialised =
    isAnchor &&
    ctx.specialisation !== undefined &&
    ctx.specialisation.pattern === exercise.movementPattern;

  const sets: SetPrescription[] = [];

  for (let i = 0; i < setCount; i++) {
    const setNumber = i + 1;

    if (isStrengthAnchor) {
      /**
       * Top set then back-offs, when the lift is being specialised and there is
       * room for it. A single heavy top set provides the strength stimulus; the
       * back-offs supply volume at a load that does not compound the fatigue.
       * This is also how a specialisation expresses itself when the split cannot
       * give the lift more frequency.
       */
      const useTopSet =
        specialised &&
        !ctx.isDeload &&
        (ctx.specialisation?.techniques.includes("back_off_sets") ?? false) &&
        setCount >= 3;

      if (useTopSet && setNumber === 1) {
        sets.push({
          setNumber,
          kind: "top",
          repMin: Math.max(1, exercise.defaultRepMin),
          repMax: Math.max(2, exercise.defaultRepMin + 1),
          targetRir: 1,
          targetRpe: 9,
          targetPercent1rm: ctx.percent + 3,
          restSeconds: rest,
          tempo: null,
          note: "Top set. One hard single-digit effort, leaving about a rep.",
        });
        continue;
      }

      const usePause =
        specialised &&
        !ctx.isDeload &&
        (ctx.specialisation?.techniques.includes("pause_reps") ?? false) &&
        setNumber === setCount;

      sets.push({
        setNumber,
        kind: useTopSet ? "back_off" : "working",
        repMin: exercise.defaultRepMin,
        repMax: Math.min(exercise.defaultRepMax, exercise.defaultRepMin + 3),
        targetRir: null,
        targetRpe: ctx.isDeload ? 6 : 8,
        targetPercent1rm: useTopSet ? ctx.percent - 8 : ctx.percent,
        restSeconds: rest,
        // Pauses add stimulus without adding load, which is the point when
        // frequency is capped and the joints are already taking a beating.
        tempo: usePause ? "2s pause in the hole" : null,
        note: useTopSet ? "Back-off set. Same bar speed, lighter load." : null,
      });
      continue;
    }

    // Hypertrophy and accessory work: proximity to failure is the cue.
    sets.push({
      setNumber,
      kind: "working",
      repMin: exercise.defaultRepMin,
      repMax: exercise.defaultRepMax,
      targetRir: ctx.rir,
      targetRpe: null,
      targetPercent1rm: null,
      restSeconds: rest,
      tempo: null,
      note: null,
    });
  }

  return { selected: { ...item, sets: setCount }, sets, summary: summarise(sets, exercise.name) };
}

function summarise(sets: SetPrescription[], _name: string): string {
  if (sets.length === 0) return "";

  const working = sets.filter((s) => s.kind !== "top");
  const top = sets.find((s) => s.kind === "top");

  const range = (s: SetPrescription) =>
    s.repMin === s.repMax ? `${s.repMin}` : `${s.repMin}-${s.repMax}`;

  const cue = (s: SetPrescription) =>
    s.targetRpe !== null
      ? `RPE ${s.targetRpe}${s.targetPercent1rm ? ` (~${s.targetPercent1rm}%)` : ""}`
      : s.targetRir !== null
        ? `RIR ${s.targetRir}`
        : "";

  if (top) {
    const backOff = working[0];
    return (
      `1 x ${range(top)} @ ${cue(top)}` +
      (backOff ? `, then ${working.length} x ${range(backOff)} @ ${cue(backOff)}` : "")
    );
  }

  const first = sets[0];
  return `${sets.length} x ${range(first)} @ ${cue(first)}`;
}

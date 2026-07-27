import { describe, expect, it } from "vitest";

import type { SelectableExercise, SelectedSession } from "./selection";
import { prescribeSession, type PrescribedSession } from "./prescription";
import { planLiftSpecialisation } from "./specialisation";

function ex(slug: string, overrides: Partial<SelectableExercise> = {}): SelectableExercise {
  return {
    id: slug,
    slug,
    name: slug,
    movementPattern: "squat",
    primaryMuscles: ["quads"],
    secondaryMuscles: [],
    requiredEquipment: ["barbell"],
    loadType: "barbell",
    isCompound: true,
    isUnilateral: false,
    complexity: 3,
    stimulusFatigueRatio: 3,
    defaultRepMin: 3,
    defaultRepMax: 8,
    substitutionGroup: "squat",
    ...overrides,
  };
}

const CURL = ex("curl", {
  movementPattern: "isolation_upper",
  primaryMuscles: ["biceps"],
  isCompound: false,
  loadType: "dumbbell_pair",
  defaultRepMin: 8,
  defaultRepMax: 15,
  substitutionGroup: "curl",
});

const SESSION: SelectedSession = {
  exercises: [
    { exercise: ex("back-squat"), sets: 4, role: "anchor" },
    { exercise: CURL, sets: 3, role: "accessory" },
  ],
  totalSets: 7,
  estimatedSeconds: 1800,
  deliveredSets: {},
  shortfalls: [],
};

const GOALS = { strength: 0.5, hypertrophy: 0.5 };

const anchorOf = (p: PrescribedSession) => p.exercises[0];
const accessoryOf = (p: PrescribedSession) => p.exercises[1];

describe("intensity is expressed per goal", () => {
  it("prescribes heavy anchors against RPE and a percentage", () => {
    // Load is the point for strength work, so the cue has to be load-based.
    const plan = prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: 1, blockLength: 4 });
    const set = anchorOf(plan).sets[0];
    expect(set.targetRpe).not.toBeNull();
    expect(set.targetPercent1rm).not.toBeNull();
  });

  it("prescribes accessories against reps in reserve", () => {
    // Proximity to failure is the point; the exact load is whatever achieves it.
    const plan = prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: 1, blockLength: 4 });
    const set = accessoryOf(plan).sets[0];
    expect(set.targetRir).not.toBeNull();
    expect(set.targetPercent1rm).toBeNull();
  });

  it("uses reps in reserve for anchors when the goal is purely hypertrophy", () => {
    const plan = prescribeSession({
      selected: SESSION,
      goals: { hypertrophy: 1 },
      weekInBlock: 1,
      blockLength: 4,
    });
    expect(anchorOf(plan).sets[0].targetRir).not.toBeNull();
  });

  it("respects each exercise's own rep range", () => {
    const plan = prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: 1, blockLength: 4 });
    const curlSet = accessoryOf(plan).sets[0];
    expect(curlSet.repMin).toBe(8);
    expect(curlSet.repMax).toBe(15);
  });

  it("rests anchors far longer than accessories", () => {
    const plan = prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: 1, blockLength: 4 });
    expect(anchorOf(plan).sets[0].restSeconds).toBeGreaterThan(
      accessoryOf(plan).sets[0].restSeconds * 2,
    );
  });
});

describe("effort ramps across a block", () => {
  const week = (n: number) =>
    prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: n, blockLength: 4 });

  it("moves closer to failure as the block progresses", () => {
    // Starting at maximal effort leaves nowhere to progress.
    const w1 = accessoryOf(week(1)).sets[0].targetRir!;
    const w3 = accessoryOf(week(3)).sets[0].targetRir!;
    expect(w1).toBeGreaterThan(w3);
  });

  it("raises the percentage on heavy work as the block progresses", () => {
    const w1 = anchorOf(week(1)).sets[0].targetPercent1rm!;
    const w3 = anchorOf(week(3)).sets[0].targetPercent1rm!;
    expect(w3).toBeGreaterThan(w1);
  });

  it("treats the final week as a deload", () => {
    const deload = week(4);
    expect(deload.isDeload).toBe(true);
    expect(deload.weekNote).toMatch(/deload/i);
  });

  it("cuts volume as well as load on a deload", () => {
    // Dropping load alone leaves the session just as long and sheds little
    // fatigue, which is the whole purpose of the week.
    const normal = week(3);
    const deload = week(4);
    expect(deload.exercises[0].sets.length).toBeLessThan(normal.exercises[0].sets.length);
  });

  it("keeps deload work well clear of failure", () => {
    const deload = week(4);
    expect(accessoryOf(deload).sets[0].targetRir!).toBeGreaterThanOrEqual(3);
  });
});

describe("specialisation techniques", () => {
  // Rolling push/pull/legs cannot add squat frequency, so the stimulus has to
  // come from within the one session.
  const spec = planLiftSpecialisation({
    pattern: "squat",
    split: "push_pull_legs",
    daysPerWeek: 4,
    weeklySetsForPattern: 12,
  });

  const plan = prescribeSession({
    selected: SESSION,
    goals: { strength: 0.7, hypertrophy: 0.3 },
    weekInBlock: 2,
    blockLength: 4,
    specialisation: spec,
  });

  it("prescribes a top set followed by back-offs", () => {
    const sets = anchorOf(plan).sets;
    expect(sets[0].kind).toBe("top");
    expect(sets.slice(1).every((s) => s.kind === "back_off")).toBe(true);
  });

  it("loads back-offs lighter than the top set", () => {
    const sets = anchorOf(plan).sets;
    expect(sets[1].targetPercent1rm!).toBeLessThan(sets[0].targetPercent1rm!);
  });

  it("adds pause work, which adds stimulus without adding load", () => {
    const sets = anchorOf(plan).sets;
    expect(sets[sets.length - 1].tempo).toMatch(/pause/i);
  });

  it("leaves unrelated exercises alone", () => {
    // The specialisation is on the squat; the curl should be ordinary work.
    expect(accessoryOf(plan).sets[0].kind).toBe("working");
    expect(accessoryOf(plan).sets[0].tempo).toBeNull();
  });

  it("does not apply top-set work during a deload", () => {
    const deload = prescribeSession({
      selected: SESSION,
      goals: { strength: 0.7, hypertrophy: 0.3 },
      weekInBlock: 4,
      blockLength: 4,
      specialisation: spec,
    });
    expect(anchorOf(deload).sets.every((s) => s.kind !== "top")).toBe(true);
  });
});

describe("summaries", () => {
  it("reads as a coach would write it", () => {
    const plan = prescribeSession({ selected: SESSION, goals: GOALS, weekInBlock: 2, blockLength: 4 });
    expect(anchorOf(plan).summary).toMatch(/^\d+ x \d+(-\d+)? @ RPE \d/);
    expect(accessoryOf(plan).summary).toMatch(/^\d+ x \d+-\d+ @ RIR \d/);
  });

  it("describes a top set and its back-offs separately", () => {
    const spec = planLiftSpecialisation({
      pattern: "squat",
      split: "push_pull_legs",
      daysPerWeek: 4,
      weeklySetsForPattern: 12,
    });
    const plan = prescribeSession({
      selected: SESSION,
      goals: { strength: 0.8, hypertrophy: 0.2 },
      weekInBlock: 2,
      blockLength: 4,
      specialisation: spec,
    });
    expect(anchorOf(plan).summary).toMatch(/then \d+ x/);
  });
});

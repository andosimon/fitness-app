import { describe, expect, it } from "vitest";

import {
  SPLIT_DEFINITIONS,
  buildRotation,
  dayFrequencyPerWeek,
  isRollingSchedule,
  muscleFrequencyPerWeek,
  patternFrequencyPerWeek,
} from "./splits";
import { planLiftSpecialisation, rankSplitsForPattern } from "./specialisation";

describe("split definitions", () => {
  it("gives every split at least one day type with patterns and muscles", () => {
    const broken = Object.entries(SPLIT_DEFINITIONS).filter(
      ([, days]) =>
        days.length === 0 || days.some((d) => d.patterns.length === 0 || d.muscles.length === 0),
    );
    expect(broken.map(([s]) => s)).toEqual([]);
  });

  it("covers every foundational pattern within each general split's cycle", () => {
    const general = ["full_body", "upper_lower", "push_pull_legs"] as const;
    const foundational = [
      "squat", "hinge", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull",
    ];
    for (const split of general) {
      const covered = new Set(SPLIT_DEFINITIONS[split].flatMap((d) => d.patterns));
      const missing = foundational.filter((p) => !covered.has(p as never));
      expect(missing, `${split} is missing patterns`).toEqual([]);
    }
  });
});

describe("rolling rotations", () => {
  it("continues the cycle across week boundaries", () => {
    // Push/pull/legs on four days: the week does not restart at push.
    const rotation = buildRotation("push_pull_legs", 4, 3);
    expect(rotation[0].map((d) => d.key)).toEqual(["push", "pull", "legs", "push"]);
    expect(rotation[1].map((d) => d.key)).toEqual(["pull", "legs", "push", "pull"]);
    expect(rotation[2].map((d) => d.key)).toEqual(["legs", "push", "pull", "legs"]);
  });

  it("delivers each day type equally over a full cycle of weeks", () => {
    const rotation = buildRotation("push_pull_legs", 4, 3).flat();
    const counts = new Map<string, number>();
    for (const day of rotation) counts.set(day.key, (counts.get(day.key) ?? 0) + 1);
    // 12 sessions across three day types.
    expect([...counts.values()]).toEqual([4, 4, 4]);
  });

  it("recognises when a split does not divide evenly into the week", () => {
    expect(isRollingSchedule("push_pull_legs", 4)).toBe(true);
    expect(isRollingSchedule("push_pull_legs", 6)).toBe(false);
    expect(isRollingSchedule("upper_lower", 4)).toBe(false);
    expect(isRollingSchedule("full_body", 3)).toBe(false);
  });
});

describe("frequency", () => {
  it("is fractional on a rolling schedule, not floored", () => {
    // The bug this replaced: flooring 4/3 to 1 understated leg frequency and
    // inflated per-session volume.
    expect(dayFrequencyPerWeek("push_pull_legs", 4)).toBeCloseTo(4 / 3, 5);
    expect(patternFrequencyPerWeek("push_pull_legs", "squat", 4)).toBeCloseTo(4 / 3, 5);
  });

  it("matches the intuitive answer on splits that divide evenly", () => {
    expect(patternFrequencyPerWeek("upper_lower", "squat", 4)).toBe(2);
    expect(patternFrequencyPerWeek("full_body", "squat", 4)).toBe(4);
    expect(patternFrequencyPerWeek("push_pull_legs", "squat", 6)).toBe(2);
  });

  it("tracks frequency per muscle, not per session", () => {
    // On upper/lower, chest and quads are trained on different days, so a naive
    // "sessions per week" figure would be wrong for both.
    expect(muscleFrequencyPerWeek("upper_lower", "chest", 4)).toBe(2);
    expect(muscleFrequencyPerWeek("upper_lower", "quads", 4)).toBe(2);
    expect(muscleFrequencyPerWeek("push_pull_legs", "chest", 6)).toBe(2);
    expect(muscleFrequencyPerWeek("full_body", "chest", 4)).toBe(4);
  });
});

describe("lift specialisation", () => {
  it("adds frequency when the split allows it", () => {
    // Full body reaches the squat every session, so bring it up by squatting more often.
    const plan = planLiftSpecialisation({
      pattern: "squat",
      split: "full_body",
      daysPerWeek: 4,
      weeklySetsForPattern: 12,
    });
    expect(plan.frequencyPerWeek).toBe(4);
    expect(plan.techniques).toContain("added_frequency");
    expect(plan.techniques).toContain("heavy_light_variation");
  });

  it("concentrates within one session when frequency is capped", () => {
    // Rolling PPL reaches the squat ~1.3 times a week, so the stimulus has to
    // come from inside the legs day instead of from extra sessions.
    const plan = planLiftSpecialisation({
      pattern: "squat",
      split: "push_pull_legs",
      daysPerWeek: 4,
      weeklySetsForPattern: 12,
    });
    expect(plan.frequencyPerWeek).toBeCloseTo(4 / 3, 5);
    expect(plan.techniques).toContain("concentrated_volume");
    expect(plan.techniques).toContain("pause_reps");
    expect(plan.techniques).toContain("back_off_sets");
    expect(plan.techniques).not.toContain("added_frequency");
    expect(plan.rolling).toBe(true);
  });

  it("puts more sets in each session when frequency is lower", () => {
    const input = { pattern: "squat", daysPerWeek: 4, weeklySetsForPattern: 12 } as const;
    const fullBody = planLiftSpecialisation({ ...input, split: "full_body" });
    const ppl = planLiftSpecialisation({ ...input, split: "push_pull_legs" });
    expect(ppl.setsPerSession).toBeGreaterThan(fullBody.setsPerSession);
  });

  it("names the muscles that limit the lift", () => {
    const plan = planLiftSpecialisation({
      pattern: "squat",
      split: "upper_lower",
      daysPerWeek: 4,
      weeklySetsForPattern: 10,
    });
    expect(plan.supportingMuscles).toEqual(
      expect.arrayContaining(["quads", "glutes", "lower_back"]),
    );
  });

  it("says plainly when a split cannot train the pattern at all", () => {
    const plan = planLiftSpecialisation({
      pattern: "squat",
      split: "body_part",
      daysPerWeek: 4,
      weeklySetsForPattern: 12,
    });
    expect(plan.frequencyPerWeek).toBeGreaterThan(0);
  });

  it("never exceeds the per-session set ceiling", () => {
    const plan = planLiftSpecialisation({
      pattern: "squat",
      split: "push_pull_legs",
      daysPerWeek: 3,
      weeklySetsForPattern: 40, // Absurd, to force the ceiling.
    });
    expect(plan.setsPerSession).toBeLessThanOrEqual(10);
  });

  it("ranks splits by how well they support a specialisation", () => {
    const ranked = rankSplitsForPattern("squat", 4);
    expect(ranked[0].split).toBe("full_body");
    // Rolling PPL should come last for a four-day week.
    expect(ranked[ranked.length - 1].split).toBe("push_pull_legs");
    expect(ranked[ranked.length - 1].rolling).toBe(true);
  });
});

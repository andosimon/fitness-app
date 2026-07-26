import { describe, expect, it } from "vitest";

import type { MuscleGroup } from "@/lib/domain/types";

import {
  PER_SESSION_SET_CEILING,
  WEEKLY_VOLUME_LANDMARKS,
  distributeAcrossSessions,
  planWeeklyVolume,
} from "./volume";

const CAPACITY = 100; // 4 sessions x 25 sets, the owner's realistic week.

describe("volume landmarks", () => {
  it("orders MEV <= MAV <= MRV for every muscle", () => {
    const broken = Object.entries(WEEKLY_VOLUME_LANDMARKS).filter(
      ([, l]) => !(l.mev <= l.mav && l.mav <= l.mrv),
    );
    expect(broken.map(([m]) => m)).toEqual([]);
  });

  it("keeps every muscle inside a defensible range", () => {
    // Nothing should demand more than the literature supports, and nothing
    // should sit at a ceiling nobody could recover from.
    const silly = Object.entries(WEEKLY_VOLUME_LANDMARKS).filter(
      ([, l]) => l.mav > 25 || l.mrv > 30 || l.mev < 0,
    );
    expect(silly.map(([m]) => m)).toEqual([]);
  });

  it("gives indirectly-worked muscles a zero minimum", () => {
    // Front delts and lower back get hammered by pressing, squatting and
    // hinging. Programming a floor for them stacks fatigue for no benefit.
    expect(WEEKLY_VOLUME_LANDMARKS.front_delts.mev).toBe(0);
    expect(WEEKLY_VOLUME_LANDMARKS.lower_back.mev).toBe(0);
  });
});

describe("weekly volume planning", () => {
  const base = { goals: { hypertrophy: 1 }, capacityWeeklySets: CAPACITY } as const;

  it("scales with training experience", () => {
    // Uncapped, because at a realistic capacity both intermediate and advanced
    // plans are capacity-bound and land on the same total. That is correct
    // behaviour, but it hides the experience scaling this test is about.
    const uncapped = { goals: { hypertrophy: 1 }, capacityWeeklySets: 500 } as const;
    const beginner = planWeeklyVolume({ ...uncapped, experience: "beginner" });
    const intermediate = planWeeklyVolume({ ...uncapped, experience: "intermediate" });
    const advanced = planWeeklyVolume({ ...uncapped, experience: "advanced" });

    expect(beginner.totalWeeklySets).toBeLessThan(intermediate.totalWeeklySets);
    expect(intermediate.totalWeeklySets).toBeLessThan(advanced.totalWeeklySets);
  });

  it("is capacity-bound at a realistic schedule for an advanced lifter", () => {
    // Worth asserting explicitly: 4 x 45-minute sessions cannot deliver the
    // volume an advanced hypertrophy block would ideally use. The constraint is
    // the clock, not the programming.
    const plan = planWeeklyVolume({ ...base, experience: "advanced" });
    expect(plan.scaledToFit).toBe(true);
    expect(plan.totalWeeklySets).toBe(CAPACITY);
  });

  it("prescribes less total volume for strength than hypertrophy", () => {
    // Strength blocks trade volume for intensity.
    const strength = planWeeklyVolume({
      goals: { strength: 1 },
      experience: "advanced",
      capacityWeeklySets: 500, // Deliberately uncapped, to compare intent.
    });
    const hypertrophy = planWeeklyVolume({
      goals: { hypertrophy: 1 },
      experience: "advanced",
      capacityWeeklySets: 500,
    });
    expect(strength.totalWeeklySets).toBeLessThan(hypertrophy.totalWeeklySets);
  });

  it("never plans more volume than the schedule can hold", () => {
    for (const capacity of [40, 60, 100, 140]) {
      const plan = planWeeklyVolume({
        goals: { hypertrophy: 1 },
        experience: "advanced",
        capacityWeeklySets: capacity,
      });
      expect(plan.totalWeeklySets).toBeLessThanOrEqual(capacity);
    }
  });

  it("flags when targets had to be scaled to fit", () => {
    const tight = planWeeklyVolume({
      goals: { hypertrophy: 1 },
      experience: "advanced",
      capacityWeeklySets: 40,
    });
    expect(tight.scaledToFit).toBe(true);

    const roomy = planWeeklyVolume({
      goals: { hypertrophy: 1 },
      experience: "beginner",
      capacityWeeklySets: 500,
    });
    expect(roomy.scaledToFit).toBe(false);
  });

  it("omits excluded muscles entirely", () => {
    const plan = planWeeklyVolume({
      ...base,
      experience: "advanced",
      excludedMuscles: ["lower_back", "calves"],
    });
    expect(plan.weeklySets.lower_back).toBeUndefined();
    expect(plan.weeklySets.calves).toBeUndefined();
  });
});

describe("specialisation", () => {
  /**
   * Deliberately uncapped. With a realistic capacity the plans get scaled by
   * different factors — the un-specialised one is trimmed harder because its
   * raw total is higher — which would confound a comparison of the
   * specialisation logic itself. Capacity scaling is tested separately.
   */
  const UNCAPPED = 500;

  const spec = (priorityMuscles: MuscleGroup[]) =>
    planWeeklyVolume({
      goals: { strength: 0.5, hypertrophy: 0.5 },
      experience: "advanced",
      capacityWeeklySets: UNCAPPED,
      specialization: { priorityMuscles },
    });

  const noSpec = planWeeklyVolume({
    goals: { strength: 0.5, hypertrophy: 0.5 },
    experience: "advanced",
    capacityWeeklySets: UNCAPPED,
  });

  it("gives the priority muscle more volume than it would otherwise get", () => {
    const plan = spec(["quads"]);
    expect(plan.weeklySets.quads ?? 0).toBeGreaterThan(noSpec.weeklySets.quads ?? 0);
    expect(plan.prioritised).toContain("quads");
  });

  it("marks non-priority muscles as trimmed", () => {
    const plan = spec(["quads"]);
    expect(plan.trimmed.length).toBeGreaterThan(5);
    expect(plan.trimmed).not.toContain("quads");
  });

  /*
   * Note on where the trade-off lives.
   *
   * The cost of a specialisation is currently expressed entirely through time
   * capacity: the priority target is reserved and everything else shares what
   * is left. Uncapped, specialisation therefore only adds volume.
   *
   * That is a simplification. Recovery is a real constraint independent of the
   * clock — a lifter with unlimited session time still cannot specialise
   * everything. It does not bite here because a 4 x 45-minute week is firmly
   * capacity-bound, but it would matter for someone training 6 x 90. Modelling
   * a separate systemic-fatigue ceiling is deferred until it earns its keep.
   *
   * The behaviour that matters is asserted below, at a realistic capacity.
   */

  it("supports a lift-driven specialisation", () => {
    // "Improve my max squat" becomes priority on the muscles the squat trains.
    const plan = planWeeklyVolume({
      goals: { strength: 0.7, hypertrophy: 0.3 },
      experience: "advanced",
      capacityWeeklySets: UNCAPPED,
      specialization: { priorityMuscleGroupsFromLift: ["quads", "glutes"] },
    });
    expect(plan.prioritised).toEqual(expect.arrayContaining(["quads", "glutes"]));
    expect(plan.weeklySets.quads ?? 0).toBeGreaterThan(noSpec.weeklySets.quads ?? 0);
  });

  it("still trims non-priority muscles at a realistic, capacity-bound schedule", () => {
    // Regression guard. Scaling every muscle by one factor preserves their
    // ratios, so trimming lowered the raw total, which made the scaling gentler,
    // which handed the freed volume straight back — chest actually went *up*
    // under a squat specialisation. The cut has to land on non-priority work.
    const capped = (priorityMuscles?: MuscleGroup[]) =>
      planWeeklyVolume({
        goals: { strength: 0.5, hypertrophy: 0.5 },
        experience: "advanced",
        capacityWeeklySets: CAPACITY,
        specialization: priorityMuscles ? { priorityMuscles } : undefined,
      });

    const balanced = capped();
    const squatBlock = capped(["quads", "glutes"]);

    expect(squatBlock.weeklySets.quads ?? 0).toBeGreaterThan(balanced.weeklySets.quads ?? 0);
    expect(squatBlock.weeklySets.glutes ?? 0).toBeGreaterThan(balanced.weeklySets.glutes ?? 0);
    // And the upper body pays for it.
    expect(squatBlock.weeklySets.chest ?? 0).toBeLessThan(balanced.weeklySets.chest ?? 0);
    expect(squatBlock.weeklySets.biceps ?? 0).toBeLessThan(balanced.weeklySets.biceps ?? 0);
    // Total is unchanged: the clock still governs.
    expect(squatBlock.totalWeeklySets).toBe(balanced.totalWeeklySets);
  });

  it("keeps priority muscles at or above MEV even when squeezed", () => {
    const plan = planWeeklyVolume({
      goals: { strength: 1 },
      experience: "advanced",
      capacityWeeklySets: 25, // Brutally tight.
      specialization: { priorityMuscles: ["quads"] },
    });
    expect(plan.weeklySets.quads ?? 0).toBeGreaterThanOrEqual(
      WEEKLY_VOLUME_LANDMARKS.quads.mev,
    );
  });
});

describe("distributing volume across sessions", () => {
  const weekly: Partial<Record<MuscleGroup, number>> = {
    chest: 16,
    quads: 15,
    biceps: 12,
    calves: 30, // Deliberately extreme, to exercise the ceiling.
  };

  it("trains muscles more often on a full-body split than on PPL", () => {
    const fullBody = distributeAcrossSessions(weekly, "full_body", 4);
    const ppl = distributeAcrossSessions(weekly, "push_pull_legs", 4);
    const chestFull = fullBody.find((t) => t.muscle === "chest")!;
    const chestPpl = ppl.find((t) => t.muscle === "chest")!;

    expect(chestFull.sessionsPerWeek).toBeGreaterThan(chestPpl.sessionsPerWeek);
    // Same weekly volume spread thinner, so each session does less.
    expect(chestFull.setsPerSession).toBeLessThan(chestPpl.setsPerSession);
  });

  it("respects the per-session ceiling and says when it bit", () => {
    // 30 weekly sets over 1 session would be 30 in a day, which is junk volume.
    const bodyPart = distributeAcrossSessions(weekly, "body_part", 4);
    const calves = bodyPart.find((t) => t.muscle === "calves")!;
    expect(calves.setsPerSession).toBeLessThanOrEqual(PER_SESSION_SET_CEILING);
    expect(calves.cappedByCeiling).toBe(true);
    // And the shortfall is visible rather than hidden.
    expect(calves.effectiveWeeklySets).toBeLessThan(30);
  });

  it("delivers the weekly target when frequency is adequate", () => {
    const upperLower = distributeAcrossSessions({ chest: 16 }, "upper_lower", 4);
    const chest = upperLower.find((t) => t.muscle === "chest")!;
    expect(chest.sessionsPerWeek).toBe(2);
    expect(chest.setsPerSession).toBe(8);
    expect(chest.effectiveWeeklySets).toBe(16);
    expect(chest.cappedByCeiling).toBe(false);
  });

  it("drops muscles whose per-session share rounds to nothing", () => {
    const spread = distributeAcrossSessions({ neck: 1 }, "full_body", 6);
    expect(spread.find((t) => t.muscle === "neck")).toBeUndefined();
  });
});

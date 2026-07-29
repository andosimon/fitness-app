import { describe, expect, it } from "vitest";

import type { Equipment } from "@/lib/domain/types";

import { adaptSessionToEquipment, describeAdaptation, type PlannedForAdaptation } from "./adapt";
import type { SelectableExercise } from "./selection";

function ex(slug: string, overrides: Partial<SelectableExercise> = {}): SelectableExercise {
  return {
    id: slug,
    slug,
    name: slug,
    movementPattern: "horizontal_push",
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    requiredEquipment: ["bodyweight"],
    loadType: "bodyweight",
    isCompound: true,
    isUnilateral: false,
    complexity: 2,
    stimulusFatigueRatio: 3,
    defaultRepMin: 6,
    defaultRepMax: 12,
    substitutionGroup: null,
    ...overrides,
  };
}

const BENCH = ex("bench-press", {
  requiredEquipment: ["barbell", "bench_flat"],
  loadType: "barbell",
  substitutionGroup: "horizontal-push",
});
const PUSH_UP = ex("push-up", {
  requiredEquipment: ["bodyweight"],
  substitutionGroup: "horizontal-push",
  stimulusFatigueRatio: 4,
});
const BAND_PRESS = ex("band-chest-press", {
  requiredEquipment: ["resistance_band_long"],
  loadType: "band",
  substitutionGroup: "horizontal-push",
  stimulusFatigueRatio: 3,
});
const SQUAT = ex("back-squat", {
  movementPattern: "squat",
  primaryMuscles: ["quads", "glutes"],
  requiredEquipment: ["barbell", "squat_rack"],
  loadType: "barbell",
  substitutionGroup: "squat-loaded",
});
const BW_SQUAT = ex("bodyweight-squat", {
  movementPattern: "squat",
  primaryMuscles: ["quads", "glutes"],
  requiredEquipment: ["bodyweight"],
  substitutionGroup: "squat-bodyweight",
  stimulusFatigueRatio: 4,
});
const PULLDOWN = ex("lat-pulldown", {
  movementPattern: "vertical_pull",
  primaryMuscles: ["lats"],
  requiredEquipment: ["lat_pulldown"],
  loadType: "machine_load",
  substitutionGroup: "vertical-pull-machine",
});
const LEG_CURL = ex("lying-leg-curl", {
  movementPattern: "hinge",
  primaryMuscles: ["hamstrings"],
  requiredEquipment: ["leg_curl_machine"],
  loadType: "machine_load",
  substitutionGroup: "hamstring-iso",
});

const LIBRARY = [BENCH, PUSH_UP, BAND_PRESS, SQUAT, BW_SQUAT, PULLDOWN, LEG_CURL];

const HOTEL_ROOM: Equipment[] = ["bodyweight", "wall", "bench_or_chair", "resistance_band_long"];
const HOME_GYM: Equipment[] = ["bodyweight", "barbell", "bench_flat", "squat_rack", "lat_pulldown"];

function plan(...items: [SelectableExercise, number][]): PlannedForAdaptation[] {
  return items.map(([exercise, sets], i) => ({
    plannedExerciseId: `pe-${i}`,
    exercise,
    sets,
    supersetGroup: null,
  }));
}

describe("adapting to different equipment", () => {
  it("keeps everything that still works", () => {
    // A hotel session should be recognisably the session you were going to do.
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3], [SQUAT, 3]),
      availableEquipment: HOME_GYM,
      library: LIBRARY,
    });
    expect(result.kept).toBe(2);
    expect(result.substituted).toBe(0);
    expect(result.dropped).toBe(0);
  });

  it("substitutes within the same group when the kit is missing", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    const swap = result.exercises[0];
    expect(swap.outcome).toBe("substituted");
    expect(swap.replacement!.substitutionGroup).toBe("horizontal-push");
    expect(swap.note).toMatch(/same job/i);
  });

  it("preserves the set count through a substitution", () => {
    // The point is to deliver the volume owed, not to redesign the session.
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 4]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    expect(result.exercises[0].sets).toBe(4);
  });

  it("falls back to a same-pattern option outside the group", () => {
    // No squat in the same group is available, but a bodyweight squat still
    // trains the pattern and the same muscles.
    const result = adaptSessionToEquipment({
      planned: plan([SQUAT, 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    expect(result.exercises[0].replacement?.slug).toBe("bodyweight-squat");
    expect(result.exercises[0].note).toMatch(/loads will not carry over/i);
  });

  it("never substitutes something the equipment cannot do", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3], [SQUAT, 3], [PULLDOWN, 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    for (const item of result.exercises) {
      if (!item.replacement) continue;
      for (const kit of item.replacement.requiredEquipment) {
        expect(HOTEL_ROOM).toContain(kit);
      }
    }
  });

  it("does not use the same substitute twice", () => {
    // Two swaps landing on the same movement is redundancy, not volume.
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3], [ex("incline-bench", {
        requiredEquipment: ["barbell", "bench_adjustable"],
        substitutionGroup: "horizontal-push",
      }), 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    const chosen = result.exercises
      .map((e) => e.replacement?.slug)
      .filter((s): s is string => s !== undefined);
    expect(new Set(chosen).size).toBe(chosen.length);
  });

  it("drops what genuinely cannot be covered, and says so", () => {
    // A bare room has no way to load knee flexion. Quietly substituting a token
    // movement would be worse than admitting it.
    const result = adaptSessionToEquipment({
      planned: plan([LEG_CURL, 3]),
      availableEquipment: ["bodyweight"],
      library: [LEG_CURL, BENCH],
    });
    expect(result.dropped).toBe(1);
    expect(result.exercises[0].replacement).toBeNull();
    expect(result.uncovered).toEqual([{ muscle: "hamstrings", sets: 3 }]);
  });

  it("never substitutes an exercise that trains a different muscle", () => {
    /*
     * Regression guard. Matching on movement pattern alone is not enough:
     * `isolation_upper` covers shrugs, curls, lateral raises and pushdowns
     * alike. A real run substituted a dumbbell shrug with a band curl, and a
     * biceps curl with a triceps pushdown — its own antagonist.
     */
    const shrug = ex("dumbbell-shrug", {
      movementPattern: "isolation_upper",
      primaryMuscles: ["traps"],
      requiredEquipment: ["dumbbell"],
      isCompound: false,
      substitutionGroup: "trap-shrug",
    });
    const bandCurl = ex("band-curl", {
      movementPattern: "isolation_upper",
      primaryMuscles: ["biceps"],
      requiredEquipment: ["resistance_band_long"],
      isCompound: false,
      substitutionGroup: "biceps-curl",
    });

    const result = adaptSessionToEquipment({
      planned: plan([shrug, 3]),
      availableEquipment: HOTEL_ROOM,
      library: [shrug, bandCurl, PUSH_UP],
    });

    // Nothing here trains traps, so the honest answer is to drop it.
    expect(result.exercises[0].replacement).toBeNull();
    expect(result.uncovered).toEqual([{ muscle: "traps", sets: 3 }]);
  });

  it("still substitutes across patterns when the muscle matches", () => {
    // A band lateral raise for a dumbbell one is a different pattern in name
    // only; what matters is that both train the side delts.
    const dbRaise = ex("db-lateral-raise", {
      movementPattern: "isolation_upper",
      primaryMuscles: ["side_delts"],
      requiredEquipment: ["dumbbell"],
      isCompound: false,
      substitutionGroup: "lateral-raise",
    });
    const bandRaise = ex("band-lateral-raise", {
      movementPattern: "isolation_upper",
      primaryMuscles: ["side_delts"],
      requiredEquipment: ["resistance_band_long"],
      isCompound: false,
      substitutionGroup: "lateral-raise",
    });

    const result = adaptSessionToEquipment({
      planned: plan([dbRaise, 3]),
      availableEquipment: HOTEL_ROOM,
      library: [dbRaise, bandRaise],
    });
    expect(result.exercises[0].replacement?.slug).toBe("band-lateral-raise");
  });

  it("honours excluded exercises", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
      excludeExerciseIds: ["push-up"],
    });
    expect(result.exercises[0].replacement?.slug).not.toBe("push-up");
  });

  it("is deterministic", () => {
    const run = () =>
      adaptSessionToEquipment({
        planned: plan([BENCH, 3], [SQUAT, 3]),
        availableEquipment: HOTEL_ROOM,
        library: LIBRARY,
      }).exercises.map((e) => e.replacement?.slug ?? "dropped");
    expect(run()).toEqual(run());
  });
});

describe("describing the adaptation", () => {
  it("says plainly when nothing changed", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3]),
      availableEquipment: HOME_GYM,
      library: LIBRARY,
    });
    expect(describeAdaptation(result)).toMatch(/everything in this session works/i);
  });

  it("names the volume that will be missed", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3], [LEG_CURL, 4]),
      availableEquipment: ["bodyweight"],
      library: [BENCH, PUSH_UP, LEG_CURL],
    });
    const text = describeAdaptation(result);
    expect(text).toMatch(/hamstrings \(4\)/);
    expect(text).toMatch(/not possible/);
  });

  it("confirms volume is preserved when everything was swappable", () => {
    const result = adaptSessionToEquipment({
      planned: plan([BENCH, 3]),
      availableEquipment: HOTEL_ROOM,
      library: LIBRARY,
    });
    expect(describeAdaptation(result)).toMatch(/volume is preserved/i);
  });
});

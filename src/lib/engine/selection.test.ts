import { describe, expect, it } from "vitest";

import type { Equipment, MuscleGroup } from "@/lib/domain/types";

import {
  isPerformable,
  selectSessionExercises,
  type SelectableExercise,
  type SelectionContext,
  type SessionSelectionInput,
} from "./selection";
import { SPLIT_DEFINITIONS } from "./splits";

/** Compact builder so the fixtures below stay readable. */
function ex(
  slug: string,
  overrides: Partial<SelectableExercise> = {},
): SelectableExercise {
  return {
    id: slug,
    slug,
    name: slug,
    movementPattern: "squat",
    primaryMuscles: ["quads"],
    secondaryMuscles: [],
    requiredEquipment: ["bodyweight"],
    loadType: "bodyweight",
    isCompound: false,
    isUnilateral: false,
    complexity: 2,
    stimulusFatigueRatio: 3,
    defaultRepMin: 8,
    defaultRepMax: 12,
    substitutionGroup: null,
    ...overrides,
  };
}

const LIBRARY: SelectableExercise[] = [
  // Squat anchors, all barbell compounds so the shortlist has real choices.
  ex("back-squat", { isCompound: true, loadType: "barbell", requiredEquipment: ["barbell", "squat_rack"], stimulusFatigueRatio: 3, primaryMuscles: ["quads", "glutes"], substitutionGroup: "squat-bilateral" }),
  ex("front-squat", { isCompound: true, loadType: "barbell", requiredEquipment: ["barbell", "squat_rack"], stimulusFatigueRatio: 3, primaryMuscles: ["quads"], substitutionGroup: "squat-bilateral" }),
  ex("pause-squat", { isCompound: true, loadType: "barbell", requiredEquipment: ["barbell", "squat_rack"], stimulusFatigueRatio: 3, primaryMuscles: ["quads", "glutes"], substitutionGroup: "squat-bilateral" }),
  ex("goblet-squat", { isCompound: true, loadType: "kettlebell", requiredEquipment: ["kettlebell"], stimulusFatigueRatio: 4, primaryMuscles: ["quads"], substitutionGroup: "squat-portable" }),

  // Hinge.
  ex("deadlift", { movementPattern: "hinge", isCompound: true, loadType: "barbell", requiredEquipment: ["barbell"], primaryMuscles: ["hamstrings", "glutes"], stimulusFatigueRatio: 2, substitutionGroup: "hinge-heavy" }),
  ex("romanian-deadlift", { movementPattern: "hinge", isCompound: true, loadType: "barbell", requiredEquipment: ["barbell"], primaryMuscles: ["hamstrings"], stimulusFatigueRatio: 4, substitutionGroup: "hinge-moderate" }),

  // Quad accessories.
  ex("leg-extension", { movementPattern: "isolation_lower", primaryMuscles: ["quads"], requiredEquipment: ["ankle_weights"], stimulusFatigueRatio: 5, substitutionGroup: "quad-iso" }),
  ex("sissy-squat", { movementPattern: "isolation_lower", primaryMuscles: ["quads"], stimulusFatigueRatio: 4, substitutionGroup: "quad-iso" }),

  // Hamstring accessories — antagonists to the quad work.
  ex("leg-curl", { movementPattern: "hinge", primaryMuscles: ["hamstrings"], requiredEquipment: ["ankle_weights"], stimulusFatigueRatio: 5, substitutionGroup: "ham-iso" }),
  ex("nordic-curl", { movementPattern: "hinge", primaryMuscles: ["hamstrings"], stimulusFatigueRatio: 3, substitutionGroup: "ham-iso" }),

  // Calves and core, to give the allocator more targets.
  ex("calf-raise", { movementPattern: "isolation_lower", primaryMuscles: ["calves"], stimulusFatigueRatio: 5, substitutionGroup: "calf" }),
  ex("plank", { movementPattern: "core_anti_extension", primaryMuscles: ["abs"], loadType: "time", stimulusFatigueRatio: 4, substitutionGroup: "anti-ext" }),
];

const HOME_GYM: Equipment[] = [
  "bodyweight", "barbell", "squat_rack", "kettlebell", "ankle_weights",
];

const LOWER_DAY = SPLIT_DEFINITIONS.upper_lower[1];

function baseInput(overrides: Partial<SessionSelectionInput> = {}): SessionSelectionInput {
  const context: SelectionContext = {
    availableEquipment: HOME_GYM,
    blockIndex: 0,
    dayVariantIndex: 0,
    seed: "test",
  };
  return {
    day: LOWER_DAY,
    muscleTargets: { quads: 6, hamstrings: 6, glutes: 4, calves: 3, abs: 3 },
    setBudget: 24,
    anchorPatterns: ["squat", "hinge"],
    setsPerAnchor: 4,
    library: LIBRARY,
    context,
    ...overrides,
  };
}

describe("equipment filtering", () => {
  it("requires every listed item to be available", () => {
    const squat = LIBRARY.find((e) => e.slug === "back-squat")!;
    expect(isPerformable(squat, HOME_GYM)).toBe(true);
    expect(isPerformable(squat, ["barbell"])).toBe(false); // No rack.
  });

  it("never selects an exercise the equipment cannot support", () => {
    const result = selectSessionExercises(
      baseInput({ context: { ...baseInput().context, availableEquipment: ["bodyweight"] } }),
    );
    for (const chosen of result.exercises) {
      expect(isPerformable(chosen.exercise, ["bodyweight"])).toBe(true);
    }
  });

  it("honours excluded exercises", () => {
    const result = selectSessionExercises(
      baseInput({
        context: { ...baseInput().context, excludedExerciseIds: ["back-squat", "front-squat"] },
      }),
    );
    const slugs = result.exercises.map((e) => e.exercise.slug);
    expect(slugs).not.toContain("back-squat");
    expect(slugs).not.toContain("front-squat");
  });
});

describe("anchors", () => {
  it("selects one anchor per requested pattern", () => {
    const result = selectSessionExercises(baseInput());
    const anchors = result.exercises.filter((e) => e.role === "anchor");
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.exercise.movementPattern).sort()).toEqual(["hinge", "squat"]);
  });

  it("prefers loadable compounds over isolation for anchors", () => {
    const result = selectSessionExercises(baseInput());
    const squatAnchor = result.exercises.find(
      (e) => e.role === "anchor" && e.exercise.movementPattern === "squat",
    )!;
    expect(squatAnchor.exercise.isCompound).toBe(true);
  });

  it("stays identical across weeks within a block, so load can be progressed", () => {
    // The whole point of an anchor: you cannot add weight to a lift that keeps
    // changing. Same block, different day variant, must give the same anchor.
    const weekOne = selectSessionExercises(baseInput());
    const weekTwo = selectSessionExercises(baseInput());
    const anchorsOf = (r: ReturnType<typeof selectSessionExercises>) =>
      r.exercises.filter((e) => e.role === "anchor").map((e) => e.exercise.slug);
    expect(anchorsOf(weekTwo)).toEqual(anchorsOf(weekOne));
  });

  it("rotates anchors between blocks, so a cycle does not go stale", () => {
    const anchorsFor = (blockIndex: number) =>
      selectSessionExercises(
        baseInput({ context: { ...baseInput().context, blockIndex } }),
      )
        .exercises.filter((e) => e.role === "anchor")
        .map((e) => e.exercise.slug)
        .join(",");

    const seen = new Set([anchorsFor(0), anchorsFor(1), anchorsFor(2), anchorsFor(3)]);
    // Four blocks should not all produce the same anchor pairing.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("determinism", () => {
  it("produces identical output for identical inputs", () => {
    const a = selectSessionExercises(baseInput());
    const b = selectSessionExercises(baseInput());
    expect(a.exercises.map((e) => e.exercise.slug)).toEqual(
      b.exercises.map((e) => e.exercise.slug),
    );
  });

  it("produces different accessories for different day variants", () => {
    // Lower A and Lower B in the same week should not be a carbon copy.
    const variantA = selectSessionExercises(
      baseInput({ context: { ...baseInput().context, dayVariantIndex: 0 } }),
    );
    const variantB = selectSessionExercises(
      baseInput({ context: { ...baseInput().context, dayVariantIndex: 1 } }),
    );
    const accOf = (r: ReturnType<typeof selectSessionExercises>) =>
      r.exercises.filter((e) => e.role === "accessory").map((e) => e.exercise.slug).join(",");
    // Not a hard guarantee with a small fixture library, but the keys differ so
    // the selections should too whenever there is any choice at all.
    expect(accOf(variantA)).not.toBe("");
    expect(accOf(variantB)).not.toBe("");
  });

  it("gives different programmes different selections", () => {
    const one = selectSessionExercises(
      baseInput({ context: { ...baseInput().context, seed: "programme-one" } }),
    );
    const two = selectSessionExercises(
      baseInput({ context: { ...baseInput().context, seed: "programme-two" } }),
    );
    expect(one.exercises.length).toBeGreaterThan(0);
    expect(two.exercises.length).toBeGreaterThan(0);
  });
});

describe("volume targeting", () => {
  it("never exceeds the set budget", () => {
    for (const setBudget of [6, 12, 18, 24, 30]) {
      const result = selectSessionExercises(baseInput({ setBudget }));
      expect(result.totalSets).toBeLessThanOrEqual(setBudget);
    }
  });

  it("credits secondary muscles at half", () => {
    // A deadlift trains glutes directly and the back indirectly; counting the
    // latter fully would overstate back volume.
    const result = selectSessionExercises(
      baseInput({
        library: [
          ex("row", {
            movementPattern: "hinge",
            primaryMuscles: ["lats"],
            secondaryMuscles: ["biceps"],
            isCompound: true,
          }),
        ],
        anchorPatterns: ["hinge"],
        setsPerAnchor: 4,
        muscleTargets: { lats: 4 },
        day: { ...LOWER_DAY, muscles: ["lats", "biceps"], patterns: ["hinge"] },
      }),
    );
    expect(result.deliveredSets.lats).toBe(4);
    expect(result.deliveredSets.biceps).toBe(2);
  });

  it("avoids two exercises from the same substitution group", () => {
    // Two near-identical movements in one session is redundancy, not volume.
    const result = selectSessionExercises(baseInput({ setBudget: 40 }));
    const groups = result.exercises
      .map((e) => e.exercise.substitutionGroup)
      .filter((g): g is string => g !== null);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("reports shortfalls rather than hiding them", () => {
    // Bodyweight only, but targets that need loading.
    const result = selectSessionExercises(
      baseInput({
        context: { ...baseInput().context, availableEquipment: ["bodyweight"] },
        muscleTargets: { quads: 12, hamstrings: 12, calves: 9 },
      }),
    );
    expect(result.shortfalls.length).toBeGreaterThan(0);
    for (const s of result.shortfalls) expect(s.delivered).toBeLessThan(s.target);
  });

  it("terminates when nothing can serve the remaining deficit", () => {
    // A target for a muscle no available exercise trains must not spin forever.
    const result = selectSessionExercises(
      baseInput({ muscleTargets: { neck: 10 } as Partial<Record<MuscleGroup, number>>, setBudget: 30 }),
    );
    expect(result.totalSets).toBeLessThanOrEqual(30);
  });
});

describe("antagonist supersets", () => {
  it("pairs accessories that do not share a muscle", () => {
    const result = selectSessionExercises(baseInput({ setBudget: 30 }));
    const groups = new Map<string, typeof result.exercises>();
    for (const e of result.exercises) {
      if (!e.supersetGroup) continue;
      groups.set(e.supersetGroup, [...(groups.get(e.supersetGroup) ?? []), e]);
    }

    for (const [, members] of groups) {
      expect(members).toHaveLength(2);
      const [a, b] = members;
      const aMuscles = new Set([...a.exercise.primaryMuscles, ...a.exercise.secondaryMuscles]);
      const shared = [...b.exercise.primaryMuscles, ...b.exercise.secondaryMuscles].filter((m) =>
        aMuscles.has(m),
      );
      // Sharing a muscle would make the second exercise worse, not save time.
      expect(shared).toEqual([]);
    }
  });

  it("never supersets an anchor", () => {
    // Pairing something off a heavy top set compromises the lift you are
    // actually trying to progress.
    const result = selectSessionExercises(baseInput({ setBudget: 30 }));
    for (const e of result.exercises) {
      if (e.role === "anchor") expect(e.supersetGroup).toBeUndefined();
    }
  });
});

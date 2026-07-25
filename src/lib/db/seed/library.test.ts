import { describe, expect, it } from "vitest";

import {
  EQUIPMENT,
  EQUIPMENT_PRESETS,
  FOUNDATIONAL_PATTERNS,
  MUSCLE_GROUPS,
  type Equipment,
  type MovementPattern,
} from "@/lib/domain/types";

import { ALL_EXERCISE_SEEDS } from "./exercises";
import { seedToRow } from "./index";

/**
 * These are correctness tests for the exercise library, not the code that reads
 * it. The engine's output can only be as good as these tags: a wrong `equipment`
 * entry silently generates a workout the user cannot physically perform, and a
 * wrong `pattern` quietly unbalances a program. Cheaper to catch here.
 */

/** True when the profile contains every piece of equipment the exercise needs. */
function isAvailable(required: Equipment[], profile: Equipment[]): boolean {
  return required.every((item) => profile.includes(item));
}

/**
 * Bodyweight-only training genuinely cannot load a vertical pull — there is
 * nothing to hang from and no band to anchor. This is a real physical constraint,
 * not missing data, and the engine redistributes the owed volume to horizontal
 * pull instead. Documented here so the coverage test stays honest rather than
 * being quietly weakened.
 */
const KNOWN_COVERAGE_GAPS: ReadonlyArray<`${string}:${MovementPattern}`> = [
  "bodyweight_only:vertical_pull",
];

describe("exercise library integrity", () => {
  it("has a meaningful number of exercises", () => {
    expect(ALL_EXERCISE_SEEDS.length).toBeGreaterThanOrEqual(150);
  });

  it("has unique slugs", () => {
    const seen = new Map<string, number>();
    for (const ex of ALL_EXERCISE_SEEDS) {
      seen.set(ex.slug, (seen.get(ex.slug) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);
    expect(duplicates).toEqual([]);
  });

  it("has unique names", () => {
    const seen = new Map<string, number>();
    for (const ex of ALL_EXERCISE_SEEDS) {
      seen.set(ex.name, (seen.get(ex.name) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
    expect(duplicates).toEqual([]);
  });

  it("uses kebab-case slugs", () => {
    const bad = ALL_EXERCISE_SEEDS.filter((ex) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.slug));
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("gives every exercise at least one primary muscle", () => {
    const bad = ALL_EXERCISE_SEEDS.filter((ex) => ex.primary.length === 0);
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("gives every exercise at least one equipment requirement", () => {
    // Even a push-up requires "bodyweight" — an empty array would make the
    // availability filter match everything unconditionally.
    const bad = ALL_EXERCISE_SEEDS.filter((ex) => ex.equipment.length === 0);
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("only references known equipment", () => {
    const known = new Set<string>(EQUIPMENT);
    const bad = ALL_EXERCISE_SEEDS.flatMap((ex) =>
      [...ex.equipment, ...(ex.optional ?? [])]
        .filter((item) => !known.has(item))
        .map((item) => `${ex.slug}: ${item}`),
    );
    expect(bad).toEqual([]);
  });

  it("only references known muscle groups", () => {
    const known = new Set<string>(MUSCLE_GROUPS);
    const bad = ALL_EXERCISE_SEEDS.flatMap((ex) =>
      [...ex.primary, ...(ex.secondary ?? [])]
        .filter((m) => !known.has(m))
        .map((m) => `${ex.slug}: ${m}`),
    );
    expect(bad).toEqual([]);
  });

  it("never lists a muscle as both primary and secondary", () => {
    // Double-counting would inflate weekly volume for that muscle.
    const bad = ALL_EXERCISE_SEEDS.filter((ex) =>
      (ex.secondary ?? []).some((m) => ex.primary.includes(m)),
    );
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("never lists the same equipment as both required and optional", () => {
    const bad = ALL_EXERCISE_SEEDS.filter((ex) =>
      (ex.optional ?? []).some((item) => ex.equipment.includes(item)),
    );
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("keeps complexity and stimulus-to-fatigue within 1-5", () => {
    const bad = ALL_EXERCISE_SEEDS.filter(
      (ex) =>
        (ex.complexity !== undefined && (ex.complexity < 1 || ex.complexity > 5)) ||
        (ex.sfr !== undefined && (ex.sfr < 1 || ex.sfr > 5)),
    );
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("keeps rep ranges ordered and sane", () => {
    const bad = ALL_EXERCISE_SEEDS.filter((ex) => {
      if (!ex.reps) return false;
      const [min, max] = ex.reps;
      return min < 1 || max < min || max > 100;
    });
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("assigns every exercise a substitution group", () => {
    const bad = ALL_EXERCISE_SEEDS.filter((ex) => !ex.sub || ex.sub.trim() === "");
    expect(bad.map((e) => e.slug)).toEqual([]);
  });

  it("gives every substitution group at least two members", () => {
    // A group of one cannot be substituted, which defeats its purpose.
    const counts = new Map<string, string[]>();
    for (const ex of ALL_EXERCISE_SEEDS) {
      counts.set(ex.sub, [...(counts.get(ex.sub) ?? []), ex.slug]);
    }
    const lonely = [...counts.entries()].filter(([, members]) => members.length < 2);
    expect(lonely.map(([group]) => group)).toEqual([]);
  });

  it("marks time- and distance-based work with the matching load type", () => {
    // A plank logged with a rep count instead of seconds is a data bug that
    // would corrupt progression maths later.
    const bad = ALL_EXERCISE_SEEDS.filter(
      (ex) => /plank|hold|carry|wall-sit|l-sit/.test(ex.slug) && !["time", "distance"].includes(ex.load),
    );
    expect(bad.map((e) => e.slug)).toEqual([]);
  });
});

describe("equipment coverage per profile", () => {
  const presets = Object.entries(EQUIPMENT_PRESETS) as [string, Equipment[]][];

  it.each(presets)("%s can train every foundational pattern", (presetName, profile) => {
    const missing = FOUNDATIONAL_PATTERNS.filter((pattern) => {
      const key = `${presetName}:${pattern}` as `${string}:${MovementPattern}`;
      if (KNOWN_COVERAGE_GAPS.includes(key)) return false;
      return !ALL_EXERCISE_SEEDS.some(
        (ex) => ex.pattern === pattern && isAvailable(ex.equipment, profile),
      );
    });

    expect(missing).toEqual([]);
  });

  it.each(presets)("%s has enough choice to build a varied week", (_name, profile) => {
    const available = ALL_EXERCISE_SEEDS.filter((ex) => isAvailable(ex.equipment, profile));
    // Below roughly this many, generated weeks start repeating themselves.
    expect(available.length).toBeGreaterThanOrEqual(15);
  });

  it("confirms the documented gaps are still real", () => {
    // If a gap silently becomes coverable, the exception should be removed
    // rather than left to hide a genuine future regression.
    for (const key of KNOWN_COVERAGE_GAPS) {
      const [presetName, pattern] = key.split(":") as [keyof typeof EQUIPMENT_PRESETS, MovementPattern];
      const profile = EQUIPMENT_PRESETS[presetName] as Equipment[];
      const covered = ALL_EXERCISE_SEEDS.some(
        (ex) => ex.pattern === pattern && isAvailable(ex.equipment, profile),
      );
      expect(covered, `${key} is now coverable — remove it from KNOWN_COVERAGE_GAPS`).toBe(false);
    }
  });
});

describe("seedToRow mapping", () => {
  it("applies defaults for omitted fields", () => {
    const row = seedToRow({
      slug: "test-movement",
      name: "Test Movement",
      pattern: "squat",
      primary: ["quads"],
      equipment: ["bodyweight"],
      load: "bodyweight",
      sub: "test-group",
    });

    expect(row.complexity).toBe(2);
    expect(row.stimulusFatigueRatio).toBe(3);
    expect(row.defaultRepMin).toBe(6);
    expect(row.defaultRepMax).toBe(12);
    expect(row.isCompound).toBe(false);
    expect(row.isUnilateral).toBe(false);
    expect(row.isCustom).toBe(false);
    expect(row.aliases).toEqual([]);
    expect(row.secondaryMuscles).toEqual([]);
  });

  it("maps every seed without throwing", () => {
    expect(() => ALL_EXERCISE_SEEDS.map(seedToRow)).not.toThrow();
  });
});

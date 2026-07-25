import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { equipmentProfiles, exercises, type NewExercise } from "@/lib/db/schema";
import { EQUIPMENT_PRESETS, type Equipment } from "@/lib/domain/types";

import { ALL_EXERCISE_SEEDS } from "./exercises";
import { SEED_DEFAULTS, type ExerciseSeed } from "./types";

/** Expands the compact authoring format into a database row. */
export function seedToRow(seed: ExerciseSeed): NewExercise {
  const [repMin, repMax] = seed.reps ?? SEED_DEFAULTS.reps;
  return {
    slug: seed.slug,
    name: seed.name,
    aliases: seed.aliases ?? [],
    movementPattern: seed.pattern,
    primaryMuscles: seed.primary,
    secondaryMuscles: seed.secondary ?? [],
    requiredEquipment: seed.equipment,
    optionalEquipment: seed.optional ?? [],
    loadType: seed.load,
    isUnilateral: seed.unilateral ?? false,
    isCompound: seed.compound ?? false,
    complexity: seed.complexity ?? SEED_DEFAULTS.complexity,
    stimulusFatigueRatio: seed.sfr ?? SEED_DEFAULTS.sfr,
    defaultRepMin: repMin,
    defaultRepMax: repMax,
    substitutionGroup: seed.sub,
    setupNotes: seed.setup ?? null,
    cues: seed.cues ?? null,
    isCustom: false,
    isActive: true,
  };
}

const EQUIPMENT_PRESET_LABELS: Record<keyof typeof EQUIPMENT_PRESETS, string> = {
  commercial_gym: "Commercial Gym",
  home_gym: "Home Gym",
  hotel_gym: "Hotel Gym",
  hotel_room: "Hotel Room",
  bodyweight_only: "Bodyweight Only",
};

/**
 * Fields refreshed when a seeded exercise already exists.
 *
 * `excluded` is the Postgres pseudo-table holding the row that failed to insert,
 * so each field is rewritten with the incoming value. Written out explicitly
 * rather than generated, because the mapping from property name to column name
 * is exactly the kind of thing that silently breaks when derived.
 *
 * Deliberately omits `id` (set logs reference it) and `is_custom` (user-created
 * exercises are never produced by seeding).
 */
const EXCLUDED_SET = {
  name: sql`excluded.name`,
  aliases: sql`excluded.aliases`,
  movementPattern: sql`excluded.movement_pattern`,
  primaryMuscles: sql`excluded.primary_muscles`,
  secondaryMuscles: sql`excluded.secondary_muscles`,
  requiredEquipment: sql`excluded.required_equipment`,
  optionalEquipment: sql`excluded.optional_equipment`,
  loadType: sql`excluded.load_type`,
  isUnilateral: sql`excluded.is_unilateral`,
  isCompound: sql`excluded.is_compound`,
  complexity: sql`excluded.complexity`,
  stimulusFatigueRatio: sql`excluded.stimulus_fatigue_ratio`,
  defaultRepMin: sql`excluded.default_rep_min`,
  defaultRepMax: sql`excluded.default_rep_max`,
  substitutionGroup: sql`excluded.substitution_group`,
  setupNotes: sql`excluded.setup_notes`,
  cues: sql`excluded.cues`,
};

/**
 * Idempotent seed: safe to re-run after editing the library.
 *
 * Upserts on `slug` and never touches user-created exercises, so a reseed
 * corrects tags without discarding anything the user added, and without breaking
 * set logs that already reference an exercise row.
 */
export async function seedExercises(): Promise<{ count: number }> {
  const db = getDb();
  const rows = ALL_EXERCISE_SEEDS.map(seedToRow);

  // Chunked because the HTTP driver has a practical statement size limit.
  const CHUNK = 40;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(exercises)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target: exercises.slug, set: EXCLUDED_SET });
  }

  return { count: rows.length };
}

/** Creates the preset equipment profiles, unless the user already has some. */
export async function seedEquipmentProfiles(): Promise<number> {
  const db = getDb();
  const existing = await db.select({ id: equipmentProfiles.id }).from(equipmentProfiles).limit(1);
  if (existing.length > 0) return 0;

  const presets = Object.entries(EQUIPMENT_PRESETS) as [
    keyof typeof EQUIPMENT_PRESETS,
    Equipment[],
  ][];

  await db.insert(equipmentProfiles).values(
    presets.map(([key, equipment]) => ({
      name: EQUIPMENT_PRESET_LABELS[key],
      equipment,
      isDefault: key === "commercial_gym",
    })),
  );

  return presets.length;
}

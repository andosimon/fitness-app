import { asc, eq, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { equipmentProfiles, exercises } from "@/lib/db/schema";
import type { Equipment } from "@/lib/domain/types";

/**
 * Read access to the exercise library.
 *
 * Every export calls `requireAuth()` directly rather than relying on `proxy.ts`.
 * Server Functions are POST requests to the route where they are used, so a
 * matcher change could silently remove proxy coverage — the Next.js docs are
 * explicit about verifying inside each function instead.
 */

/** Fields the picker and browser need. Excludes prose to keep the payload small. */
export type ExerciseListItem = {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  movementPattern: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  requiredEquipment: string[];
  loadType: string;
  isUnilateral: boolean;
  isCompound: boolean;
  complexity: number;
  stimulusFatigueRatio: number;
  defaultRepMin: number;
  defaultRepMax: number;
  substitutionGroup: string | null;
};

/**
 * Returns the whole library in one query.
 *
 * Deliberately unpaginated: at ~200 rows this is a small payload, and shipping
 * it whole means search and filtering happen instantly on the client and keep
 * working with no connection — which matters, because the exercise picker is
 * used mid-session in gyms with unreliable signal.
 */
export async function listExercises(): Promise<ExerciseListItem[]> {
  await requireAuth();

  return getDb()
    .select({
      id: exercises.id,
      slug: exercises.slug,
      name: exercises.name,
      aliases: exercises.aliases,
      movementPattern: exercises.movementPattern,
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
      requiredEquipment: exercises.requiredEquipment,
      loadType: exercises.loadType,
      isUnilateral: exercises.isUnilateral,
      isCompound: exercises.isCompound,
      complexity: exercises.complexity,
      stimulusFatigueRatio: exercises.stimulusFatigueRatio,
      defaultRepMin: exercises.defaultRepMin,
      defaultRepMax: exercises.defaultRepMax,
      substitutionGroup: exercises.substitutionGroup,
    })
    .from(exercises)
    .where(eq(exercises.isActive, true))
    .orderBy(asc(exercises.name)) as Promise<ExerciseListItem[]>;
}

export async function getExerciseBySlug(slug: string) {
  await requireAuth();

  const rows = await getDb().select().from(exercises).where(eq(exercises.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export type EquipmentProfileSummary = {
  id: string;
  name: string;
  equipment: Equipment[];
  isDefault: boolean;
};

export async function listEquipmentProfiles(): Promise<EquipmentProfileSummary[]> {
  await requireAuth();

  return getDb()
    .select({
      id: equipmentProfiles.id,
      name: equipmentProfiles.name,
      equipment: equipmentProfiles.equipment,
      isDefault: equipmentProfiles.isDefault,
    })
    .from(equipmentProfiles)
    .orderBy(asc(equipmentProfiles.name)) as Promise<EquipmentProfileSummary[]>;
}

/**
 * Exercises performable with a given set of equipment.
 *
 * Uses Postgres array containment (`<@`) so the constraint is enforced in the
 * database: an exercise appears only when *every* item it requires is available.
 * This is the mechanism that stops a hotel-room session prescribing a squat rack.
 *
 * Unused by the browser (which filters client-side) but this is the query the
 * generation engine will build on, so it lives here with the others.
 */
export async function listAvailableExercises(available: Equipment[]) {
  await requireAuth();

  return getDb()
    .select({ id: exercises.id, slug: exercises.slug, name: exercises.name })
    .from(exercises)
    .where(
      sql`${exercises.isActive} = true and ${exercises.requiredEquipment} <@ ${available}::text[]`,
    )
    .orderBy(asc(exercises.name));
}

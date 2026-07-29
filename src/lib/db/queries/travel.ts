import { asc, eq } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { equipmentProfiles, exercises, plannedExercises } from "@/lib/db/schema";
import type { Equipment } from "@/lib/domain/types";
import {
  adaptSessionToEquipment,
  describeAdaptation,
  type AdaptedSession,
} from "@/lib/engine/adapt";
import type { SelectableExercise } from "@/lib/engine/selection";

/**
 * Travel mode: re-fitting a planned session to whatever equipment is on hand.
 *
 * The adaptation itself is pure and lives in the engine; this loads the planned
 * session and the library, and returns something the UI can render.
 */

export type AdaptedSessionView = {
  profileId: string;
  profileName: string;
  summary: string;
  kept: number;
  substituted: number;
  dropped: number;
  uncovered: { muscle: string; sets: number }[];
  rows: {
    plannedExerciseId: string;
    originalName: string;
    replacementName: string | null;
    replacementExerciseId: string | null;
    sets: number;
    repMin: number | null;
    repMax: number | null;
    outcome: AdaptedSession["exercises"][number]["outcome"];
    note: string;
  }[];
};

async function loadLibrary(): Promise<SelectableExercise[]> {
  const rows = await getDb().select().from(exercises).where(eq(exercises.isActive, true));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    movementPattern: r.movementPattern,
    primaryMuscles: r.primaryMuscles,
    secondaryMuscles: r.secondaryMuscles,
    requiredEquipment: r.requiredEquipment,
    loadType: r.loadType,
    isCompound: r.isCompound,
    isUnilateral: r.isUnilateral,
    complexity: r.complexity,
    stimulusFatigueRatio: r.stimulusFatigueRatio,
    defaultRepMin: r.defaultRepMin,
    defaultRepMax: r.defaultRepMax,
    substitutionGroup: r.substitutionGroup,
  }));
}

export async function adaptPlannedSession(
  plannedSessionId: string,
  equipmentProfileId: string,
): Promise<AdaptedSessionView | null> {
  await requireAuth();
  return unsafe_adaptPlannedSession(plannedSessionId, equipmentProfileId);
}

/** See the note on `unsafe_createProgram` in ./programs. */
export async function unsafe_adaptPlannedSession(
  plannedSessionId: string,
  equipmentProfileId: string,
): Promise<AdaptedSessionView | null> {
  const db = getDb();

  const [profile] = await db
    .select()
    .from(equipmentProfiles)
    .where(eq(equipmentProfiles.id, equipmentProfileId))
    .limit(1);
  if (!profile) return null;

  const rows = await db
    .select({
      plannedExerciseId: plannedExercises.id,
      sets: plannedExercises.sets,
      repMin: plannedExercises.repMin,
      repMax: plannedExercises.repMax,
      supersetGroup: plannedExercises.supersetGroup,
      orderIndex: plannedExercises.orderIndex,
      exercise: exercises,
    })
    .from(plannedExercises)
    .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
    .where(eq(plannedExercises.plannedSessionId, plannedSessionId))
    .orderBy(asc(plannedExercises.orderIndex));

  if (rows.length === 0) return null;

  const library = await loadLibrary();

  const adapted = adaptSessionToEquipment({
    planned: rows.map((r) => ({
      plannedExerciseId: r.plannedExerciseId,
      supersetGroup: r.supersetGroup,
      sets: r.sets,
      exercise: {
        id: r.exercise.id,
        slug: r.exercise.slug,
        name: r.exercise.name,
        movementPattern: r.exercise.movementPattern,
        primaryMuscles: r.exercise.primaryMuscles,
        secondaryMuscles: r.exercise.secondaryMuscles,
        requiredEquipment: r.exercise.requiredEquipment,
        loadType: r.exercise.loadType,
        isCompound: r.exercise.isCompound,
        isUnilateral: r.exercise.isUnilateral,
        complexity: r.exercise.complexity,
        stimulusFatigueRatio: r.exercise.stimulusFatigueRatio,
        defaultRepMin: r.exercise.defaultRepMin,
        defaultRepMax: r.exercise.defaultRepMax,
        substitutionGroup: r.exercise.substitutionGroup,
      },
    })),
    availableEquipment: profile.equipment as Equipment[],
    library,
  });

  const byPlannedId = new Map(rows.map((r) => [r.plannedExerciseId, r]));

  return {
    profileId: profile.id,
    profileName: profile.name,
    summary: describeAdaptation(adapted),
    kept: adapted.kept,
    substituted: adapted.substituted,
    dropped: adapted.dropped,
    uncovered: adapted.uncovered.map((u) => ({ muscle: u.muscle, sets: u.sets })),
    rows: adapted.exercises.map((item) => {
      const source = byPlannedId.get(item.plannedExerciseId);
      return {
        plannedExerciseId: item.plannedExerciseId,
        originalName: item.original.name,
        replacementName: item.replacement?.name ?? null,
        replacementExerciseId: item.replacement?.id ?? null,
        sets: item.sets,
        // A substitute keeps the prescribed reps where the planned exercise had
        // them; otherwise it falls back to the substitute's own sensible range,
        // since a rep target set for a barbell lift may not suit a band.
        repMin: item.outcome === "kept" ? (source?.repMin ?? null) : (item.replacement?.defaultRepMin ?? null),
        repMax: item.outcome === "kept" ? (source?.repMax ?? null) : (item.replacement?.defaultRepMax ?? null),
        outcome: item.outcome,
        note: item.note,
      };
    }),
  };
}

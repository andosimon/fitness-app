import { AppNav } from "@/components/app-nav";
import { SessionView, type PlannedSessionProp } from "@/components/session/session-view";
import { listEquipmentProfiles, listExercises } from "@/lib/db/queries/exercises";
import { getRecentFatigue, suggestLoadsForSession } from "@/lib/db/queries/progression";
import {
  getNextPlannedSession,
  getPlannedSessionById,
  listUpcomingSessions,
} from "@/lib/db/queries/programs";
import type { Equipment } from "@/lib/domain/types";
import type { CachedExercise } from "@/lib/offline/db";

export const metadata = {
  title: "Today · Fitness Tracker",
};

/**
 * The logging screen.
 *
 * The exercise library is fetched server-side and handed to the client, which
 * mirrors it into IndexedDB, so the picker keeps working with no connection.
 *
 * `?session=` selects a specific planned session. Without it the next one in
 * plan order is shown, but the plan is a queue rather than a schedule — turning
 * up wanting to squat should not mean logging ad-hoc because the sequence said
 * upper body.
 */
export default async function TodayPage(props: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: chosenId } = await props.searchParams;

  const [exercises, profiles, upcoming, planned] = await Promise.all([
    listExercises(),
    listEquipmentProfiles(),
    listUpcomingSessions(),
    chosenId ? getPlannedSessionById(chosenId) : getNextPlannedSession(),
  ]);

  const defaultProfile = profiles.find((p) => p.isDefault) ?? profiles[0];

  // Load suggestions come from logged history, so they only exist once there is
  // some. A first-time exercise says so rather than inventing a number.
  const [suggestions, fatigue] = await Promise.all([
    planned
      ? suggestLoadsForSession(
          planned.exercises.map((row) => ({
            plannedExerciseId: row.id,
            exerciseId: row.exerciseId,
            loadType: row.loadType,
            repMin: row.repMin,
            repMax: row.repMax,
            targetRir: row.targetRir,
            targetRpe: row.targetRpe,
            targetPercent1rm: row.targetPercent1rm,
          })),
        )
      : Promise.resolve([]),
    getRecentFatigue(planned?.exercises[0]?.targetRir ?? 2),
  ]);

  const byPlannedExercise = new Map(suggestions.map((s) => [s.plannedExerciseId, s]));

  const plannedProp: PlannedSessionProp = planned
    ? {
        id: planned.id,
        name: planned.name,
        weekNumber: planned.weekNumber,
        isDeload: planned.isDeload,
        targetMinutes: planned.targetMinutes,
        programId: planned.programId,
        programName: planned.programName,
        notes: planned.notes,
        exercises: planned.exercises.map((row) => {
          const suggestion = byPlannedExercise.get(row.id);
          return {
            id: row.id,
            exerciseId: row.exerciseId,
            exerciseName: row.exerciseName,
            sets: row.sets,
            repMin: row.repMin,
            repMax: row.repMax,
            targetRir: row.targetRir,
            targetRpe: row.targetRpe,
            targetPercent1rm: row.targetPercent1rm,
            supersetGroup: row.supersetGroup,
            tempo: row.tempo,
            notes: row.notes,
            suggestedLoadKg: suggestion?.loadKg ?? null,
            suggestionReason: suggestion?.reason ?? null,
            estimatedOneRepMax: suggestion?.estimatedOneRepMax ?? null,
          };
        }),
      }
    : null;

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16">
        <SessionView
          exercises={exercises as CachedExercise[]}
          planned={plannedProp}
          upcoming={upcoming}
          availableEquipment={(defaultProfile?.equipment ?? []) as Equipment[]}
          equipmentProfileName={defaultProfile?.name ?? null}
          fatigue={fatigue.setsExamined >= 4 ? { status: fatigue.status, note: fatigue.note } : null}
        />
      </main>
    </>
  );
}

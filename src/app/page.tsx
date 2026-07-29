import { AppNav } from "@/components/app-nav";
import { SessionView, type PlannedSessionProp } from "@/components/session/session-view";
import { listEquipmentProfiles, listExercises } from "@/lib/db/queries/exercises";
import { getRecentFatigue, suggestLoadsForSession } from "@/lib/db/queries/progression";
import { adaptPlannedSession } from "@/lib/db/queries/travel";
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
  searchParams: Promise<{ session?: string; equipment?: string }>;
}) {
  const { session: chosenId, equipment: equipmentId } = await props.searchParams;

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

  /**
   * Travel mode. Re-fits the planned session to different kit, substituting only
   * what the equipment forces and reporting anything it cannot cover.
   */
  const adapted =
    planned && equipmentId && equipmentId !== defaultProfile?.id
      ? await adaptPlannedSession(planned.id, equipmentId)
      : null;

  const adaptedByPlannedId = new Map(
    (adapted?.rows ?? []).map((row) => [row.plannedExerciseId, row]),
  );

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
          const swap = adaptedByPlannedId.get(row.id);

          // Under travel mode the row shows what will actually be performed,
          // with the original named in the note so the swap is visible rather
          // than silent.
          const name = swap
            ? (swap.replacementName ?? `${row.exerciseName} — not possible here`)
            : row.exerciseName;

          return {
            id: row.id,
            exerciseId: swap?.replacementExerciseId ?? row.exerciseId,
            exerciseName: name,
            sets: row.sets,
            repMin: swap ? swap.repMin : row.repMin,
            repMax: swap ? swap.repMax : row.repMax,
            targetRir: row.targetRir,
            targetRpe: row.targetRpe,
            targetPercent1rm: row.targetPercent1rm,
            supersetGroup: row.supersetGroup,
            tempo: row.tempo,
            notes: swap && swap.outcome !== "kept" ? swap.note : row.notes,
            // Loads are keyed to the planned exercise, so a substitution
            // invalidates them — offering last week's bench load for a push-up
            // would be worse than offering nothing.
            suggestedLoadKg: swap && swap.outcome !== "kept" ? null : (suggestion?.loadKg ?? null),
            suggestionReason:
              swap && swap.outcome !== "kept" ? null : (suggestion?.reason ?? null),
            estimatedOneRepMax:
              swap && swap.outcome !== "kept" ? null : (suggestion?.estimatedOneRepMax ?? null),
            unavailable: swap?.outcome === "dropped",
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
          availableEquipment={
            (adapted
              ? (profiles.find((p) => p.id === adapted.profileId)?.equipment ?? [])
              : (defaultProfile?.equipment ?? [])) as Equipment[]
          }
          equipmentProfileName={adapted?.profileName ?? defaultProfile?.name ?? null}
          fatigue={fatigue.setsExamined >= 4 ? { status: fatigue.status, note: fatigue.note } : null}
          equipmentProfiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
          activeEquipmentId={adapted?.profileId ?? defaultProfile?.id ?? null}
          adaptationSummary={adapted?.summary ?? null}
        />
      </main>
    </>
  );
}

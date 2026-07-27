import { AppNav } from "@/components/app-nav";
import { SessionView, type PlannedSessionProp } from "@/components/session/session-view";
import { listExercises } from "@/lib/db/queries/exercises";
import { getNextPlannedSession } from "@/lib/db/queries/programs";
import type { CachedExercise } from "@/lib/offline/db";

export const metadata = {
  title: "Today · Fitness Tracker",
};

/**
 * The logging screen.
 *
 * The exercise library is fetched server-side and handed to the client, which
 * mirrors it into IndexedDB, so the picker keeps working with no connection.
 * The next planned session comes from the active programme; without one, the
 * screen falls back to ad-hoc logging.
 */
export default async function TodayPage() {
  const [exercises, planned] = await Promise.all([listExercises(), getNextPlannedSession()]);

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
        exercises: planned.exercises.map((row) => ({
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
        })),
      }
    : null;

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16">
        <SessionView exercises={exercises as CachedExercise[]} planned={plannedProp} />
      </main>
    </>
  );
}

import { AppNav } from "@/components/app-nav";
import { listEquipmentProfiles, listExercises } from "@/lib/db/queries/exercises";

import { ExerciseBrowser } from "./exercise-browser";

export const metadata = {
  title: "Exercises · Fitness Tracker",
};

export default async function ExercisesPage() {
  // Both queries call requireAuth() internally.
  const [exercises, profiles] = await Promise.all([listExercises(), listEquipmentProfiles()]);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <ExerciseBrowser exercises={exercises} profiles={profiles} />
      </main>
    </>
  );
}

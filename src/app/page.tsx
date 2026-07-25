import { AppNav } from "@/components/app-nav";
import { SessionView } from "@/components/session/session-view";
import { listExercises } from "@/lib/db/queries/exercises";
import type { CachedExercise } from "@/lib/offline/db";

export const metadata = {
  title: "Today · Fitness Tracker",
};

/**
 * The logging screen.
 *
 * The exercise library is fetched server-side and handed to the client, which
 * mirrors it into IndexedDB. After the first successful load the picker keeps
 * working with no connection.
 */
export default async function TodayPage() {
  const exercises = await listExercises();

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16">
        <SessionView exercises={exercises as CachedExercise[]} />
      </main>
    </>
  );
}

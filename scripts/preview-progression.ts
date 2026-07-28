/**
 * Shows what progression makes of the logged history.
 *
 * Run with: npm run progress
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { exercises, sessions, setLogs } from "@/lib/db/schema";
import {
  bestEstimateFrom,
  incrementForLoadType,
  readFatigue,
  suggestLoad,
  type LoggedSet,
} from "@/lib/engine/progression";

async function main() {
  const db = getDb();

  // Every compound lift with logged work.
  const rows = await db
    .select({
      exerciseId: setLogs.exerciseId,
      name: exercises.name,
      loadType: exercises.loadType,
      repMin: exercises.defaultRepMin,
      repMax: exercises.defaultRepMax,
      sessionId: setLogs.sessionId,
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      completedAt: setLogs.completedAt,
      isWarmup: setLogs.isWarmup,
      startedAt: sessions.startedAt,
    })
    .from(setLogs)
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .innerJoin(sessions, eq(sessions.id, setLogs.sessionId))
    .orderBy(desc(sessions.startedAt), desc(setLogs.completedAt));

  const byExercise = new Map<string, typeof rows>();
  for (const r of rows) byExercise.set(r.exerciseId, [...(byExercise.get(r.exerciseId) ?? []), r]);

  console.log("Estimated maxima and next-session loads\n");
  console.log(
    "exercise".padEnd(30) + "last".padStart(14) + "e1RM".padStart(8) + "   next session",
  );
  console.log("-".repeat(100));

  for (const [, sets] of byExercise) {
    const first = sets[0];
    const asLogged: LoggedSet[] = sets.map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
      rpe: s.rpe,
      completedAt: s.completedAt,
      isWarmup: s.isWarmup,
    }));

    const latest = first.sessionId;
    const lastSession = asLogged.filter((_, i) => sets[i].sessionId === latest);

    const best = bestEstimateFrom(asLogged);
    const suggestion = suggestLoad({
      lastSession,
      allHistory: asLogged,
      targetRepMin: first.repMin,
      targetRepMax: first.repMax,
      targetRir: 2,
      targetRpe: null,
      targetPercent1rm: null,
      incrementKg: incrementForLoadType(first.loadType),
    });

    const heaviest = lastSession.reduce(
      (m, s) => ((s.weightKg ?? 0) > (m.weightKg ?? 0) ? s : m),
      lastSession[0],
    );
    const lastText = heaviest?.weightKg != null ? `${heaviest.weightKg}x${heaviest.reps}` : "—";

    console.log(
      first.name.padEnd(30) +
        lastText.padStart(14) +
        (best ? `${Math.round(best.oneRepMax)}` : "—").padStart(8) +
        `   ${suggestion.loadKg != null ? `${suggestion.loadKg} kg` : "—"}  ${suggestion.reason}`,
    );
  }

  const all: LoggedSet[] = rows.map((s) => ({
    weightKg: s.weightKg,
    reps: s.reps,
    rir: s.rir,
    rpe: s.rpe,
    completedAt: s.completedAt,
    isWarmup: s.isWarmup,
  }));
  const fatigue = readFatigue(all, 2);
  console.log(`\nFatigue (${fatigue.setsExamined} sets): ${fatigue.status}`);
  console.log(`  ${fatigue.note}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

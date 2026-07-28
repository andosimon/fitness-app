/**
 * Shows the load suggestions for the next planned session.
 *
 * Run with: npm run suggest
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { unsafe_getNextPlannedSession } from "@/lib/db/queries/programs";
import { unsafe_suggestLoadsForSession } from "@/lib/db/queries/progression";

async function main() {
  const planned = await unsafe_getNextPlannedSession();
  if (!planned) {
    console.log("no planned session");
    return;
  }

  console.log(`${planned.name} — week ${planned.weekNumber}\n`);

  const suggestions = await unsafe_suggestLoadsForSession(
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
  );

  const byId = new Map(suggestions.map((s) => [s.plannedExerciseId, s]));
  for (const row of planned.exercises) {
    const s = byId.get(row.id);
    const load = s?.loadKg != null ? `${s.loadKg} kg` : "—";
    console.log(`${row.exerciseName.padEnd(32)} ${load.padStart(9)}  [${s?.confidence}]`);
    if (s?.reason) console.log(`   ${s.reason}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

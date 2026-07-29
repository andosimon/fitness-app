/**
 * Shows how the next planned session adapts to each equipment profile.
 *
 * Run with: npm run travel
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { asc } from "drizzle-orm";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { equipmentProfiles, exercises } from "@/lib/db/schema";
import { unsafe_getNextPlannedSession } from "@/lib/db/queries/programs";
import { unsafe_adaptPlannedSession } from "@/lib/db/queries/travel";

async function main() {
  const planned = await unsafe_getNextPlannedSession();
  if (!planned) {
    console.log("no planned session");
    return;
  }

  const profiles = await getDb()
    .select()
    .from(equipmentProfiles)
    .orderBy(asc(equipmentProfiles.name));

  console.log(`Adapting: ${planned.name} (week ${planned.weekNumber})\n`);

  const allExercises = await getDb().select().from(exercises).where(eq(exercises.isActive, true));
  const byId = new Map(allExercises.map((e) => [e.id, e]));

  for (const profile of profiles) {
    const adapted = await unsafe_adaptPlannedSession(planned.id, profile.id);
    if (!adapted) continue;

    console.log(`${profile.name} — ${adapted.summary}`);

    for (const row of adapted.rows) {
      if (row.outcome === "kept") continue;
      const label =
        row.outcome === "dropped"
          ? `dropped: ${row.originalName}`
          : `${row.originalName} -> ${row.replacementName}`;
      console.log(`   ${label}`);
    }

    /*
     * The invariant that matters: nothing prescribed may require kit that is
     * not there. Checked against the library rather than trusted, because a
     * travel session that quietly asks for a barbell is worse than no session.
     */
    const violations = adapted.rows
      .filter((r) => r.replacementExerciseId)
      .filter((r) => {
        const ex = byId.get(r.replacementExerciseId!);
        return ex ? !ex.requiredEquipment.every((k) => profile.equipment.includes(k)) : false;
      });
    console.log(
      violations.length === 0
        ? "   ✓ every prescribed exercise is performable here"
        : `   ✗ ${violations.length} require absent equipment: ${violations.map((v) => v.replacementName).join(", ")}`,
    );
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

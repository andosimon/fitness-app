/**
 * Generates and stores a programme, then reads back what Today would show.
 *
 * Exercises the same path the UI uses â€” engine, persistence, then the query
 * that drives the logging screen â€” so the integration is verified end to end
 * rather than only in the browser.
 *
 * Run with: npm run generate
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { equipmentProfiles } from "@/lib/db/schema";
import {
  unsafe_createProgram,
  unsafe_getActiveProgram,
  unsafe_getNextPlannedSession,
} from "@/lib/db/queries/programs";
import type { MovementPattern, SplitType } from "@/lib/domain/types";

const SPLIT = (process.argv[2] as SplitType) ?? "upper_lower";
const SPECIALISE = process.argv[3] as MovementPattern | undefined;

async function main() {
  const [profile] = await getDb()
    .select()
    .from(equipmentProfiles)
    .where(eq(equipmentProfiles.name, "Home Gym"))
    .limit(1);

  const id = await unsafe_createProgram({
    name: `${SPLIT}${SPECIALISE ? ` Â· ${SPECIALISE} focus` : ""}`,
    daysPerWeek: 4,
    minutesPerSession: 45,
    goalWeights: { strength: 0.5, hypertrophy: 0.5 },
    experience: "advanced",
    splitType: SPLIT,
    weeks: 4,
    equipmentProfileId: profile.id,
    specialisationPattern: SPECIALISE,
  });
  console.log(`created programme ${id.slice(0, 8)}\n`);

  const program = await unsafe_getActiveProgram();
  console.log(`${program!.name} â€” ${program!.sessions.length} sessions over ${program!.totalWeeks} weeks`);
  if (program!.notes) console.log(`\n${program!.notes}\n`);

  const next = await unsafe_getNextPlannedSession();
  if (!next) {
    console.log("no next session");
    return;
  }

  console.log(`Next up: ${next.name} (week ${next.weekNumber}${next.isDeload ? ", deload" : ""})`);
  for (const row of next.exercises) {
    const reps = row.repMin === row.repMax ? `${row.repMin}` : `${row.repMin}-${row.repMax}`;
    const cue =
      row.targetRpe !== null
        ? `RPE ${row.targetRpe}${row.targetPercent1rm ? ` (~${Math.round(row.targetPercent1rm)}%)` : ""}`
        : row.targetRir !== null
          ? `RIR ${row.targetRir}`
          : "";
    const ss = row.supersetGroup ? ` [${row.supersetGroup}]` : "";
    console.log(`   ${row.exerciseName.padEnd(34)} ${row.sets} x ${reps} @ ${cue}${ss}`);
    if (row.tempo) console.log(`   ${" ".repeat(34)} ${row.tempo}`);
    if (row.notes) console.log(`   ${" ".repeat(34)} ${row.notes}`);
  }
}

// No process.exit: the Neon HTTP driver keeps a handle briefly and forcing exit
// trips a libuv assertion on Windows.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

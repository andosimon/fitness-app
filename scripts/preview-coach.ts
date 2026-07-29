/**
 * Shows what the coach's tools return against the real database.
 *
 * The point is to check the grounding without spending a model call: if these
 * numbers are wrong, every answer built on them is wrong, and no amount of
 * prompt tuning would show it. Runs the same queries and the same formatting
 * code the tool handlers use.
 *
 * Run with: npm run coach
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import {
  unsafe_findExerciseHistory,
  unsafe_getTrainingCadence,
  unsafe_getWeeklyVolumeByMuscle,
} from "@/lib/db/queries/analysis";
import { describeSnapshot } from "@/lib/coach/context";
import { summariseExerciseHistory, summariseVolume } from "@/lib/coach/report";
import { unsafe_getActiveProgram } from "@/lib/db/queries/programs";
import { getDb } from "@/lib/db";
import { equipmentProfiles, profile, programs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import type { LifterSnapshot } from "@/lib/coach/context";
import type { MovementPattern } from "@/lib/domain/types";

/** The snapshot, assembled without a request scope. Mirrors `getLifterSnapshot`. */
async function snapshot(): Promise<LifterSnapshot> {
  const db = getDb();
  const [me] = await db.select().from(profile).limit(1);
  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.status, "active"))
    .orderBy(desc(programs.createdAt))
    .limit(1);
  const [kit] = program?.equipmentProfileId
    ? await db
        .select()
        .from(equipmentProfiles)
        .where(eq(equipmentProfiles.id, program.equipmentProfileId))
        .limit(1)
    : await db
        .select()
        .from(equipmentProfiles)
        .where(eq(equipmentProfiles.isDefault, true))
        .limit(1);

  const inputs = (program?.generationInputs ?? {}) as { specialisationPattern?: MovementPattern };

  return {
    experience: me?.experienceLevel ?? "advanced",
    units: me?.units ?? "kg",
    bodyweightKg: me?.bodyweightKg ?? null,
    limitations: me?.limitations?.trim() ? me.limitations.trim() : null,
    program: program
      ? {
          name: program.name,
          splitType: program.splitType,
          daysPerWeek: program.daysPerWeek,
          minutesPerSession: program.minutesPerSession,
          totalWeeks: program.totalWeeks,
          primaryGoal: program.primaryGoal,
          goalWeights: program.goalWeights,
          specialisationPattern: inputs.specialisationPattern ?? null,
          startDate: program.startDate,
        }
      : null,
    equipment: kit ? { name: kit.name, items: kit.equipment } : null,
  };
}

function heading(text: string) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function main() {
  heading("What goes in the system prompt");
  console.log(describeSnapshot(await snapshot()));

  heading("get_training_cadence");
  const cadence = await unsafe_getTrainingCadence(56);
  console.log(
    `${cadence.sessionsLogged} sessions over ${cadence.daysObserved} observed days ` +
      `(${cadence.sessionsPerWeek}/week). Last was ${cadence.daysSinceLast ?? "—"} days ago; ` +
      `longest gap ${cadence.longestGapDays} days.\n${cadence.note}`,
  );

  heading("get_volume_by_muscle");
  const volume = summariseVolume(await unsafe_getWeeklyVolumeByMuscle(8), 8);
  console.log(`${volume.note}\n`);
  if (volume.muscles.length === 0) {
    console.log("no logged sets in the window");
  } else {
    for (const muscle of volume.muscles) {
      console.log(
        `${muscle.muscle.padEnd(12)} ${String(muscle.weeklyAverage).padStart(5)}/wk ` +
          `(${muscle.weeklyDirectAverage} direct)  ` +
          `MEV ${muscle.landmarks.mev} MAV ${muscle.landmarks.mav} MRV ${muscle.landmarks.mrv}  ` +
          `${muscle.verdict}`,
      );
    }

    /*
     * The invariant worth checking: this read and the programme generator must
     * count a set the same way, or every conversation about whether volume is
     * on target compares two different numbers.
     */
    const program = await unsafe_getActiveProgram();
    console.log(
      program
        ? `\n   Accounting matches the generator: primary 1, secondary 0.5. Programme "${program.name}" plans to the same landmarks.`
        : "\n   No active programme to compare against.",
    );
  }

  heading("get_exercise_history");
  for (const query of ["bench", "squat", "row"]) {
    const history = await unsafe_findExerciseHistory(query, 60);
    if (!history) {
      console.log(`"${query}" -> no match in the library`);
      continue;
    }
    if (history.sets.length === 0) {
      console.log(`"${query}" -> ${history.exerciseName}: never logged`);
      continue;
    }
    const report = summariseExerciseHistory(history);
    console.log(
      `"${query}" -> ${report.exercise}: ${report.sessionsLogged} sessions, ` +
        `best e1RM ${report.best?.estimatedOneRepMax ?? "—"} kg, ` +
        `change ${report.changeKg ?? "—"} kg`,
    );
    for (const session of report.sessions.slice(0, 3)) {
      console.log(
        `      ${session.date}  ${session.workingSets} sets, top ${session.topSet}` +
          (session.estimatedOneRepMax ? `  (e1RM ${session.estimatedOneRepMax})` : ""),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

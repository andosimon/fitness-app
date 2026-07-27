/**
 * Generates a week of sessions against the real library and prints them.
 *
 * The unit tests prove each module in isolation; this is the integration check
 * that the composed output is a programme someone would actually run.
 *
 * Run with: npm run program
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { eq } from "drizzle-orm";

import { FOUNDATIONAL_PATTERNS, type Equipment, type MovementPattern, type MuscleGroup, type SplitType } from "@/lib/domain/types";
import { getDb } from "@/lib/db";
import { equipmentProfiles, exercises } from "@/lib/db/schema";
import {
  chooseAnchorPatterns,
  selectSessionExercises,
  type SelectableExercise,
} from "@/lib/engine/selection";
import { buildRotation, isRollingSchedule } from "@/lib/engine/splits";
import { budgetSession } from "@/lib/engine/time-budget";
import { distributeAcrossSessions, planWeeklyVolume } from "@/lib/engine/volume";

const SPLIT: SplitType = (process.argv[2] as SplitType) ?? "upper_lower";
const DAYS = 4;
const MINUTES = 45;
const GOALS = { strength: 0.5, hypertrophy: 0.5 };

async function main() {
  const db = getDb();

  const [profile] = await db
    .select()
    .from(equipmentProfiles)
    .where(eq(equipmentProfiles.name, "Home Gym"))
    .limit(1);

  const rows = await db.select().from(exercises).where(eq(exercises.isActive, true));
  const library: SelectableExercise[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    movementPattern: r.movementPattern,
    primaryMuscles: r.primaryMuscles,
    secondaryMuscles: r.secondaryMuscles,
    requiredEquipment: r.requiredEquipment,
    loadType: r.loadType,
    isCompound: r.isCompound,
    isUnilateral: r.isUnilateral,
    complexity: r.complexity,
    stimulusFatigueRatio: r.stimulusFatigueRatio,
    defaultRepMin: r.defaultRepMin,
    defaultRepMax: r.defaultRepMax,
    substitutionGroup: r.substitutionGroup,
  }));

  const budget = budgetSession(MINUTES, GOALS);
  const capacity = budget.totalSets * DAYS;
  const plan = planWeeklyVolume({
    goals: GOALS,
    experience: "advanced",
    capacityWeeklySets: capacity,
  });
  const perSession = distributeAcrossSessions(plan.weeklySets, SPLIT, DAYS);

  console.log(
    `${SPLIT} · ${DAYS} days · ${MINUTES} min · ${budget.totalSets} sets/session` +
      `${isRollingSchedule(SPLIT, DAYS) ? " · rolling" : ""}\n`,
  );

  const rotation = buildRotation(SPLIT, DAYS, 1)[0];
  const seenDayKeys = new Map<string, number>();

  for (const [index, day] of rotation.entries()) {
    const variant = seenDayKeys.get(day.key) ?? 0;
    seenDayKeys.set(day.key, variant + 1);

    const muscleTargets: Partial<Record<MuscleGroup, number>> = {};
    for (const target of perSession) {
      if (day.muscles.includes(target.muscle)) {
        muscleTargets[target.muscle] = target.setsPerSession;
      }
    }

    // One anchor per movement family, so an upper day never ends up with two
    // presses and no pull.
    const anchorPatterns = chooseAnchorPatterns(
      day.patterns,
      FOUNDATIONAL_PATTERNS as MovementPattern[],
      variant,
    );

    const session = selectSessionExercises({
      day,
      muscleTargets,
      secondsBudget: MINUTES * 60,
      anchorPatterns,
      setsPerAnchor: Math.max(3, Math.round(budget.heavySets / Math.max(1, anchorPatterns.length))),
      library,
      context: {
        availableEquipment: profile.equipment as Equipment[],
        blockIndex: 0,
        dayVariantIndex: variant,
        seed: "demo",
      },
    });

    const label = `${day.label}${seenDayKeys.get(day.key)! > 1 || variant > 0 ? ` ${String.fromCharCode(65 + variant)}` : ""}`;
    const mins = Math.floor(session.estimatedSeconds / 60);
    const secs = String(session.estimatedSeconds % 60).padStart(2, "0");
    console.log(
      `Day ${index + 1} — ${label}  (${session.totalSets} sets, ${mins}:${secs} of ${MINUTES}:00)`,
    );

    for (const item of session.exercises) {
      const tag = item.role === "anchor" ? "ANCHOR" : item.supersetGroup ? `SS ${item.supersetGroup}` : "     ";
      // Time- and distance-based work has no meaningful rep range.
      const dose = ["time", "distance", "calories"].includes(item.exercise.loadType)
        ? `${item.sets} x ${item.exercise.loadType}`
        : `${item.sets} x ${item.exercise.defaultRepMin}-${item.exercise.defaultRepMax}`;
      console.log(`   ${tag.padEnd(7)} ${item.exercise.name.padEnd(34)} ${dose}`);
    }
    if (session.shortfalls.length > 0) {
      console.log(
        `   shortfall: ${session.shortfalls.map((s) => `${s.muscle} ${s.delivered}/${s.target}`).join(", ")}`,
      );
    }
    console.log();
  }
}

// Deliberately no process.exit on success: the Neon HTTP driver keeps a handle
// briefly, and forcing exit trips a libuv assertion on Windows.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

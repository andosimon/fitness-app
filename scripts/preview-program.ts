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
import { prescribeSession } from "@/lib/engine/prescription";
import {
  chooseAnchorPatterns,
  selectSessionExercises,
  type SelectableExercise,
} from "@/lib/engine/selection";
import { planLiftSpecialisation } from "@/lib/engine/specialisation";
import { buildRotation, isRollingSchedule } from "@/lib/engine/splits";
import { budgetSession } from "@/lib/engine/time-budget";
import { distributeAcrossSessions, planWeeklyVolume } from "@/lib/engine/volume";

const SPLIT: SplitType = (process.argv[2] as SplitType) ?? "upper_lower";
/** Optional: a pattern to specialise, e.g. `npm run program -- upper_lower squat`. */
const SPECIALISE = process.argv[3] as MovementPattern | undefined;
const WEEK = Number(process.argv[4] ?? 2);
const BLOCK_LENGTH = 4;
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
    `${SPLIT} · ${DAYS} days · ${MINUTES} min · week ${WEEK} of ${BLOCK_LENGTH}` +
      `${SPECIALISE ? ` · specialising ${SPECIALISE}` : ""}` +
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

    const prescribed = prescribeSession({
      selected: session,
      goals: GOALS,
      weekInBlock: WEEK,
      blockLength: BLOCK_LENGTH,
      specialisation: SPECIALISE
        ? planLiftSpecialisation({
            pattern: SPECIALISE,
            split: SPLIT,
            daysPerWeek: DAYS,
            weeklySetsForPattern: 14,
          })
        : undefined,
    });

    for (const item of prescribed.exercises) {
      const { selected: sel } = item;
      const tag = sel.role === "anchor" ? "ANCHOR" : sel.supersetGroup ? `SS ${sel.supersetGroup}` : "     ";
      console.log(`   ${tag.padEnd(7)} ${sel.exercise.name.padEnd(32)} ${item.summary}`);
      for (const set of item.sets) {
        if (set.tempo || set.note) {
          console.log(`           ${" ".repeat(32)} set ${set.setNumber}: ${set.tempo ?? set.note}`);
        }
      }
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

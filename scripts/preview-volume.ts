/**
 * Prints weekly volume plans, so the numbers can be sanity-checked as a table.
 *
 * Run with: npm run volume
 */
import { budgetSession } from "@/lib/engine/time-budget";
import { planLiftSpecialisation } from "@/lib/engine/specialisation";
import { isRollingSchedule } from "@/lib/engine/splits";
import { distributeAcrossSessions, planWeeklyVolume } from "@/lib/engine/volume";
import type { MuscleGroup, SplitType } from "@/lib/domain/types";

const GOALS = { strength: 0.5, hypertrophy: 0.5 };
const DAYS = 4;
const MINUTES = 45;

const perSession = budgetSession(MINUTES, GOALS);
const capacity = perSession.totalSets * DAYS;

console.log(
  `${DAYS} sessions x ${MINUTES} min = ${perSession.totalSets} sets/session, ` +
    `${capacity} sets/week capacity\n`,
);

function show(label: string, priorityMuscles: MuscleGroup[] = []) {
  const plan = planWeeklyVolume({
    goals: GOALS,
    experience: "advanced",
    capacityWeeklySets: capacity,
    specialization: priorityMuscles.length ? { priorityMuscles } : undefined,
  });

  console.log(`${label}`);
  console.log(
    `  total ${plan.totalWeeklySets}/${capacity} sets` +
      (plan.scaledToFit ? " (scaled to fit the clock)" : "") +
      (plan.prioritised.length ? `  ·  priority: ${plan.prioritised.join(", ")}` : ""),
  );

  const sorted = (Object.entries(plan.weeklySets) as [MuscleGroup, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const line = sorted
    .slice(0, 10)
    .map(([m, n]) => `${m}:${n}`)
    .join("  ");
  console.log(`  ${line}\n`);
  return plan;
}

const base = show("Balanced");
show("Squat specialisation (quads + glutes prioritised)", ["quads", "glutes"]);

console.log("Same weekly volume under different splits (sets per session x frequency):\n");
const splits: SplitType[] = ["full_body", "upper_lower", "push_pull_legs"];
const watch: MuscleGroup[] = ["chest", "lats", "quads"];

console.log("  split".padEnd(20) + watch.map((m) => m.padStart(16)).join("") + "   schedule");
console.log("  " + "-".repeat(18 + watch.length * 16 + 14));
for (const split of splits) {
  const dist = distributeAcrossSessions(base.weeklySets, split, DAYS);
  const cells = watch.map((m) => {
    const t = dist.find((d) => d.muscle === m);
    if (!t) return "-".padStart(16);
    const freq = Math.round(t.sessionsPerWeek * 100) / 100;
    return `${t.setsPerSession} x ${freq}/wk`.padStart(16);
  });
  const rolling = isRollingSchedule(split, DAYS);
  console.log("  " + split.padEnd(18) + cells.join("") + `   ${rolling ? "rolling" : "fixed"}`);
}

console.log("\nSquat specialisation, expressed differently per split:\n");
for (const split of splits) {
  const plan = planLiftSpecialisation({
    pattern: "squat",
    split,
    daysPerWeek: DAYS,
    weeklySetsForPattern: 14,
  });
  console.log(`  ${split}`);
  console.log(`    ${plan.rationale}`);
  console.log(`    techniques: ${plan.techniques.join(", ")}\n`);
}

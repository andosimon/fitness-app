/**
 * Prints weekly volume plans, so the numbers can be sanity-checked as a table.
 *
 * Run with: npm run volume
 */
import { budgetSession } from "@/lib/engine/time-budget";
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

console.log("Same weekly volume under different splits (sets per session):\n");
const splits: SplitType[] = ["full_body", "upper_lower", "push_pull_legs"];
const watch: MuscleGroup[] = ["chest", "lats", "quads", "side_delts"];

console.log("  split".padEnd(20) + watch.map((m) => m.padStart(12)).join("") + "   freq");
console.log("  " + "-".repeat(18 + watch.length * 12 + 8));
for (const split of splits) {
  const dist = distributeAcrossSessions(base.weeklySets, split, DAYS);
  const cells = watch.map((m) => {
    const t = dist.find((d) => d.muscle === m);
    return (t ? `${t.setsPerSession}` : "-").padStart(12);
  });
  const freq = dist[0]?.sessionsPerWeek ?? 0;
  console.log("  " + split.padEnd(18) + cells.join("") + `   ${freq}x/wk`);
}

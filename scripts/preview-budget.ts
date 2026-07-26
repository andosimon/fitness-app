/**
 * Prints what the time budgeter prescribes across a range of scenarios.
 *
 * A development aid: the numbers are easier to sanity-check as a table than as
 * test assertions, and it makes the cost of ignoring rest intervals visible.
 *
 * Run with: npm run budget
 */
import { budgetSession } from "@/lib/engine/time-budget";
import type { GoalWeights } from "@/lib/domain/types";

const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const scenarios: { label: string; minutes: number; goals: GoalWeights }[] = [
  { label: "45 min · strength+hypertrophy", minutes: 45, goals: { strength: 0.5, hypertrophy: 0.5 } },
  { label: "45 min · strength only", minutes: 45, goals: { strength: 1 } },
  { label: "45 min · hypertrophy only", minutes: 45, goals: { hypertrophy: 1 } },
  { label: "30 min · strength+hypertrophy", minutes: 30, goals: { strength: 0.5, hypertrophy: 0.5 } },
  { label: "20 min · travel session", minutes: 20, goals: { hypertrophy: 0.7, fat_loss: 0.3 } },
  { label: "60 min · strength+hypertrophy", minutes: 60, goals: { strength: 0.5, hypertrophy: 0.5 } },
];

const header =
  "scenario".padEnd(32) +
  "heavy".padStart(6) +
  "mod".padStart(5) +
  "iso".padStart(5) +
  "total".padStart(7) +
  "used".padStart(8) +
  "budget".padStart(8) +
  "   as straight sets";

console.log(header);
console.log("-".repeat(header.length + 4));

for (const s of scenarios) {
  const b = budgetSession(s.minutes, s.goals);
  const overruns = b.straightSetSeconds > b.budgetSeconds;
  console.log(
    s.label.padEnd(32) +
      String(b.heavySets).padStart(6) +
      String(b.moderateSets).padStart(5) +
      String(b.isolationSets).padStart(5) +
      String(b.totalSets).padStart(7) +
      mins(b.estimatedSeconds).padStart(8) +
      mins(b.budgetSeconds).padStart(8) +
      `   ${mins(b.straightSetSeconds)}${overruns ? "  overruns" : ""}`,
  );
}

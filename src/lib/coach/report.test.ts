import { describe, expect, it } from "vitest";

import type { ExerciseHistory, MuscleWeek } from "@/lib/db/queries/analysis";

import { summariseExerciseHistory, summariseVolume, weekStart } from "./report";

const NOW = new Date("2026-07-29T10:00:00Z"); // A Wednesday.
const THIS_WEEK = weekStart(NOW); // 2026-07-27, Monday.

function week(offset: number): string {
  const d = new Date(Date.parse(THIS_WEEK));
  d.setUTCDate(d.getUTCDate() - offset * 7);
  return d.toISOString().slice(0, 10);
}

function row(weekOffset: number, muscle: string, sets: number, direct = sets): MuscleWeek {
  return {
    week: week(weekOffset),
    muscle: muscle as MuscleWeek["muscle"],
    sets,
    directSets: direct,
  };
}

describe("weekly volume against the landmarks", () => {
  it("averages over the weeks the data spans", () => {
    // Four completed weeks of 12 chest sets is 12 per week, not 48 and not 6.
    const report = summariseVolume(
      [row(1, "chest", 12), row(2, "chest", 12), row(3, "chest", 12), row(4, "chest", 12)],
      8,
      NOW,
    );
    expect(report.muscles[0].weeklyAverage).toBe(12);
  });

  it("keeps the in-progress week out of the average", () => {
    /*
     * Asked on a Wednesday, this week holds one session. Averaging it in would
     * make every midweek reading look like a volume collapse.
     */
    const report = summariseVolume(
      [row(0, "chest", 4), row(1, "chest", 14), row(2, "chest", 14)],
      8,
      NOW,
    );
    expect(report.muscles[0].weeklyAverage).toBe(14);
    expect(report.muscles[0].currentWeekSets).toBe(4);
  });

  it("counts training gaps rather than averaging them away", () => {
    // Trained hard eight weeks ago, nothing since. That is not "on target".
    const report = summariseVolume([row(1, "chest", 16), row(5, "chest", 16)], 8, NOW);
    expect(report.muscles[0].weeklyAverage).toBe(6.4);
    expect(report.muscles[0].verdict).toBe("below_mev");
  });

  it("does not punish someone two weeks into using the app", () => {
    // Dividing by the full eight-week window would report 4 sets a week and
    // send them chasing volume they are already doing.
    const report = summariseVolume([row(1, "chest", 16), row(2, "chest", 16)], 8, NOW);
    expect(report.muscles[0].weeklyAverage).toBe(16);
    expect(report.muscles[0].verdict).toBe("productive");
  });

  it("names the landmark that was crossed", () => {
    const low = summariseVolume([row(1, "chest", 4), row(2, "chest", 4)], 8, NOW);
    expect(low.muscles[0].verdict).toBe("below_mev");
    expect(low.muscles[0].note).toMatch(/minimum effective volume of 8/);

    const high = summariseVolume([row(1, "chest", 30), row(2, "chest", 30)], 8, NOW);
    expect(high.muscles[0].verdict).toBe("above_mrv");
    expect(high.muscles[0].note).toMatch(/maximum recoverable volume of 22/);
  });

  it("does not report indirectly-worked muscles as a gap", () => {
    /*
     * Front delts have a zero minimum because pressing hammers them. Calling
     * six sets "below MEV" would invite adding direct work that is already
     * being done twice over.
     */
    const report = summariseVolume([row(1, "front_delts", 6), row(2, "front_delts", 6)], 8, NOW);
    expect(report.muscles[0].verdict).toBe("indirect_only");
    expect(report.muscles[0].note).toMatch(/nothing to fix/i);
  });

  it("puts the problems first", () => {
    const report = summariseVolume(
      [
        row(1, "quads", 12),
        row(2, "quads", 12),
        row(1, "chest", 2),
        row(2, "chest", 2),
        row(1, "biceps", 30),
        row(2, "biceps", 30),
      ],
      8,
      NOW,
    );
    expect(report.muscles.map((r) => r.verdict)).toEqual(["above_mrv", "below_mev", "productive"]);
  });

  it("says how thin the data is instead of leaving it to be inferred", () => {
    /*
     * One completed week puts every muscle under MEV. That reads as a
     * programming problem when it is really a short history, so the divisor is
     * reported alongside the verdicts rather than hidden inside them.
     */
    const thin = summariseVolume([row(1, "chest", 6)], 8, NOW);
    expect(thin.weeksAveragedOver).toBe(1);
    expect(thin.note).toMatch(/too little to call anything a trend/i);

    const thick = summariseVolume(
      [row(1, "chest", 14), row(2, "chest", 14), row(3, "chest", 14), row(4, "chest", 14)],
      8,
      NOW,
    );
    expect(thick.weeksAveragedOver).toBe(4);
    expect(thick.note).not.toMatch(/too little/i);
  });

  it("says so when only the week in progress has anything in it", () => {
    const report = summariseVolume([row(0, "chest", 6)], 8, NOW);
    expect(report.note).toMatch(/no completed weeks/i);
    expect(report.muscles[0].currentWeekSets).toBe(6);
  });

  it("reports direct sets separately from credited ones", () => {
    // Half-credit from secondary involvement is real volume, but "how much
    // biceps work am I actually doing" is a question about curls.
    const report = summariseVolume([row(1, "biceps", 12, 4), row(2, "biceps", 12, 4)], 8, NOW);
    expect(report.muscles[0].weeklyAverage).toBe(12);
    expect(report.muscles[0].weeklyDirectAverage).toBe(4);
  });
});

// ---------------------------------------------------------------------------

function set(
  date: string,
  weightKg: number,
  reps: number,
  rir: number | null,
): ExerciseHistory["sets"][number] {
  return {
    performedAt: new Date(`${date}T18:00:00Z`),
    sessionName: "Upper A",
    weightKg,
    reps,
    rir,
    rpe: null,
    isAmrap: false,
  };
}

function history(sets: ExerciseHistory["sets"]): ExerciseHistory {
  return {
    exerciseId: "e1",
    exerciseName: "Barbell Bench Press",
    slug: "barbell-bench-press",
    loadType: "barbell",
    sets,
  };
}

describe("one exercise over time", () => {
  it("collapses sets to one row per session", () => {
    const report = summariseExerciseHistory(
      history([
        set("2026-07-20", 80, 6, 2),
        set("2026-07-20", 80, 5, 1),
        set("2026-07-13", 77.5, 6, 2),
      ]),
    );
    expect(report.sessionsLogged).toBe(2);
    expect(report.sessions[0].workingSets).toBe(2);
  });

  it("reports the heaviest set of each session, not the last", () => {
    const report = summariseExerciseHistory(
      history([set("2026-07-20", 70, 10, 3), set("2026-07-20", 90, 3, 1)]),
    );
    expect(report.sessions[0].topSet).toBe("90 kg x 3 @ RIR 1");
  });

  it("tracks the change across the window", () => {
    const report = summariseExerciseHistory(
      history([set("2026-07-20", 90, 5, 1), set("2026-06-20", 82.5, 5, 1)]),
    );
    expect(report.latest?.date).toBe("2026-07-20");
    expect(report.best?.estimatedOneRepMax).toBe(108);
    expect(report.changeKg).toBe(9);
  });

  it("reports no trend from a single session", () => {
    // Two points make a line; one makes nothing, and saying otherwise is how a
    // coach ends up explaining a stall that has not happened.
    const report = summariseExerciseHistory(history([set("2026-07-20", 90, 5, 1)]));
    expect(report.changeKg).toBeNull();
  });

  it("estimates from the set closest to failure, not the most flattering one", () => {
    /*
     * Regression guard, from this lifter's real bench session: five sets of
     * 75 kg x 5 logged at RIR 2, 2, 1, 1, 0. The fresh set gives 93 kg and the
     * last gives 88 kg, and 88 is the honest number — by then five reps was
     * demonstrably all there was.
     *
     * Taking the highest per-set estimate would reintroduce a bug the engine
     * already fixed, and worse, the coach would then quote a max the app's own
     * strength page disagrees with.
     */
    const report = summariseExerciseHistory(
      history([
        set("2026-07-28", 75, 5, 2),
        set("2026-07-28", 75, 5, 2),
        set("2026-07-28", 75, 5, 1),
        set("2026-07-28", 75, 5, 1),
        set("2026-07-28", 75, 5, 0),
      ]),
    );
    expect(report.sessions[0].estimatedOneRepMax).toBe(88);
  });

  it("carries no estimate when the sets are too far from failure", () => {
    const report = summariseExerciseHistory(history([set("2026-07-20", 40, 20, 5)]));
    expect(report.best).toBeNull();
    expect(report.sessions[0].estimatedOneRepMax).toBeNull();
  });
});

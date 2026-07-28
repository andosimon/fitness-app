import { describe, expect, it } from "vitest";

import {
  bestEstimateFrom,
  estimateOneRepMax,
  isReliableEstimate,
  loadForReps,
  readFatigue,
  roundToIncrement,
  suggestLoad,
  type LoggedSet,
} from "./progression";

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    weightKg: 100,
    reps: 5,
    rir: 2,
    rpe: null,
    completedAt: new Date("2026-07-27T09:00:00Z"),
    isWarmup: false,
    ...overrides,
  };
}

describe("estimated maxima", () => {
  it("returns the load itself for a true single", () => {
    expect(estimateOneRepMax(120, 1, 0)).toBe(120);
  });

  it("counts reps in reserve toward the estimate", () => {
    // Proximity to failure is what the formula depends on, so a five with two
    // left is a seven-rep effort. Ignoring RIR understates anyone who trains
    // sensibly rather than to failure every set.
    const ignoringRir = estimateOneRepMax(100, 5, 0);
    const withRir = estimateOneRepMax(100, 5, 2);
    expect(withRir).toBeGreaterThan(ignoringRir);
    expect(withRir).toBeCloseTo(100 * (1 + 7 / 30), 5);
  });

  it("matches the owner's logged squat", () => {
    // 100 kg x 5 at RIR 2 — the real set behind this feature.
    expect(Math.round(estimateOneRepMax(100, 5, 2))).toBe(123);
  });

  it("matches the owner's logged bench", () => {
    // 75 kg x 5 at RIR 0.
    expect(Math.round(estimateOneRepMax(75, 5, 0))).toBe(88);
  });

  it("round-trips against loadForReps", () => {
    const max = estimateOneRepMax(100, 5, 2);
    expect(loadForReps(max, 7)).toBeCloseTo(100, 5);
  });

  it("rejects nonsense input rather than returning a number", () => {
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(loadForReps(0, 5)).toBe(0);
  });

  it("flags estimates from high-rep sets as unreliable", () => {
    // The load-rep relationship flattens and rep endurance dominates.
    expect(isReliableEstimate(5, 2)).toBe(true);
    expect(isReliableEstimate(10, 0)).toBe(true);
    expect(isReliableEstimate(15, 0)).toBe(false);
    expect(isReliableEstimate(8, 5)).toBe(false);
  });
});

describe("best estimate from history", () => {
  it("prefers sets taken near failure over fresh ones", () => {
    /*
     * The owner's real bench session: 75 x 5 logged at RIR 2 then RIR 0. The
     * fresh set implies 93 kg, the last implies 88. RIR judgement is poor when
     * fresh and good near failure, so 88 is the honest figure — by the last set
     * five reps was demonstrably all there was.
     */
    const best = bestEstimateFrom([
      set({ weightKg: 75, reps: 5, rir: 2 }),
      set({ weightKg: 75, reps: 5, rir: 0 }),
    ]);
    expect(Math.round(best!.oneRepMax)).toBe(88);
  });

  it("uses the closest-to-failure tier even when nothing reached failure", () => {
    // The owner's squat: 100 x 5 logged at RIR 3,3,2,2,2. Estimating from the
    // threes gives 127 kg; from the twos, 123. The twos are better evidence.
    const best = bestEstimateFrom([
      set({ weightKg: 100, reps: 5, rir: 3 }),
      set({ weightKg: 100, reps: 5, rir: 2 }),
    ]);
    expect(Math.round(best!.oneRepMax)).toBe(123);
  });

  it("takes the highest estimate, not the most recent", () => {
    // A light back-off says nothing about a maximum, and averaging would drag
    // the figure down every time a session included volume work.
    const best = bestEstimateFrom([
      set({ weightKg: 100, reps: 5, rir: 2 }),
      set({ weightKg: 60, reps: 5, rir: 4 }),
    ]);
    expect(best!.from.weightKg).toBe(100);
  });

  it("ignores warm-ups", () => {
    const best = bestEstimateFrom([
      set({ weightKg: 140, reps: 5, rir: 0, isWarmup: true }),
      set({ weightKg: 100, reps: 5, rir: 2 }),
    ]);
    expect(best!.from.weightKg).toBe(100);
  });

  it("ignores sets too high-rep to estimate from", () => {
    const best = bestEstimateFrom([
      set({ weightKg: 40, reps: 30, rir: 0 }),
      set({ weightKg: 100, reps: 3, rir: 1 }),
    ]);
    expect(best!.from.weightKg).toBe(100);
  });

  it("falls back to RPE when RIR is absent", () => {
    const best = bestEstimateFrom([set({ weightKg: 100, reps: 5, rir: null, rpe: 8 })]);
    // RPE 8 implies two in reserve.
    expect(best!.oneRepMax).toBeCloseTo(estimateOneRepMax(100, 5, 2), 5);
  });

  it("returns null when nothing is usable", () => {
    expect(bestEstimateFrom([])).toBeNull();
    expect(bestEstimateFrom([set({ weightKg: null })])).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds to loads that can actually be made up", () => {
    // 63.7 kg reads as false precision and has to be re-rounded every session.
    expect(roundToIncrement(63.7, 2.5)).toBe(62.5);
    // 101.3 sits nearer 102.5 than 100.
    expect(roundToIncrement(101.3, 2.5)).toBe(102.5);
    expect(roundToIncrement(100.9, 2.5)).toBe(100);
    expect(roundToIncrement(21.4, 2)).toBe(22);
  });
});

describe("load suggestion", () => {
  const base = {
    targetRepMin: 5,
    targetRepMax: 8,
    targetRir: 2,
    targetRpe: null,
    targetPercent1rm: null,
    incrementKg: 2.5,
  };

  it("declines to guess with no history", () => {
    const s = suggestLoad({ ...base, lastSession: [], allHistory: [] });
    expect(s.loadKg).toBeNull();
    expect(s.confidence).toBe("none");
  });

  it("resolves percentage work against the estimated max", () => {
    const history = [set({ weightKg: 100, reps: 5, rir: 2 })]; // ~123 kg max
    const s = suggestLoad({
      ...base,
      targetPercent1rm: 80,
      lastSession: history,
      allHistory: history,
    });
    expect(s.loadKg).toBe(roundToIncrement(123.33 * 0.8, 2.5));
    expect(s.reason).toMatch(/80% of an estimated/);
  });

  it("adds load once the rep range is filled on every set", () => {
    // Double progression: fill the range, then add weight.
    const last = [
      set({ weightKg: 100, reps: 8, rir: 2 }),
      set({ weightKg: 100, reps: 8, rir: 2 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(102.5);
    expect(s.reason).toMatch(/Up to 102\.5 kg/);
  });

  it("holds load while still inside the rep range", () => {
    // Adding load before the range is filled is how people stall.
    const last = [
      set({ weightKg: 100, reps: 6, rir: 2 }),
      set({ weightKg: 100, reps: 5, rir: 2 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(100);
    expect(s.reason).toMatch(/add reps/);
  });

  it("drops load when the rep minimum was missed", () => {
    const last = [
      set({ weightKg: 100, reps: 4, rir: 1 }),
      set({ weightKg: 100, reps: 3, rir: 0 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(97.5);
    expect(s.reason).toMatch(/Drop to/);
  });

  it("holds load when the last session ran harder than prescribed", () => {
    /*
     * The case that matters most. Sets taken to failure when two in reserve
     * were asked for means adding load compounds a fatigue problem — even
     * though the rep target was met, which double progression alone would read
     * as a green light.
     */
    const last = [
      set({ weightKg: 100, reps: 8, rir: 0 }),
      set({ weightKg: 100, reps: 8, rir: 0 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(100);
    expect(s.reason).toMatch(/harder than planned/);
  });

  it("raises load when the rep range was massively overshot", () => {
    /*
     * The owner's calf raise: 80 kg for 33 reps at zero in reserve, against a
     * range topping out at 20. Reading that as "ran hard, hold the load" is
     * plainly wrong — of course it was hard, it was 33 reps.
     */
    const last = [set({ weightKg: 80, reps: 33, rir: 0 })];
    const s = suggestLoad({
      ...base,
      targetRepMin: 8,
      targetRepMax: 20,
      lastSession: last,
      allHistory: last,
    });
    expect(s.loadKg).toBeGreaterThan(80);
    expect(s.reason).toMatch(/well past|too light/i);
  });

  it("ignores back-off sets when reading the working load", () => {
    const last = [
      set({ weightKg: 100, reps: 5, rir: 2 }),
      set({ weightKg: 80, reps: 8, rir: 2 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(100);
  });

  it("ignores warm-ups", () => {
    const last = [
      set({ weightKg: 140, reps: 8, rir: 3, isWarmup: true }),
      set({ weightKg: 100, reps: 6, rir: 2 }),
    ];
    const s = suggestLoad({ ...base, lastSession: last, allHistory: last });
    expect(s.loadKg).toBe(100);
  });
});

describe("fatigue reading", () => {
  it("says nothing useful without enough data", () => {
    const reading = readFatigue([set({ rir: 0 })], 2);
    expect(reading.status).toBe("on_track");
    expect(reading.note).toMatch(/not enough/i);
  });

  it("flags a block running at failure", () => {
    // The owner's actual upper session: most sets at RIR 0 against a target
    // of 2. Sustainable briefly, not for four weeks.
    const sets = [
      set({ rir: 2 }),
      set({ rir: 1 }),
      set({ rir: 0 }),
      set({ rir: 0 }),
      set({ rir: 0 }),
      set({ rir: 0 }),
    ];
    const reading = readFatigue(sets, 2);
    expect(reading.status).toBe("running_hot");
    expect(reading.note).toMatch(/outpaces recovery|easing back/i);
  });

  it("flags a block with room left in it", () => {
    const sets = [set({ rir: 4 }), set({ rir: 4 }), set({ rir: 5 }), set({ rir: 4 })];
    const reading = readFatigue(sets, 2);
    expect(reading.status).toBe("leaving_room");
  });

  it("confirms a block landing where intended", () => {
    const sets = [set({ rir: 2 }), set({ rir: 2 }), set({ rir: 1 }), set({ rir: 2 })];
    expect(readFatigue(sets, 2).status).toBe("on_track");
  });

  it("reads RPE when RIR is absent", () => {
    const sets = [
      set({ rir: null, rpe: 10 }),
      set({ rir: null, rpe: 10 }),
      set({ rir: null, rpe: 10 }),
      set({ rir: null, rpe: 9.5 }),
    ];
    expect(readFatigue(sets, 2).status).toBe("running_hot");
  });
});

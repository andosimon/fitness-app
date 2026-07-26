import { describe, expect, it } from "vitest";

import { blockSeconds, blockSets, budgetSession, totalSeconds } from "./time-budget";

describe("block cost model", () => {
  it("counts one fewer rest than sets", () => {
    // 3 sets = 3 work periods but only 2 rests; the final rest is the
    // transition to the next exercise, counted separately.
    const seconds = blockSeconds({ kind: "straight", setKind: "heavy_compound", sets: 3 });
    expect(seconds).toBe(3 * 30 + 2 * 210 + 25);
  });

  it("costs nothing for an empty block", () => {
    expect(blockSeconds({ kind: "straight", setKind: "isolation", sets: 0 })).toBe(0);
    expect(
      blockSeconds({ kind: "superset", setKinds: ["isolation", "isolation"], rounds: 0 }),
    ).toBe(0);
  });

  it("makes heavy sets markedly more expensive than isolation sets", () => {
    const heavy = blockSeconds({ kind: "straight", setKind: "heavy_compound", sets: 4 });
    const isolation = blockSeconds({ kind: "straight", setKind: "isolation", sets: 4 });
    // Driven almost entirely by rest: 210s versus 75s between sets. The fixed
    // transition cost dilutes the ratio slightly, hence 1.75 rather than 2.
    expect(heavy).toBeGreaterThan(isolation * 1.75);
  });

  it("counts a superset round as two working sets", () => {
    expect(blockSets({ kind: "superset", setKinds: ["isolation", "isolation"], rounds: 4 })).toBe(8);
  });

  it("makes supersets cheaper per set than straight sets", () => {
    // Six sets, arranged two ways.
    const straight = totalSeconds([
      { kind: "straight", setKind: "isolation", sets: 3 },
      { kind: "straight", setKind: "isolation", sets: 3 },
    ]);
    const superset = totalSeconds([
      { kind: "superset", setKinds: ["isolation", "isolation"], rounds: 3 },
    ]);
    expect(superset).toBeLessThan(straight);
  });

  it("saves proportionally more when the paired work has longer rests", () => {
    // The saving comes from spending one exercise's rest performing the other,
    // so there is more to reclaim when rests are long. Pairing short-rest
    // isolation work is worth much less than pairing compound work — which is
    // why the budgeter should not treat all supersets as equally valuable.
    const ratio = (kind: "isolation" | "moderate_compound") => {
      const straight = totalSeconds([
        { kind: "straight", setKind: kind, sets: 3 },
        { kind: "straight", setKind: kind, sets: 3 },
      ]);
      const superset = totalSeconds([
        { kind: "superset", setKinds: [kind, kind], rounds: 3 },
      ]);
      return superset / straight;
    };

    expect(ratio("moderate_compound")).toBeLessThan(ratio("isolation"));
  });
});

describe("session budgeting", () => {
  it("never exceeds the time available", () => {
    for (const minutes of [20, 30, 45, 60, 75, 90]) {
      for (const goals of [
        { strength: 1 },
        { hypertrophy: 1 },
        { strength: 0.5, hypertrophy: 0.5 },
        { hypertrophy: 0.6, fat_loss: 0.4 },
      ]) {
        const budget = budgetSession(minutes, goals);
        expect(budget.estimatedSeconds).toBeLessThanOrEqual(budget.budgetSeconds);
      }
    }
  });

  it("fits fewer total sets into a strength session than a hypertrophy one", () => {
    // The headline consequence of rest intervals, and the reason this module
    // exists: the same 45 minutes buys materially less strength volume.
    const strength = budgetSession(45, { strength: 1 });
    const hypertrophy = budgetSession(45, { hypertrophy: 1 });
    expect(strength.totalSets).toBeLessThan(hypertrophy.totalSets);
    expect(strength.heavySets).toBeGreaterThan(hypertrophy.heavySets);
  });

  it("allocates more heavy sets as the strength bias rises", () => {
    const mostly = budgetSession(45, { strength: 0.8, hypertrophy: 0.2 });
    const even = budgetSession(45, { strength: 0.5, hypertrophy: 0.5 });
    const little = budgetSession(45, { strength: 0.2, hypertrophy: 0.8 });
    expect(mostly.heavySets).toBeGreaterThanOrEqual(even.heavySets);
    expect(even.heavySets).toBeGreaterThanOrEqual(little.heavySets);
  });

  it("gives more sets as the session gets longer", () => {
    const short = budgetSession(30, { strength: 0.5, hypertrophy: 0.5 });
    const medium = budgetSession(45, { strength: 0.5, hypertrophy: 0.5 });
    const long = budgetSession(75, { strength: 0.5, hypertrophy: 0.5 });
    expect(medium.totalSets).toBeGreaterThan(short.totalSets);
    expect(long.totalSets).toBeGreaterThan(medium.totalSets);
  });

  it("shows supersetting to be worth real time", () => {
    const budget = budgetSession(45, { strength: 0.5, hypertrophy: 0.5 });
    // The same volume run as straight sets would overrun the session.
    expect(budget.straightSetSeconds).toBeGreaterThan(budget.estimatedSeconds);
    expect(budget.straightSetSeconds).toBeGreaterThan(budget.budgetSeconds);
  });

  it("still prescribes heavy work when strength-focused and time is short", () => {
    const budget = budgetSession(25, { strength: 1 });
    expect(budget.heavySets).toBeGreaterThanOrEqual(2);
  });

  it("degrades gracefully at absurd inputs", () => {
    expect(budgetSession(0, { strength: 1 }).totalSets).toBe(0);
    expect(budgetSession(-10, { strength: 1 }).estimatedSeconds).toBe(0);
    // No goal weights at all should not throw or divide by zero.
    expect(budgetSession(45, {}).totalSets).toBeGreaterThan(0);
  });

  it("produces a realistic session for the owner's actual parameters", () => {
    // 45 minutes of lifting, combined strength and hypertrophy.
    const budget = budgetSession(45, { strength: 0.5, hypertrophy: 0.5 });
    // Enough volume to be worth doing, few enough to be honest about the clock.
    expect(budget.totalSets).toBeGreaterThanOrEqual(16);
    expect(budget.totalSets).toBeLessThanOrEqual(28);
    expect(budget.heavySets).toBeGreaterThanOrEqual(3);
    expect(budget.estimatedSeconds).toBeGreaterThan(budget.budgetSeconds * 0.85);
  });
});

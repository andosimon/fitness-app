import { describe, expect, it } from "vitest";

import { describeSnapshot, type LifterSnapshot } from "./context";
import { buildSystemPrompt } from "./prompt";

const BASE: LifterSnapshot = {
  experience: "advanced",
  units: "kg",
  bodyweightKg: 84,
  limitations: null,
  program: {
    name: "Upper/Lower Block 1",
    splitType: "upper_lower",
    daysPerWeek: 4,
    minutesPerSession: 45,
    totalWeeks: 4,
    primaryGoal: "hypertrophy",
    goalWeights: { hypertrophy: 0.6, strength: 0.4 },
    specialisationPattern: "squat",
    startDate: null,
  },
  equipment: { name: "Home gym", items: ["barbell", "squat_rack"] },
};

describe("the system prompt", () => {
  it("puts the unchanging brief before anything lifter-specific", () => {
    /*
     * The caching invariant. Prompt caching is a prefix match, so the first
     * block must be byte-identical for every lifter and every conversation —
     * anything conditional slipping into it would silently cost full price on
     * every request.
     */
    const mine = buildSystemPrompt(BASE);
    const theirs = buildSystemPrompt({
      ...BASE,
      experience: "intermediate",
      program: null,
      equipment: null,
    });

    expect(mine[0].text).toBe(theirs[0].text);
    expect(mine[1].text).not.toBe(theirs[1].text);
  });

  it("marks both blocks as cacheable", () => {
    // Two breakpoints with genuinely different lifetimes: the brief is shared
    // across every conversation, the snapshot across every turn within a day.
    for (const block of buildSystemPrompt(BASE)) {
      expect(block.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("carries no timestamp or identifier that would break the cache", () => {
    const brief = buildSystemPrompt(BASE)[0].text;
    expect(brief).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(brief).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("describing the lifter", () => {
  it("states the equipment as a hard constraint", () => {
    // Without this the coach cheerfully recommends a leg curl to someone whose
    // gym is a rack and a barbell.
    const text = describeSnapshot(BASE);
    expect(text).toMatch(/barbell, squat_rack/);
    expect(text).toMatch(/Do not suggest exercises requiring equipment outside that list/);
  });

  it("explains what a specialisation costs", () => {
    expect(describeSnapshot(BASE)).toMatch(/at the cost of volume elsewhere/);
  });

  it("says plainly when there is no programme", () => {
    expect(describeSnapshot({ ...BASE, program: null })).toMatch(/No active programme/);
  });

  it("always states the limitations line, present or not", () => {
    // An absent line reads as an omission; "none recorded" reads as a fact, and
    // the difference matters when the answer is about training around an injury.
    expect(describeSnapshot(BASE)).toMatch(/Injuries and limitations: none recorded/);
    expect(describeSnapshot({ ...BASE, limitations: "left shoulder impingement" })).toMatch(
      /Injuries and limitations: left shoulder impingement/,
    );
  });
});

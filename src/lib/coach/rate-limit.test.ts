import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimit } from "./rate-limit";

const HOUR = 60 * 60 * 1000;

describe("the coach rate limit", () => {
  beforeEach(resetRateLimit);

  it("allows normal use", () => {
    // Nobody asks a coach forty questions in an hour by hand.
    for (let i = 0; i < 40; i += 1) {
      expect(checkRateLimit(1_000).allowed).toBe(true);
    }
  });

  it("stops a runaway loop", () => {
    for (let i = 0; i < 40; i += 1) checkRateLimit(1_000);
    const blocked = checkRateLimit(1_000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(3600);
  });

  it("recovers as the window slides", () => {
    for (let i = 0; i < 40; i += 1) checkRateLimit(1_000);
    expect(checkRateLimit(1_000 + HOUR + 1).allowed).toBe(true);
  });

  it("reports how long to wait, not just that it is over", () => {
    for (let i = 0; i < 40; i += 1) checkRateLimit(0);
    const blocked = checkRateLimit(HOUR / 2);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(1800);
  });
});

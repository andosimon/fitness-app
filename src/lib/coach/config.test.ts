import { afterEach, describe, expect, it } from "vitest";

import { coachAvailability } from "./config";

const ORIGINAL = { flag: process.env.FEATURE_COACH, key: process.env.ANTHROPIC_API_KEY };

afterEach(() => {
  process.env.FEATURE_COACH = ORIGINAL.flag;
  process.env.ANTHROPIC_API_KEY = ORIGINAL.key;
});

function withEnv(flag: string | undefined, key: string | undefined) {
  if (flag === undefined) delete process.env.FEATURE_COACH;
  else process.env.FEATURE_COACH = flag;
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  return coachAvailability();
}

describe("whether the coach can run", () => {
  it("needs both the flag and a key", () => {
    expect(withEnv("true", "sk-ant-x")).toEqual({ available: true });
  });

  it("tells the two failure modes apart", () => {
    // A key present with the flag off is mid-setup; the flag on with no key is
    // waiting on a key. Reporting one for the other sends you to the wrong place.
    expect(withEnv("false", "sk-ant-x")).toEqual({ available: false, reason: "disabled" });
    expect(withEnv("true", undefined)).toEqual({ available: false, reason: "no_key" });
    expect(withEnv("true", "")).toEqual({ available: false, reason: "no_key" });
  });

  it("accepts the ways a person actually types yes into a dashboard field", () => {
    for (const value of ["true", "True", "TRUE", " true ", "1", "yes", "on"]) {
      expect(withEnv(value, "sk-ant-x"), value).toEqual({ available: true });
    }
  });

  it("stays off for anything it does not recognise", () => {
    // The default has to hold: an unset or garbled flag must not turn on a
    // feature that spends money.
    for (const value of [undefined, "", "false", "no", "off", "0", "maybe"]) {
      expect(withEnv(value, "sk-ant-x"), String(value)).toEqual({
        available: false,
        reason: "disabled",
      });
    }
  });
});

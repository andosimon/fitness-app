/**
 * Progression and autoregulation.
 *
 * Turns logged history into the next session's loads. This is the part that
 * makes the app a training partner rather than a list of movements: the plan
 * says "squat, three sets of five at RPE 8", and this says what to put on the
 * bar based on what you actually did last time.
 *
 * Pure arithmetic over logged sets. No database, no framework.
 */

export type LoggedSet = {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  completedAt: Date;
  isWarmup: boolean;
};

// ---------------------------------------------------------------------------
// Estimated maxima
// ---------------------------------------------------------------------------

/**
 * Estimated one-rep max from a set.
 *
 * Epley, extended to account for reps left in reserve: a set of five with two
 * in reserve is treated as a set of seven for estimation purposes, because
 * proximity to failure is what the formula actually depends on. Ignoring RIR
 * systematically understates the max of anyone who trains sensibly.
 *
 * Accuracy degrades above about ten reps to failure — the relationship flattens
 * and individual variation in rep endurance dominates — so estimates from very
 * high-rep sets should be treated as indicative only.
 */
export function estimateOneRepMax(weightKg: number, reps: number, rir = 0): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  const repsToFailure = reps + Math.max(0, rir);
  if (repsToFailure === 1) return weightKg;
  return weightKg * (1 + repsToFailure / 30);
}

/** Load predicted to allow a given number of reps to failure. */
export function loadForReps(oneRepMax: number, reps: number): number {
  if (oneRepMax <= 0 || reps <= 0) return 0;
  return oneRepMax / (1 + reps / 30);
}

/** True when an estimate is drawn from a rep range where the formula holds up. */
export function isReliableEstimate(reps: number, rir = 0): boolean {
  return reps + Math.max(0, rir) <= 10;
}

/**
 * Best estimate across a set of logged work.
 *
 * Uses the highest estimate from reliable sets rather than the most recent,
 * because a light back-off set says nothing about a maximum, and averaging
 * would drag the figure down every time a session included volume work.
 */
export function effectiveRir(set: LoggedSet): number {
  return set.rir ?? (set.rpe != null ? Math.max(0, 10 - set.rpe) : 0);
}

export function bestEstimateFrom(sets: LoggedSet[]): { oneRepMax: number; from: LoggedSet } | null {
  const usable = sets.filter(
    (s) =>
      !s.isWarmup &&
      s.weightKg != null &&
      s.reps != null &&
      isReliableEstimate(s.reps, effectiveRir(s)),
  );
  if (usable.length === 0) return null;

  /**
   * Sets taken near failure are preferred.
   *
   * People judge reps in reserve poorly when fresh and well when close to
   * failure, so an early set claiming three in reserve inflates the estimate.
   * A real case: five sets of 75 kg x 5 logged at RIR 2,2,1,1,0 gives 93 kg
   * from the first set and 88 kg from the last — and the last is the honest
   * one, because by then five reps was demonstrably all there was.
   *
   * Only the tier closest to failure is considered, rather than everything
   * below a fixed threshold: a session logged entirely at RIR 2 and 3 should be
   * estimated from the twos, not from the threes.
   */
  const closest = Math.min(...usable.map(effectiveRir));
  const pool = usable.filter((s) => effectiveRir(s) === closest);

  let best: { oneRepMax: number; from: LoggedSet } | null = null;
  for (const set of pool) {
    const estimate = estimateOneRepMax(set.weightKg!, set.reps!, effectiveRir(set));
    if (!best || estimate > best.oneRepMax) best = { oneRepMax: estimate, from: set };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Load rounding
// ---------------------------------------------------------------------------

/**
 * Rounds to a load that can actually be made up.
 *
 * Barbells jump in 2.5 kg with standard plates; dumbbells and machine stacks
 * are usually coarser. Suggesting 63.7 kg is worse than useless — it reads as
 * false precision and has to be mentally re-rounded every session.
 */
export function roundToIncrement(loadKg: number, incrementKg = 2.5): number {
  if (loadKg <= 0) return 0;
  return Math.round(loadKg / incrementKg) * incrementKg;
}

export function incrementForLoadType(loadType: string): number {
  switch (loadType) {
    case "barbell":
      return 2.5;
    case "dumbbell_pair":
    case "dumbbell_single":
    case "kettlebell":
      return 2;
    case "machine_load":
    case "cable_load":
      return 2.5;
    case "bodyweight_loaded":
      return 1.25;
    default:
      return 2.5;
  }
}

// ---------------------------------------------------------------------------
// Load suggestion
// ---------------------------------------------------------------------------

export type SuggestionConfidence = "none" | "low" | "good";

export type LoadSuggestion = {
  loadKg: number | null;
  /** Shown to the lifter, so it has to justify itself in one line. */
  reason: string;
  confidence: SuggestionConfidence;
};

export type SuggestLoadInput = {
  /** Working sets of this exercise from the most recent session, in order. */
  lastSession: LoggedSet[];
  /** Everything logged for this exercise, for estimating a max. */
  allHistory: LoggedSet[];
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number | null;
  targetRpe: number | null;
  targetPercent1rm: number | null;
  incrementKg?: number;
};

/**
 * Suggests a working load.
 *
 * Percentage prescriptions resolve against the estimated max. Everything else
 * uses double progression: hold the load until the top of the rep range is
 * reached at the intended effort, then add weight and start again at the bottom.
 * Adding load before the rep range is filled is how people stall.
 */
export function suggestLoad(input: SuggestLoadInput): LoadSuggestion {
  const {
    lastSession,
    allHistory,
    targetRepMin,
    targetRepMax,
    targetRir,
    targetPercent1rm,
    incrementKg = 2.5,
  } = input;

  const working = lastSession.filter(
    (s) => !s.isWarmup && s.weightKg != null && s.reps != null,
  );

  // Percentage-based work resolves against the estimated max, when there is one.
  if (targetPercent1rm != null) {
    const best = bestEstimateFrom(allHistory);
    if (best) {
      return {
        loadKg: roundToIncrement((best.oneRepMax * targetPercent1rm) / 100, incrementKg),
        reason: `${Math.round(targetPercent1rm)}% of an estimated ${Math.round(best.oneRepMax)} kg max.`,
        confidence: "good",
      };
    }
    return {
      loadKg: null,
      reason: "No history for this lift yet — pick a load that leaves the prescribed effort in reserve.",
      confidence: "none",
    };
  }

  if (working.length === 0) {
    return {
      loadKg: null,
      reason: "First time logging this one. Start conservatively and note what it felt like.",
      confidence: "none",
    };
  }

  // The heaviest working set is the reference; back-offs should not drag it down.
  const reference = working.reduce((best, s) =>
    (s.weightKg ?? 0) > (best.weightKg ?? 0) ? s : best,
  );
  const load = reference.weightKg!;

  const effortOf = (s: LoggedSet): number | null =>
    s.rir ?? (s.rpe != null ? Math.max(0, 10 - s.rpe) : null);

  const efforts = working.map(effortOf).filter((r): r is number => r !== null);
  const hardest = efforts.length > 0 ? Math.min(...efforts) : null;
  const topReps = Math.max(...working.map((s) => s.reps ?? 0));
  const lowestReps = Math.min(...working.map((s) => s.reps ?? 0));

  const wanted = targetRir ?? 1;

  /**
   * Missing the rep minimum is checked first, because it is unambiguous.
   *
   * Failing to reach the bottom of the range — especially at high effort —
   * means the load is simply too heavy, and no other reading overrides that.
   * Checking effort first would see the same session as "ran hard, hold the
   * load" and leave the lifter stuck under a weight they cannot complete.
   */
  if (topReps < targetRepMin) {
    const next = roundToIncrement(load - incrementKg, incrementKg);
    return {
      loadKg: next,
      reason: `Short of ${targetRepMin} reps last time. Drop to ${next} kg to get back into range.`,
      confidence: "good",
    };
  }

  /**
   * A load well past the top of the range is simply too light, and effort says
   * nothing useful about it.
   *
   * A real case: 80 kg for 33 reps against a range topping out at 20, logged at
   * zero in reserve. Reading that as "ran hard, hold the load" is obviously
   * wrong — of course it was hard, it was 33 reps. Where the history supports a
   * max, the load that should allow the top of the range is used; otherwise one
   * increment, flagged as probably still light.
   */
  if (topReps > targetRepMax + 3) {
    const best = bestEstimateFrom(allHistory);
    if (best) {
      const target = roundToIncrement(loadForReps(best.oneRepMax, targetRepMax), incrementKg);
      if (target > load) {
        return {
          loadKg: target,
          reason: `${topReps} reps is well past the ${targetRepMax} intended. ${target} kg should land in range.`,
          confidence: "good",
        };
      }
    }
    const next = roundToIncrement(load + incrementKg, incrementKg);
    return {
      loadKg: next,
      reason: `${topReps} reps is well past the ${targetRepMax} intended, so this is too light. ${next} kg to start, and expect to add more.`,
      confidence: "low",
    };
  }

  /**
   * Then overreaching. If the reps were met but the session ran materially
   * harder than prescribed — sets taken to failure when two in reserve were
   * asked for — adding load compounds a fatigue problem rather than
   * progressing. Double progression alone would read the met rep target as a
   * green light.
   */
  if (hardest !== null && hardest < wanted - 1) {
    return {
      loadKg: roundToIncrement(load, incrementKg),
      reason: `Last time ran harder than planned (${hardest} in reserve against a target of ${wanted}). Hold ${roundToIncrement(load, incrementKg)} kg and aim for the prescribed effort.`,
      confidence: "good",
    };
  }

  // Double progression: fill the rep range before adding load.
  if (lowestReps >= targetRepMax) {
    const next = roundToIncrement(load + incrementKg, incrementKg);
    return {
      loadKg: next,
      reason: `Hit ${lowestReps} on every set last time. Up to ${next} kg and start again at ${targetRepMin}.`,
      confidence: "good",
    };
  }

  return {
    loadKg: roundToIncrement(load, incrementKg),
    reason: `Same ${roundToIncrement(load, incrementKg)} kg — add reps toward ${targetRepMax} before adding load.`,
    confidence: "good",
  };
}

// ---------------------------------------------------------------------------
// Fatigue
// ---------------------------------------------------------------------------

export type FatigueStatus = "on_track" | "running_hot" | "leaving_room";

export type FatigueReading = {
  status: FatigueStatus;
  /** Mean reps in reserve across the sets examined. */
  averageRir: number | null;
  setsExamined: number;
  note: string;
};

/**
 * Compares logged effort against what was prescribed.
 *
 * Training close to failure works; training *at* failure on most sets, week
 * after week, accumulates fatigue faster than it can be shed, and the block
 * stalls before its deload. This exists to say so early rather than after the
 * fact.
 *
 * It reports a pattern, not a diagnosis — nobody should read a training app as
 * a substitute for how they actually feel.
 */
export function readFatigue(sets: LoggedSet[], targetRir: number): FatigueReading {
  const working = sets.filter((s) => !s.isWarmup);
  const efforts = working
    .map((s) => s.rir ?? (s.rpe != null ? Math.max(0, 10 - s.rpe) : null))
    .filter((r): r is number => r !== null);

  if (efforts.length < 4) {
    return {
      status: "on_track",
      averageRir: efforts.length > 0 ? mean(efforts) : null,
      setsExamined: efforts.length,
      note: "Not enough logged effort yet to read a pattern.",
    };
  }

  const average = mean(efforts);
  const atFailure = efforts.filter((r) => r === 0).length / efforts.length;

  if (average < targetRir - 1 || atFailure > 0.6) {
    return {
      status: "running_hot",
      averageRir: average,
      setsExamined: efforts.length,
      note:
        `Most sets are landing at or near failure — ${Math.round(atFailure * 100)}% at zero in reserve, ` +
        `averaging ${average.toFixed(1)} against a target of ${targetRir}. That works for a week or two, ` +
        `but sustained it usually outpaces recovery before the deload arrives. Worth easing back a little.`,
    };
  }

  if (average > targetRir + 1.5) {
    return {
      status: "leaving_room",
      averageRir: average,
      setsExamined: efforts.length,
      note: `Averaging ${average.toFixed(1)} in reserve against a target of ${targetRir}. There is room to push a little harder or add load.`,
    };
  }

  return {
    status: "on_track",
    averageRir: average,
    setsExamined: efforts.length,
    note: `Averaging ${average.toFixed(1)} in reserve, close to the ${targetRir} prescribed.`,
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

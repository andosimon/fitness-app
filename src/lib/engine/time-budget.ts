import type { GoalWeights } from "@/lib/domain/types";

/**
 * Session time budgeting.
 *
 * This is the constraint most training apps ignore. Rest intervals differ so
 * sharply by goal that a 45-minute strength session fits roughly *half* the
 * working sets of a 45-minute hypertrophy session. Prescribing without
 * accounting for it produces workouts that quietly overrun by twenty minutes.
 *
 * Everything here is pure arithmetic over an explicit cost model, so it can be
 * tested without a database or a network.
 */

export type SetKind = "heavy_compound" | "moderate_compound" | "isolation" | "conditioning";

/**
 * Seconds per set, split into work and the rest that follows it.
 *
 * Work time includes unracking and setup, not just time under tension — a
 * heavy squat set costs more wall-clock time than its five reps suggest.
 * Rest values are the mid-points of the usual prescriptions: 3-5 minutes for
 * heavy strength work, 1.5-2.5 for hypertrophy, about a minute for isolation.
 */
export const SET_COST: Record<SetKind, { workSeconds: number; restSeconds: number }> = {
  heavy_compound: { workSeconds: 30, restSeconds: 210 },
  moderate_compound: { workSeconds: 35, restSeconds: 120 },
  isolation: { workSeconds: 35, restSeconds: 75 },
  conditioning: { workSeconds: 45, restSeconds: 45 },
};

/** Walking to the next station, adjusting a bench, loading a bar. */
export const TRANSITION_SECONDS = 25;

/**
 * Gap between the two halves of a superset.
 *
 * Not merely a changeover: even with an antagonist pair you need a short breath
 * before the second exercise, or the second one degrades. Setting this too low
 * is the main way superset estimates come out fantastically optimistic.
 */
export const SUPERSET_SWITCH_SECONDS = 40;

/**
 * Rounds per superset pair before moving on.
 *
 * Real sessions rotate through several pairs rather than grinding a dozen
 * rounds of one, and each rotation costs another transition.
 */
export const ROUNDS_PER_SUPERSET_PAIR = 3;

export type Block =
  | { kind: "straight"; setKind: SetKind; sets: number }
  /**
   * Two exercises alternated. Only valid for antagonist or unrelated pairs —
   * supersetting two movements that share a muscle just makes the second one
   * worse, which is a programming decision made elsewhere, not here.
   */
  | { kind: "superset"; setKinds: [SetKind, SetKind]; rounds: number };

/**
 * Wall-clock seconds for a single block.
 *
 * There are N work periods but only N-1 rests, because the rest after the final
 * set is really the transition to whatever comes next. Counting N rests is the
 * commonest way these estimates drift long.
 */
export function blockSeconds(block: Block): number {
  if (block.kind === "straight") {
    if (block.sets <= 0) return 0;
    const { workSeconds, restSeconds } = SET_COST[block.setKind];
    return block.sets * workSeconds + (block.sets - 1) * restSeconds + TRANSITION_SECONDS;
  }

  if (block.rounds <= 0) return 0;
  const [a, b] = block.setKinds;
  const workPerRound =
    SET_COST[a].workSeconds + SUPERSET_SWITCH_SECONDS + SET_COST[b].workSeconds;
  // Each muscle recovers while the other exercise is performed, so the rest
  // between rounds is shorter than either exercise would need alone — but only
  // modestly. Treating the antagonist as full recovery is wishful thinking.
  const restBetweenRounds = Math.round(
    Math.max(SET_COST[a].restSeconds, SET_COST[b].restSeconds) * 0.75,
  );
  return block.rounds * workPerRound + (block.rounds - 1) * restBetweenRounds + TRANSITION_SECONDS;
}

export function totalSeconds(blocks: Block[]): number {
  return blocks.reduce((sum, block) => sum + blockSeconds(block), 0);
}

/** Working sets in a block. A superset round contributes two. */
export function blockSets(block: Block): number {
  return block.kind === "straight" ? block.sets : block.rounds * 2;
}

export function totalSets(blocks: Block[]): number {
  return blocks.reduce((sum, block) => sum + blockSets(block), 0);
}

export type SessionBudget = {
  /** Sets of heavy, long-rest compound work. */
  heavySets: number;
  /** Sets of moderate-rep compound work performed straight. */
  moderateSets: number;
  /** Isolation sets, paired into antagonist supersets. */
  isolationSets: number;
  totalSets: number;
  estimatedSeconds: number;
  budgetSeconds: number;
  /**
   * What the same set count would have cost as straight sets, so the value of
   * supersetting is visible rather than implied.
   */
  straightSetSeconds: number;
};

/** Share of the session's character that is strength rather than hypertrophy. */
function strengthBias(goals: GoalWeights): number {
  const strength = goals.strength ?? 0;
  const hypertrophy = goals.hypertrophy ?? 0;
  const fatLoss = goals.fat_loss ?? 0;
  const total = strength + hypertrophy + fatLoss;
  if (total === 0) return 0.5;
  return strength / total;
}

/**
 * Decides how a session's minutes are spent.
 *
 * Heavy compound work is allocated first because it is the part that cannot be
 * rushed — a top set at RPE 8 needs its three minutes whether or not the clock
 * is convenient. Whatever remains goes to accessory volume, supersetted so the
 * rest periods overlap.
 *
 * `minutes` is lifting time and excludes warm-up, which is tracked separately.
 */
export function budgetSession(minutes: number, goals: GoalWeights): SessionBudget {
  const budgetSeconds = Math.max(0, minutes) * 60;
  const bias = strengthBias(goals);

  // Between two and five heavy sets depending on how strength-focused the block
  // is. Below two there is no meaningful strength stimulus; above five, in a
  // short session, nothing is left for anything else.
  const heavyTarget = Math.round(2 + bias * 3);

  const blocks: Block[] = [];
  let heavySets = 0;
  let moderateSets = 0;
  let isolationSets = 0;

  // Heavy work, split across two exercises once there is enough of it, since
  // five sets of one lift is a worse stimulus than three plus two.
  const heavyBlocks: Block[] =
    heavyTarget >= 5
      ? [
          { kind: "straight", setKind: "heavy_compound", sets: 3 },
          { kind: "straight", setKind: "heavy_compound", sets: heavyTarget - 3 },
        ]
      : [{ kind: "straight", setKind: "heavy_compound", sets: heavyTarget }];

  for (const block of heavyBlocks) {
    if (totalSeconds([...blocks, block]) > budgetSeconds) break;
    blocks.push(block);
    heavySets += blockSets(block);
  }

  // A moderate-rep compound to bridge the two goals, when it fits.
  const moderate: Block = { kind: "straight", setKind: "moderate_compound", sets: 3 };
  if (totalSeconds([...blocks, moderate]) <= budgetSeconds) {
    blocks.push(moderate);
    moderateSets += blockSets(moderate);
  }

  // Fill the remainder with antagonist superset pairs. Whole pairs first, then
  // extend the last one round at a time, so the session lands just under budget
  // rather than just over — and so the result looks like a session someone would
  // actually run, not one endless pair.
  const newPair = (): Block => ({
    kind: "superset",
    setKinds: ["isolation", "isolation"],
    rounds: ROUNDS_PER_SUPERSET_PAIR,
  });

  while (totalSeconds([...blocks, newPair()]) <= budgetSeconds) {
    const pair = newPair();
    blocks.push(pair);
    isolationSets += blockSets(pair);
  }

  const lastPair = blocks[blocks.length - 1];
  if (lastPair?.kind === "superset") {
    while (true) {
      const extended: Block = { ...lastPair, rounds: lastPair.rounds + 1 };
      const withExtension = [...blocks.slice(0, -1), extended];
      if (totalSeconds(withExtension) > budgetSeconds) break;
      blocks[blocks.length - 1] = extended;
      lastPair.rounds = extended.rounds;
      isolationSets += 2;
    }
  }

  const sets = heavySets + moderateSets + isolationSets;

  // The counterfactual: the same volume run as straight sets.
  const straightEquivalent: Block[] = [
    { kind: "straight", setKind: "heavy_compound", sets: heavySets },
    { kind: "straight", setKind: "moderate_compound", sets: moderateSets },
    { kind: "straight", setKind: "isolation", sets: isolationSets },
  ].filter((b) => b.sets > 0) as Block[];

  return {
    heavySets,
    moderateSets,
    isolationSets,
    totalSets: sets,
    estimatedSeconds: totalSeconds(blocks),
    budgetSeconds,
    straightSetSeconds: totalSeconds(straightEquivalent),
  };
}

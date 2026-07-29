import type Anthropic from "@anthropic-ai/sdk";

import {
  unsafe_findExerciseHistory,
  unsafe_getTrainingCadence,
  unsafe_getWeeklyVolumeByMuscle,
} from "@/lib/db/queries/analysis";
import { unsafe_listExercises } from "@/lib/db/queries/exercises";
import {
  unsafe_getActiveProgram,
  unsafe_getNextPlannedSession,
} from "@/lib/db/queries/programs";
import {
  unsafe_getRecentFatigue,
  unsafe_getStrengthEstimates,
  unsafe_suggestLoadsForSession,
} from "@/lib/db/queries/progression";
import { unsafe_listCompletedSessions } from "@/lib/db/queries/sessions";
import { MUSCLE_GROUPS, MOVEMENT_PATTERNS } from "@/lib/domain/types";

import { summariseExerciseHistory, summariseVolume } from "./report";

/**
 * The coach's tools.
 *
 * **Every read here is an `unsafe_` variant, and that is required rather than
 * sloppy.** A turn is driven from inside a `ReadableStream`, which the runtime
 * pumps *after* the route handler has returned — outside the request scope,
 * where `cookies()` throws and so every guarded query fails. It fails
 * intermittently, too: whether the first pull happens before the handler
 * returns is a timing detail, so the same code path worked once and then broke.
 *
 * Authorisation is established once, in the route handler, while the request
 * scope still exists. Nothing in this file may be reached any other way.
 *
 * All eight are reads. That is a deliberate limit rather than an unfinished
 * one: a coach that could silently rewrite the programme would make every
 * conversation a thing you have to supervise, and the engine — not the model —
 * is what decides what a session looks like. The coach's job is to explain the
 * data and say what it would change; applying a change stays a deliberate act
 * on the Program screen.
 *
 * Every handler returns real rows. Nothing here summarises, rounds or
 * editorialises beyond what `report.ts` does, because the point of grounding is
 * that the model reasons over what actually happened.
 */

export const COACH_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_recent_sessions",
    description:
      "Recent completed training sessions with date, total working sets, tonnage and the " +
      "exercises performed. Use this for questions about what has been trained lately, " +
      "consistency, or to orient before looking at a specific lift.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "How many sessions to return, most recent first. Default 12.",
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
  {
    name: "get_exercise_history",
    description:
      "Every working set logged for one exercise, collapsed to one row per session, with " +
      "the top set and an estimated 1RM where the set supports one. Matches on name, slug " +
      "or alias, so 'bench', 'RDL' and 'lat pulldown' all resolve. Use this for any " +
      "question about whether a specific lift is progressing.",
    input_schema: {
      type: "object",
      properties: {
        exercise: {
          type: "string",
          description: "Exercise name or common abbreviation, e.g. 'bench press' or 'RDL'.",
        },
        limit: {
          type: "integer",
          description: "Maximum sets to read before summarising. Default 60.",
          minimum: 10,
          maximum: 200,
        },
      },
      required: ["exercise"],
    },
  },
  {
    name: "get_strength_estimates",
    description:
      "Current estimated 1RM for every compound lift with usable history, derived from the " +
      "set closest to failure rather than the heaviest. Isolation work is excluded because " +
      "an estimated max on a lateral raise is noise.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Default 12.", minimum: 1, maximum: 40 },
      },
    },
  },
  {
    name: "get_volume_by_muscle",
    description:
      "Weekly working sets per muscle group over a recent window, judged against the " +
      "MEV/MAV/MRV landmarks this app's programme generator plans to. Secondary muscle " +
      "involvement counts as half a set, matching how the generator budgets volume. Use " +
      "this for 'am I doing enough X', 'why am I so beaten up', and any question about " +
      "whether the programme is balanced.",
    input_schema: {
      type: "object",
      properties: {
        weeks: {
          type: "integer",
          description: "Window length in weeks. Default 8.",
          minimum: 2,
          maximum: 26,
        },
        muscles: {
          type: "array",
          description: "Restrict to these muscle groups. Omit for all.",
          items: { type: "string", enum: [...MUSCLE_GROUPS] },
        },
      },
    },
  },
  {
    name: "get_training_cadence",
    description:
      "How consistently training actually happened: sessions logged, sessions per week, " +
      "days since the last one, and the longest gap. Check this before concluding a lift " +
      "has stalled — missed weeks explain more stalls than programming does.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Window in days. Default 56.",
          minimum: 14,
          maximum: 365,
        },
      },
    },
  },
  {
    name: "get_program_schedule",
    description:
      "The active programme's full session list by week, with which are already done. Use " +
      "this to see where in the block the lifter is, and what is coming.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_next_session",
    description:
      "The next planned session in full: every exercise, its prescribed sets, rep range, " +
      "RIR or %1RM target and rest, plus the load the app would suggest from logged " +
      "history and a reading of recent training effort. Use this for 'what should I do " +
      "today' and any question about an upcoming session.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_exercises",
    description:
      "The exercise library, filtered. Returns required equipment for each result, so an " +
      "alternative can be checked against what the lifter actually has before suggesting " +
      "it. Use this before naming any exercise you have not already seen in their history.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text match on name or alias." },
        muscle: {
          type: "string",
          description: "Only exercises with this as a primary muscle.",
          enum: [...MUSCLE_GROUPS],
        },
        pattern: {
          type: "string",
          description: "Only exercises with this movement pattern.",
          enum: [...MOVEMENT_PATTERNS],
        },
        limit: { type: "integer", description: "Default 20.", minimum: 1, maximum: 50 },
      },
    },
  },
];

export type ToolResult = { content: string; isError: boolean };

/**
 * Runs one tool call.
 *
 * Failures come back as `is_error` tool results rather than exceptions, so a
 * bad argument becomes something the model can correct on the next turn instead
 * of an aborted conversation.
 */
export async function runTool(name: string, rawInput: unknown): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  try {
    const value = await dispatch(name, input);
    return { content: JSON.stringify(value), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { content: JSON.stringify({ error: message }), isError: true };
  }
}

async function dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_recent_sessions": {
      const limit = clamp(input.limit, 1, 50, 12);
      const sessions = await unsafe_listCompletedSessions(limit);
      return {
        sessions: sessions.map((s) => ({
          date: s.startedAt.toISOString().slice(0, 10),
          name: s.name,
          workingSets: s.setCount,
          tonnageKg: Math.round(s.volumeKg),
          perceivedEffort: s.perceivedEffort,
          exercises: s.exerciseNames,
        })),
      };
    }

    case "get_exercise_history": {
      const query = String(input.exercise ?? "").trim();
      if (!query) throw new Error("An exercise name is required.");

      const history = await unsafe_findExerciseHistory(query, clamp(input.limit, 10, 200, 60));
      if (!history) {
        return {
          matched: null,
          note: `Nothing in the library matches "${query}". Try search_exercises to find the right name.`,
        };
      }
      if (history.sets.length === 0) {
        return {
          matched: history.exerciseName,
          note: "This exercise exists in the library but has never been logged.",
        };
      }
      return summariseExerciseHistory(history);
    }

    case "get_strength_estimates": {
      const estimates = await unsafe_getStrengthEstimates(clamp(input.limit, 1, 40, 12));
      return {
        method:
          "Epley extended for reps in reserve, taken from the set closest to failure. " +
          "Sets more than ten reps from failure are excluded as unreliable.",
        estimates: estimates.map((e) => ({
          exercise: e.exerciseName,
          estimatedOneRepMaxKg: e.estimatedOneRepMax,
          from: `${e.fromWeightKg} kg x ${e.fromReps}${e.fromRir !== null ? ` @ RIR ${e.fromRir}` : ""}`,
          on: e.achievedAt.toISOString().slice(0, 10),
        })),
      };
    }

    case "get_volume_by_muscle": {
      const weeks = clamp(input.weeks, 2, 26, 8);
      const report = summariseVolume(await unsafe_getWeeklyVolumeByMuscle(weeks), weeks);

      const filter = Array.isArray(input.muscles) ? new Set(input.muscles.map(String)) : null;
      return {
        ...report,
        accounting: "A set counts 1 for each primary muscle and 0.5 for each secondary muscle.",
        muscles:
          filter && filter.size > 0
            ? report.muscles.filter((r) => filter.has(r.muscle))
            : report.muscles,
      };
    }

    case "get_training_cadence":
      return unsafe_getTrainingCadence(clamp(input.days, 14, 365, 56));

    case "get_program_schedule": {
      const program = await unsafe_getActiveProgram();
      if (!program) return { program: null, note: "No active programme." };
      return {
        name: program.name,
        splitType: program.splitType,
        daysPerWeek: program.daysPerWeek,
        minutesPerSession: program.minutesPerSession,
        totalWeeks: program.totalWeeks,
        startDate: program.startDate?.toISOString().slice(0, 10) ?? null,
        sessionsCompleted: program.sessions.filter((s) => s.completed).length,
        sessionsTotal: program.sessions.length,
        sessions: program.sessions.map((s) => ({
          week: s.weekNumber,
          day: s.dayIndex + 1,
          name: s.name,
          completed: s.completed,
        })),
      };
    }

    case "get_next_session": {
      const planned = await unsafe_getNextPlannedSession();
      if (!planned) return { session: null, note: "No planned session — the programme is done or none is active." };

      const [suggestions, fatigue] = await Promise.all([
        unsafe_suggestLoadsForSession(
          planned.exercises.map((row) => ({
            plannedExerciseId: row.id,
            exerciseId: row.exerciseId,
            loadType: row.loadType,
            repMin: row.repMin,
            repMax: row.repMax,
            targetRir: row.targetRir,
            targetRpe: row.targetRpe,
            targetPercent1rm: row.targetPercent1rm,
          })),
        ),
        unsafe_getRecentFatigue(planned.exercises[0]?.targetRir ?? 2),
      ]);
      const byPlanned = new Map(suggestions.map((s) => [s.plannedExerciseId, s]));

      return {
        name: planned.name,
        week: planned.weekNumber,
        isDeload: planned.isDeload,
        targetMinutes: planned.targetMinutes,
        recentEffort: fatigue,
        exercises: planned.exercises.map((row) => {
          const suggestion = byPlanned.get(row.id);
          return {
            exercise: row.exerciseName,
            sets: row.sets,
            reps: row.repMin === row.repMax ? `${row.repMin}` : `${row.repMin}-${row.repMax}`,
            targetRir: row.targetRir,
            targetRpe: row.targetRpe,
            targetPercent1rm: row.targetPercent1rm,
            restSeconds: row.restSeconds,
            tempo: row.tempo,
            supersetGroup: row.supersetGroup,
            suggestedLoadKg: suggestion?.loadKg ?? null,
            suggestionReason: suggestion?.reason ?? "No logged history for this exercise yet.",
            suggestionConfidence: suggestion?.confidence ?? null,
          };
        }),
      };
    }

    case "search_exercises": {
      const limit = clamp(input.limit, 1, 50, 20);
      const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      const muscle = typeof input.muscle === "string" ? input.muscle : null;
      const pattern = typeof input.pattern === "string" ? input.pattern : null;

      const library = await unsafe_listExercises();
      const matches = library
        .filter((e) => {
          if (muscle && !e.primaryMuscles.includes(muscle)) return false;
          if (pattern && e.movementPattern !== pattern) return false;
          if (!query) return true;
          return (
            e.name.toLowerCase().includes(query) ||
            e.slug.includes(query) ||
            e.aliases.some((a) => a.toLowerCase().includes(query))
          );
        })
        .slice(0, limit);

      return {
        matched: matches.length,
        exercises: matches.map((e) => ({
          name: e.name,
          movementPattern: e.movementPattern,
          primaryMuscles: e.primaryMuscles,
          secondaryMuscles: e.secondaryMuscles,
          requiredEquipment: e.requiredEquipment,
          isCompound: e.isCompound,
          defaultReps: `${e.defaultRepMin}-${e.defaultRepMax}`,
        })),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Coerces a model-supplied number into range, since schemas are guidance. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

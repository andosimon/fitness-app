import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  equipmentProfiles,
  exercises,
  plannedExercises,
  plannedSessions,
  programWeeks,
  programs,
  sessions,
} from "@/lib/db/schema";
import type { Equipment, MovementPattern } from "@/lib/domain/types";
import { generateProgram, type GenerationInput } from "@/lib/engine/generate";
import type { SelectableExercise } from "@/lib/engine/selection";

/**
 * Generating, storing and reading training programmes.
 *
 * The engine itself is pure. This module loads the exercise library, hands it to
 * the engine, and persists the result — so the programming logic stays testable
 * without a database and the database code stays free of programming decisions.
 */

async function loadLibrary(): Promise<SelectableExercise[]> {
  const rows = await getDb().select().from(exercises).where(eq(exercises.isActive, true));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    movementPattern: r.movementPattern,
    primaryMuscles: r.primaryMuscles,
    secondaryMuscles: r.secondaryMuscles,
    requiredEquipment: r.requiredEquipment,
    loadType: r.loadType,
    isCompound: r.isCompound,
    isUnilateral: r.isUnilateral,
    complexity: r.complexity,
    stimulusFatigueRatio: r.stimulusFatigueRatio,
    defaultRepMin: r.defaultRepMin,
    defaultRepMax: r.defaultRepMax,
    substitutionGroup: r.substitutionGroup,
  }));
}

export type CreateProgramInput = Omit<
  GenerationInput,
  "availableEquipment" | "seed" | "blockIndex"
> & {
  equipmentProfileId: string;
};

/**
 * Generates a programme and stores it, replacing any currently active one.
 *
 * The generation inputs are stored alongside the result so a programme can be
 * explained, reproduced, or regenerated later with one input changed — which is
 * the point of the engine being deterministic.
 */
export async function createProgram(input: CreateProgramInput): Promise<string> {
  await requireAuth();
  return unsafe_createProgram(input);
}

/**
 * Implementation without the session check.
 *
 * Exists for CLI scripts, which have no request scope and therefore no cookies,
 * but do have filesystem access to the connection string — a different
 * authorisation boundary, not an absent one.
 *
 * The `unsafe_` prefix is deliberate: anything in the request path must call
 * `createProgram`, and an accidental import of this is impossible to miss in
 * review.
 */
export async function unsafe_createProgram(input: CreateProgramInput): Promise<string> {
  const db = getDb();

  const [profile] = await db
    .select()
    .from(equipmentProfiles)
    .where(eq(equipmentProfiles.id, input.equipmentProfileId))
    .limit(1);
  if (!profile) throw new Error("Equipment profile not found");

  // Block index advances with each programme, so anchors rotate between
  // mesocycles rather than repeating the same lifts forever.
  const priorCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(programs);
  const blockIndex = priorCount[0]?.n ?? 0;

  const seed = crypto.randomUUID();
  const library = await loadLibrary();

  const generated = generateProgram(
    {
      ...input,
      availableEquipment: profile.equipment as Equipment[],
      seed,
      blockIndex,
    },
    library,
  );

  // Only one programme is active at a time; the previous becomes history.
  await db
    .update(programs)
    .set({ status: "archived" })
    .where(eq(programs.status, "active"));

  const [program] = await db
    .insert(programs)
    .values({
      name: input.name,
      goalWeights: input.goalWeights,
      primaryGoal:
        (input.goalWeights.strength ?? 0) >= (input.goalWeights.hypertrophy ?? 0)
          ? "strength"
          : "hypertrophy",
      daysPerWeek: input.daysPerWeek,
      minutesPerSession: input.minutesPerSession,
      splitType: input.splitType,
      totalWeeks: input.weeks,
      equipmentProfileId: input.equipmentProfileId,
      generationInputs: { ...input, seed, blockIndex },
      engineVersion: generated.engineVersion,
      status: "active",
      startDate: new Date(),
      notes: generated.specialisationNote,
    })
    .returning({ id: programs.id });

  for (const week of generated.weeks) {
    const [weekRow] = await db
      .insert(programWeeks)
      .values({
        programId: program.id,
        weekNumber: week.weekNumber,
        isDeload: week.isDeload,
        targetVolume: week.targetVolume,
        intensityModifier: week.intensityModifier,
      })
      .returning({ id: programWeeks.id });

    for (const session of week.sessions) {
      const [sessionRow] = await db
        .insert(plannedSessions)
        .values({
          programWeekId: weekRow.id,
          dayIndex: session.dayIndex,
          name: session.name,
          sessionType: session.sessionType,
          targetMinutes: session.targetMinutes,
          focus: session.focus,
          notes: week.isDeload ? week.note : null,
        })
        .returning({ id: plannedSessions.id });

      if (session.rows.length === 0) continue;

      await db.insert(plannedExercises).values(
        session.rows.map((row) => ({
          plannedSessionId: sessionRow.id,
          exerciseId: row.exerciseId,
          orderIndex: row.orderIndex,
          sets: row.sets,
          repMin: row.repMin,
          repMax: row.repMax,
          targetRir: row.targetRir,
          targetRpe: row.targetRpe,
          targetPercent1rm: row.targetPercent1rm,
          restSeconds: row.restSeconds,
          tempo: row.tempo,
          supersetGroup: row.supersetGroup,
          notes: row.notes,
        })),
      );
    }
  }

  return program.id;
}

export type PlannedExerciseView = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  orderIndex: number;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  targetRir: number | null;
  targetRpe: number | null;
  targetPercent1rm: number | null;
  restSeconds: number;
  tempo: string | null;
  supersetGroup: string | null;
  notes: string | null;
};

export type PlannedSessionView = {
  id: string;
  name: string;
  dayIndex: number;
  sessionType: string;
  targetMinutes: number;
  weekNumber: number;
  isDeload: boolean;
  programId: string;
  programName: string;
  notes: string | null;
  exercises: PlannedExerciseView[];
  /** True once a logged session references this plan. */
  completed: boolean;
};

export type ActiveProgramSummary = {
  id: string;
  name: string;
  splitType: string;
  daysPerWeek: number;
  minutesPerSession: number;
  totalWeeks: number;
  startDate: Date | null;
  notes: string | null;
  sessions: { id: string; name: string; weekNumber: number; dayIndex: number; completed: boolean }[];
};

export async function getActiveProgram(): Promise<ActiveProgramSummary | null> {
  await requireAuth();
  return unsafe_getActiveProgram();
}

/** See the note on `unsafe_createProgram`. */
export async function unsafe_getActiveProgram(): Promise<ActiveProgramSummary | null> {
  const db = getDb();

  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.status, "active"))
    .orderBy(desc(programs.createdAt))
    .limit(1);
  if (!program) return null;

  const rows = await db
    .select({
      id: plannedSessions.id,
      name: plannedSessions.name,
      dayIndex: plannedSessions.dayIndex,
      weekNumber: programWeeks.weekNumber,
      completedAt: sessions.completedAt,
    })
    .from(plannedSessions)
    .innerJoin(programWeeks, eq(programWeeks.id, plannedSessions.programWeekId))
    .leftJoin(sessions, eq(sessions.plannedSessionId, plannedSessions.id))
    .where(eq(programWeeks.programId, program.id))
    .orderBy(asc(programWeeks.weekNumber), asc(plannedSessions.dayIndex));

  return {
    id: program.id,
    name: program.name,
    splitType: program.splitType,
    daysPerWeek: program.daysPerWeek,
    minutesPerSession: program.minutesPerSession,
    totalWeeks: program.totalWeeks,
    startDate: program.startDate,
    notes: program.notes,
    sessions: rows.map((r) => ({
      id: r.id,
      name: r.name,
      weekNumber: r.weekNumber,
      dayIndex: r.dayIndex,
      completed: r.completedAt !== null,
    })),
  };
}

/**
 * The next planned session that has not been performed.
 *
 * Ordered by week then day, so the programme is followed in sequence rather
 * than by calendar date — missing a Tuesday should not silently skip a session.
 */
export async function getNextPlannedSession(): Promise<PlannedSessionView | null> {
  await requireAuth();
  return unsafe_getNextPlannedSession();
}

/** See the note on `unsafe_createProgram`. */
export async function unsafe_getNextPlannedSession(): Promise<PlannedSessionView | null> {
  const db = getDb();

  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.status, "active"))
    .orderBy(desc(programs.createdAt))
    .limit(1);
  if (!program) return null;

  const [next] = await db
    .select({
      id: plannedSessions.id,
      name: plannedSessions.name,
      dayIndex: plannedSessions.dayIndex,
      sessionType: plannedSessions.sessionType,
      targetMinutes: plannedSessions.targetMinutes,
      notes: plannedSessions.notes,
      weekNumber: programWeeks.weekNumber,
      isDeload: programWeeks.isDeload,
    })
    .from(plannedSessions)
    .innerJoin(programWeeks, eq(programWeeks.id, plannedSessions.programWeekId))
    .leftJoin(sessions, eq(sessions.plannedSessionId, plannedSessions.id))
    .where(and(eq(programWeeks.programId, program.id), isNull(sessions.id)))
    .orderBy(asc(programWeeks.weekNumber), asc(plannedSessions.dayIndex))
    .limit(1);

  if (!next) return null;

  const exerciseRows = await db
    .select({
      id: plannedExercises.id,
      exerciseId: plannedExercises.exerciseId,
      exerciseName: exercises.name,
      loadType: exercises.loadType,
      orderIndex: plannedExercises.orderIndex,
      sets: plannedExercises.sets,
      repMin: plannedExercises.repMin,
      repMax: plannedExercises.repMax,
      targetRir: plannedExercises.targetRir,
      targetRpe: plannedExercises.targetRpe,
      targetPercent1rm: plannedExercises.targetPercent1rm,
      restSeconds: plannedExercises.restSeconds,
      tempo: plannedExercises.tempo,
      supersetGroup: plannedExercises.supersetGroup,
      notes: plannedExercises.notes,
    })
    .from(plannedExercises)
    .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
    .where(eq(plannedExercises.plannedSessionId, next.id))
    .orderBy(asc(plannedExercises.orderIndex));

  return {
    ...next,
    programId: program.id,
    programName: program.name,
    completed: false,
    exercises: exerciseRows,
  };
}

export async function archiveActiveProgram(): Promise<void> {
  await requireAuth();
  await getDb()
    .update(programs)
    .set({ status: "archived" })
    .where(eq(programs.status, "active"));
}

/** Movement patterns worth offering as a specialisation target. */
export const SPECIALISABLE_PATTERNS: { value: MovementPattern; label: string }[] = [
  { value: "squat", label: "Squat" },
  { value: "hinge", label: "Deadlift / hinge" },
  { value: "horizontal_push", label: "Bench press" },
  { value: "vertical_push", label: "Overhead press" },
  { value: "vertical_pull", label: "Pull-up" },
  { value: "horizontal_pull", label: "Row" },
];

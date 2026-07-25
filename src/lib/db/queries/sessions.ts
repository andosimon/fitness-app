import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exercises, sessions, setLogs } from "@/lib/db/schema";

/**
 * Reads over completed training history.
 *
 * Served from Postgres rather than the local mirror: history is reviewed at
 * rest, not mid-set, and the server is authoritative once a session has synced.
 */

export type SessionSummary = {
  id: string;
  name: string;
  startedAt: Date;
  completedAt: Date | null;
  perceivedEffort: number | null;
  setCount: number;
  /** Tonnage: sum of weight x reps across working sets. */
  volumeKg: number;
  exerciseNames: string[];
};

export async function listCompletedSessions(limit = 50): Promise<SessionSummary[]> {
  await requireAuth();

  const rows = await getDb()
    .select({
      id: sessions.id,
      name: sessions.name,
      startedAt: sessions.startedAt,
      completedAt: sessions.completedAt,
      perceivedEffort: sessions.perceivedEffort,
      setCount: sql<number>`count(${setLogs.id})::int`,
      // Warm-ups are excluded so tonnage reflects actual working volume.
      volumeKg: sql<number>`coalesce(sum(${setLogs.weightKg} * ${setLogs.reps}), 0)::real`,
      exerciseNames: sql<string[]>`coalesce((
        select array_agg(distinct e2.name order by e2.name)
        from ${setLogs} sl2
        join ${exercises} e2 on e2.id = sl2.exercise_id
        where sl2.session_id = ${sessions.id}
      ), '{}')`,
    })
    .from(sessions)
    .leftJoin(setLogs, and(eq(setLogs.sessionId, sessions.id), eq(setLogs.isWarmup, false)))
    .where(isNotNull(sessions.completedAt))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  return rows as SessionSummary[];
}

/** The most recent finished session, for the "last session" card on Today. */
export async function getLastCompletedSession(): Promise<SessionSummary | null> {
  const [latest] = await listCompletedSessions(1);
  return latest ?? null;
}

export type LoggedSet = {
  id: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  timeSeconds: number | null;
  isWarmup: boolean;
  isAmrap: boolean;
  completedAt: Date;
};

export type SessionDetail = {
  id: string;
  name: string;
  startedAt: Date;
  completedAt: Date | null;
  perceivedEffort: number | null;
  notes: string | null;
  /** Grouped by exercise, in the order each was first performed. */
  blocks: { exerciseId: string; exerciseName: string; loadType: string; sets: LoggedSet[] }[];
};

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  await requireAuth();

  const db = getDb();

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return null;

  const rows = await db
    .select({
      id: setLogs.id,
      exerciseId: setLogs.exerciseId,
      exerciseName: exercises.name,
      loadType: exercises.loadType,
      setIndex: setLogs.setIndex,
      weightKg: setLogs.weightKg,
      reps: setLogs.reps,
      rir: setLogs.rir,
      rpe: setLogs.rpe,
      timeSeconds: setLogs.timeSeconds,
      isWarmup: setLogs.isWarmup,
      isAmrap: setLogs.isAmrap,
      completedAt: setLogs.completedAt,
    })
    .from(setLogs)
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(eq(setLogs.sessionId, sessionId))
    .orderBy(setLogs.completedAt, setLogs.setIndex);

  const order: string[] = [];
  const byExercise = new Map<string, SessionDetail["blocks"][number]>();

  for (const row of rows) {
    let block = byExercise.get(row.exerciseId);
    if (!block) {
      block = {
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        loadType: row.loadType,
        sets: [],
      };
      byExercise.set(row.exerciseId, block);
      order.push(row.exerciseId);
    }
    block.sets.push({
      id: row.id,
      setIndex: row.setIndex,
      weightKg: row.weightKg,
      reps: row.reps,
      rir: row.rir,
      rpe: row.rpe,
      timeSeconds: row.timeSeconds,
      isWarmup: row.isWarmup,
      isAmrap: row.isAmrap,
      completedAt: row.completedAt,
    });
  }

  return {
    id: session.id,
    name: session.name,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    perceivedEffort: session.perceivedEffort,
    notes: session.notes,
    blocks: order.map((id) => byExercise.get(id)!),
  };
}

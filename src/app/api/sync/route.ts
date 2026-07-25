import { inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sessions, setLogs } from "@/lib/db/schema";

/**
 * Receives batches of locally-logged training data and upserts them.
 *
 * Idempotent by construction: rows carry client-generated UUIDs, so replaying a
 * batch is harmless. That matters because a device with flaky signal will retry,
 * and it must never produce duplicate sets.
 */

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "invalid ISO date" });

const flag = z.union([z.literal(0), z.literal(1)]);

const sessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  sessionType: z.enum(["strength", "hypertrophy", "conditioning", "cardio", "mobility", "rest"]),
  startedAt: isoDate,
  completedAt: isoDate.nullable(),
  perceivedEffort: z.number().min(0).max(10).nullable(),
  bodyweightKg: z.number().positive().max(500).nullable(),
  equipmentProfileId: z.string().uuid().nullable(),
  locationNote: z.string().max(500).nullable(),
  notes: z.string().max(5000).nullable(),
  programId: z.string().uuid().nullable(),
  plannedSessionId: z.string().uuid().nullable(),
  deleted: flag,
});

const setLogSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  exerciseId: z.string().uuid(),
  plannedExerciseId: z.string().uuid().nullable(),
  setIndex: z.number().int().min(0).max(200),
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(1000).nullable(),
  rir: z.number().min(0).max(10).nullable(),
  rpe: z.number().min(0).max(10).nullable(),
  timeSeconds: z.number().int().min(0).nullable(),
  distanceM: z.number().min(0).nullable(),
  calories: z.number().int().min(0).nullable(),
  isWarmup: flag,
  isAmrap: flag,
  isFailed: flag,
  tempo: z.string().max(20).nullable(),
  notes: z.string().max(2000).nullable(),
  completedAt: isoDate,
  deleted: flag,
});

// Bounded so a malformed or hostile client cannot submit an unbounded batch.
const payloadSchema = z.object({
  sessions: z.array(sessionSchema).max(200),
  setLogs: z.array(setLogSchema).max(2000),
});

type SessionInput = z.infer<typeof sessionSchema>;
type SetLogInput = z.infer<typeof setLogSchema>;

function toSessionRow(input: SessionInput) {
  return {
    id: input.id,
    name: input.name,
    sessionType: input.sessionType,
    startedAt: new Date(input.startedAt),
    completedAt: input.completedAt ? new Date(input.completedAt) : null,
    perceivedEffort: input.perceivedEffort,
    bodyweightKg: input.bodyweightKg,
    equipmentProfileId: input.equipmentProfileId,
    locationNote: input.locationNote,
    notes: input.notes,
    programId: input.programId,
    plannedSessionId: input.plannedSessionId,
    syncedAt: new Date(),
    updatedAt: new Date(),
  };
}

function toSetLogRow(input: SetLogInput) {
  return {
    id: input.id,
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    plannedExerciseId: input.plannedExerciseId,
    setIndex: input.setIndex,
    weightKg: input.weightKg,
    reps: input.reps,
    rir: input.rir,
    rpe: input.rpe,
    timeSeconds: input.timeSeconds,
    distanceM: input.distanceM,
    calories: input.calories,
    isWarmup: input.isWarmup === 1,
    isAmrap: input.isAmrap === 1,
    isFailed: input.isFailed === 1,
    tempo: input.tempo,
    notes: input.notes,
    completedAt: new Date(input.completedAt),
    syncedAt: new Date(),
  };
}

type Rejection = { id: string; reason: string };

/** `excluded.<column>` — the row that conflicted, for upsert set clauses. */
function sqlRef(column: string) {
  return sql.raw(`excluded.${column}`);
}

/**
 * Writes rows, isolating failures.
 *
 * Tries the whole batch first, then falls back to one-by-one if it fails. A
 * single unwritable row (an exercise deleted on another device, say) must not
 * wedge the sync queue permanently — the client can only clear rows the server
 * accepted, so a poison row would otherwise block every later set forever.
 */
async function writeIsolating<T extends { id: string }>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>,
): Promise<{ accepted: string[]; rejected: Rejection[] }> {
  if (rows.length === 0) return { accepted: [], rejected: [] };

  try {
    await write(rows);
    return { accepted: rows.map((r) => r.id), rejected: [] };
  } catch {
    const accepted: string[] = [];
    const rejected: Rejection[] = [];
    for (const row of rows) {
      try {
        await write([row]);
        accepted.push(row.id);
      } catch (error) {
        rejected.push({
          id: row.id,
          reason: error instanceof Error ? unwrap(error) : "unknown error",
        });
      }
    }
    return { accepted, rejected };
  }
}

function unwrap(error: Error): string {
  const cause = error.cause;
  return cause instanceof Error && cause.message ? cause.message : error.message;
}

export async function POST(request: Request) {
  // `proxy.ts` already 401s unauthenticated /api/* traffic, but this is checked
  // here too: route handlers must not depend on a matcher staying correct.
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues.slice(0, 20) },
      { status: 422 },
    );
  }

  const db = getDb();
  const { sessions: sessionInputs, setLogs: setLogInputs } = parsed.data;

  const liveSessions = sessionInputs.filter((s) => s.deleted === 0);
  const liveSetLogs = setLogInputs.filter((s) => s.deleted === 0);
  const deadSessionIds = sessionInputs.filter((s) => s.deleted === 1).map((s) => s.id);
  const deadSetLogIds = setLogInputs.filter((s) => s.deleted === 1).map((s) => s.id);

  try {
    // Order matters throughout: set logs reference sessions.
    const sessionResult = await writeIsolating(liveSessions.map(toSessionRow), (batch) =>
      db
        .insert(sessions)
        .values(batch)
        .onConflictDoUpdate({
          target: sessions.id,
          set: {
            name: sqlRef("name"),
            completedAt: sqlRef("completed_at"),
            perceivedEffort: sqlRef("perceived_effort"),
            bodyweightKg: sqlRef("bodyweight_kg"),
            locationNote: sqlRef("location_note"),
            notes: sqlRef("notes"),
            syncedAt: sqlRef("synced_at"),
            updatedAt: sqlRef("updated_at"),
          },
        }),
    );

    const setLogResult = await writeIsolating(liveSetLogs.map(toSetLogRow), (batch) =>
      db
        .insert(setLogs)
        .values(batch)
        .onConflictDoUpdate({
          target: setLogs.id,
          set: {
            setIndex: sqlRef("set_index"),
            weightKg: sqlRef("weight_kg"),
            reps: sqlRef("reps"),
            rir: sqlRef("rir"),
            rpe: sqlRef("rpe"),
            timeSeconds: sqlRef("time_seconds"),
            distanceM: sqlRef("distance_m"),
            calories: sqlRef("calories"),
            isWarmup: sqlRef("is_warmup"),
            isAmrap: sqlRef("is_amrap"),
            isFailed: sqlRef("is_failed"),
            tempo: sqlRef("tempo"),
            notes: sqlRef("notes"),
            completedAt: sqlRef("completed_at"),
            syncedAt: sqlRef("synced_at"),
          },
        }),
    );

    // Deletions run in reverse dependency order.
    if (deadSetLogIds.length > 0) {
      await db.delete(setLogs).where(inArray(setLogs.id, deadSetLogIds));
    }
    if (deadSessionIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.id, deadSessionIds));
    }

    return Response.json({
      ok: true,
      accepted: {
        sessions: [...sessionResult.accepted, ...deadSessionIds],
        setLogs: [...setLogResult.accepted, ...deadSetLogIds],
      },
      rejected: {
        sessions: sessionResult.rejected,
        setLogs: setLogResult.rejected,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? unwrap(error) : "Sync failed" },
      { status: 500 },
    );
  }
}

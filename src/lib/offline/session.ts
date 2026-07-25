import {
  getLocalDb,
  newId,
  type CachedExercise,
  type LocalSession,
  type LocalSetLog,
} from "./db";
import { pushPending } from "./sync";

/**
 * Local mutations for an in-progress workout.
 *
 * Everything here writes to IndexedDB and returns immediately, then kicks off a
 * background push. The UI must never wait on the network to record a set —
 * that's the whole point of the local-first design.
 */

/** Fire-and-forget sync. Failures are irrelevant: the row stays dirty and retries. */
function scheduleSync(): void {
  void pushPending().catch(() => {});
}

export async function startSession(input: {
  name: string;
  sessionType?: LocalSession["sessionType"];
  equipmentProfileId?: string | null;
}): Promise<string> {
  const db = getLocalDb();
  const now = new Date().toISOString();

  const session: LocalSession = {
    id: newId(),
    name: input.name,
    sessionType: input.sessionType ?? "strength",
    startedAt: now,
    completedAt: null,
    perceivedEffort: null,
    bodyweightKg: null,
    equipmentProfileId: input.equipmentProfileId ?? null,
    locationNote: null,
    notes: null,
    programId: null,
    plannedSessionId: null,
    dirty: 1,
    deleted: 0,
    updatedAt: now,
  };

  await db.sessions.add(session);
  scheduleSync();
  return session.id;
}

/** The session still in progress, if any. At most one is expected. */
export async function getActiveSession(): Promise<LocalSession | undefined> {
  const db = getLocalDb();
  const open = await db.sessions.filter((s) => s.completedAt === null && s.deleted === 0).toArray();
  // Newest first, so an accidental duplicate surfaces the one just started.
  return open.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export async function finishSession(
  sessionId: string,
  input: { perceivedEffort?: number | null; notes?: string | null } = {},
): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();

  await db.sessions.update(sessionId, {
    completedAt: now,
    perceivedEffort: input.perceivedEffort ?? null,
    notes: input.notes ?? null,
    dirty: 1,
    updatedAt: now,
  });
  scheduleSync();
}

/** Abandons a session and everything logged in it. */
export async function discardSession(sessionId: string): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();

  await db.transaction("rw", db.sessions, db.setLogs, async () => {
    const logs = await db.setLogs.where("sessionId").equals(sessionId).toArray();
    for (const log of logs) {
      // Rows the server has never seen can be dropped outright; anything already
      // synced needs a tombstone so the deletion propagates.
      if (log.dirty === 1) await db.setLogs.delete(log.id);
      else await db.setLogs.update(log.id, { deleted: 1, dirty: 1, updatedAt: now });
    }

    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (session.dirty === 1 && logs.every((l) => l.dirty === 1)) {
      await db.sessions.delete(sessionId);
    } else {
      await db.sessions.update(sessionId, { deleted: 1, dirty: 1, updatedAt: now });
    }
  });
  scheduleSync();
}

export type SetInput = {
  weightKg?: number | null;
  reps?: number | null;
  rir?: number | null;
  rpe?: number | null;
  timeSeconds?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  isWarmup?: boolean;
  isAmrap?: boolean;
  notes?: string | null;
};

export async function logSet(
  sessionId: string,
  exerciseId: string,
  input: SetInput,
): Promise<string> {
  const db = getLocalDb();
  const now = new Date().toISOString();

  // Numbered per exercise, not per session, so "set 3 of bench" means what the
  // lifter expects even when exercises are interleaved in a superset.
  const existing = await db.setLogs
    .where("sessionId")
    .equals(sessionId)
    .filter((s) => s.exerciseId === exerciseId && s.deleted === 0)
    .count();

  const row: LocalSetLog = {
    id: newId(),
    sessionId,
    exerciseId,
    plannedExerciseId: null,
    setIndex: existing,
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    rir: input.rir ?? null,
    rpe: input.rpe ?? null,
    timeSeconds: input.timeSeconds ?? null,
    distanceM: input.distanceM ?? null,
    calories: input.calories ?? null,
    isWarmup: input.isWarmup ? 1 : 0,
    isAmrap: input.isAmrap ? 1 : 0,
    isFailed: 0,
    tempo: null,
    notes: input.notes ?? null,
    completedAt: now,
    dirty: 1,
    deleted: 0,
    updatedAt: now,
  };

  await db.setLogs.add(row);
  scheduleSync();
  return row.id;
}

export async function updateSet(setId: string, input: SetInput): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();

  const patch: Partial<LocalSetLog> = { dirty: 1, updatedAt: now };
  if (input.weightKg !== undefined) patch.weightKg = input.weightKg;
  if (input.reps !== undefined) patch.reps = input.reps;
  if (input.rir !== undefined) patch.rir = input.rir;
  if (input.rpe !== undefined) patch.rpe = input.rpe;
  if (input.timeSeconds !== undefined) patch.timeSeconds = input.timeSeconds;
  if (input.isWarmup !== undefined) patch.isWarmup = input.isWarmup ? 1 : 0;
  if (input.isAmrap !== undefined) patch.isAmrap = input.isAmrap ? 1 : 0;
  if (input.notes !== undefined) patch.notes = input.notes;

  await db.setLogs.update(setId, patch);
  scheduleSync();
}

export async function deleteSet(setId: string): Promise<void> {
  const db = getLocalDb();
  const row = await getLocalDb().setLogs.get(setId);
  if (!row) return;

  if (row.dirty === 1) {
    // Never reached the server, so no tombstone is needed.
    await db.setLogs.delete(setId);
  } else {
    await db.setLogs.update(setId, {
      deleted: 1,
      dirty: 1,
      updatedAt: new Date().toISOString(),
    });
  }
  scheduleSync();
}

/**
 * Refreshes the offline exercise mirror.
 *
 * Called with the server-rendered list on each page load so the picker keeps
 * working after the connection drops.
 */
export async function cacheExercises(exercises: CachedExercise[]): Promise<void> {
  if (exercises.length === 0) return;
  await getLocalDb().exercises.bulkPut(exercises);
}

export async function getCachedExercises(): Promise<CachedExercise[]> {
  return getLocalDb().exercises.orderBy("slug").toArray();
}

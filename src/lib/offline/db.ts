import Dexie, { type Table } from "dexie";

/**
 * Local-first store for training data.
 *
 * IndexedDB is the source of truth while a session is in progress. Sets are
 * written here first and pushed to Postgres afterwards, because gym signal is
 * unreliable and losing a logged set is the single most infuriating failure this
 * app could have.
 *
 * Sync is an idempotent upsert keyed on the row id, which is a UUID generated on
 * this device. That is why the server schema uses client-generatable UUIDs rather
 * than sequences — see the note at the top of `src/lib/db/schema.ts`.
 */

/**
 * Booleans cannot be indexed by IndexedDB, so flags are stored as 0/1. Keeping
 * that at the storage boundary rather than leaking it into the UI.
 */
export type Flag = 0 | 1;

type SyncFields = {
  /** 1 when this row has local changes not yet accepted by the server. */
  dirty: Flag;
  /** Tombstone: pushed as a deletion, then removed locally once confirmed. */
  deleted: Flag;
  updatedAt: string;
};

export type LocalSession = SyncFields & {
  id: string;
  name: string;
  sessionType: string;
  /** ISO 8601. Stored as a string so IndexedDB ordering is lexicographic. */
  startedAt: string;
  completedAt: string | null;
  perceivedEffort: number | null;
  bodyweightKg: number | null;
  equipmentProfileId: string | null;
  locationNote: string | null;
  notes: string | null;
  programId: string | null;
  plannedSessionId: string | null;
};

export type LocalSetLog = SyncFields & {
  id: string;
  sessionId: string;
  exerciseId: string;
  plannedExerciseId: string | null;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  timeSeconds: number | null;
  distanceM: number | null;
  calories: number | null;
  isWarmup: Flag;
  isAmrap: Flag;
  isFailed: Flag;
  tempo: string | null;
  notes: string | null;
  completedAt: string;
};

/**
 * Mirror of the exercise library so the picker works with no connection.
 * Refreshed opportunistically; never the source of truth.
 */
export type CachedExercise = {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  movementPattern: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  requiredEquipment: string[];
  loadType: string;
  isUnilateral: boolean;
  isCompound: boolean;
  complexity: number;
  stimulusFatigueRatio: number;
  defaultRepMin: number;
  defaultRepMax: number;
  substitutionGroup: string | null;
};

export type MetaRow = { key: string; value: string };

class FitnessDatabase extends Dexie {
  sessions!: Table<LocalSession, string>;
  setLogs!: Table<LocalSetLog, string>;
  exercises!: Table<CachedExercise, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("fitness-tracker");
    this.version(1).stores({
      // Only indexed fields are listed; the rest of each row is still stored.
      sessions: "id, startedAt, completedAt, dirty",
      setLogs: "id, sessionId, exerciseId, completedAt, dirty, [sessionId+setIndex]",
      exercises: "id, slug, movementPattern",
      meta: "key",
    });
  }
}

let instance: FitnessDatabase | null = null;

/**
 * Lazily constructs the database.
 *
 * Never at module load: client components are still rendered on the server for
 * the initial HTML, where `indexedDB` does not exist, and Dexie's constructor
 * would throw during SSR.
 */
export function getLocalDb(): FitnessDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("getLocalDb() called outside the browser");
  }
  instance ??= new FitnessDatabase();
  return instance;
}

export function isLocalDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Marks a row as needing sync. Every local write should go through this. */
export function withDirty<T extends object>(row: T): T & Pick<SyncFields, "dirty" | "updatedAt"> {
  return { ...row, dirty: 1, updatedAt: new Date().toISOString() };
}

export function newId(): string {
  return crypto.randomUUID();
}

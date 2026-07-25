import { getLocalDb, isLocalDbAvailable, type LocalSession, type LocalSetLog } from "./db";

/**
 * Pushes locally-logged data to the server.
 *
 * Push-only by design. Sets are created on exactly one device at a time — the
 * one in your hand — so there is no concurrent-edit problem to resolve and no
 * need for the complexity of bidirectional merge. Historical data is read from
 * the server directly.
 */

export type SyncResult =
  | { status: "idle"; pending: 0 }
  | { status: "synced"; pushed: number }
  | { status: "offline"; pending: number }
  | { status: "partial"; pushed: number; rejected: number; firstReason: string }
  | { status: "error"; pending: number; message: string };

/** Strips local bookkeeping fields the server neither needs nor accepts. */
function forWire<T extends LocalSession | LocalSetLog>(row: T) {
  const { dirty: _dirty, updatedAt: _updatedAt, ...rest } = row;
  return rest;
}

export async function countPending(): Promise<number> {
  if (!isLocalDbAvailable()) return 0;
  const db = getLocalDb();
  const [a, b] = await Promise.all([
    db.sessions.where("dirty").equals(1).count(),
    db.setLogs.where("dirty").equals(1).count(),
  ]);
  return a + b;
}

let inFlight: Promise<SyncResult> | null = null;

type Listener = (result: SyncResult) => void;
const listeners = new Set<Listener>();

/**
 * Subscribes to every sync outcome, whoever triggered it.
 *
 * Needed because most pushes are kicked off by logging a set, not by the
 * lifecycle triggers. Without this the UI would never learn that a push failed
 * and would sit on "syncing…" indefinitely — precisely when the user wants to
 * know their set is safely on the device.
 */
export function subscribeSyncResult(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Pushes every dirty row. Concurrent calls share one request, so the several
 * triggers (a set being logged, coming back online, the tab regaining focus)
 * cannot stampede.
 */
export function pushPending(): Promise<SyncResult> {
  inFlight ??= run()
    .then((result) => {
      for (const listener of listeners) listener(result);
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function run(): Promise<SyncResult> {
  if (!isLocalDbAvailable()) return { status: "idle", pending: 0 };

  const db = getLocalDb();
  const dirtySessions = await db.sessions.where("dirty").equals(1).toArray();
  const dirtySetLogs = await db.setLogs.where("dirty").equals(1).toArray();
  const pending = dirtySessions.length + dirtySetLogs.length;

  if (pending === 0) return { status: "idle", pending: 0 };

  // navigator.onLine only proves a network interface exists, not that the server
  // is reachable — but a false here is reliable, so it saves a doomed request.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "offline", pending };
  }

  let response: Response;
  try {
    response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessions: dirtySessions.map(forWire),
        setLogs: dirtySetLogs.map(forWire),
      }),
    });
  } catch {
    // Network-level failure: data stays dirty and will be retried.
    return { status: "offline", pending };
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? "Signed out — sign in again to sync."
        : `Server returned ${response.status}.`;
    return { status: "error", pending, message };
  }

  const body = (await response.json()) as {
    accepted: { sessions: string[]; setLogs: string[] };
    rejected: {
      sessions: { id: string; reason: string }[];
      setLogs: { id: string; reason: string }[];
    };
  };

  const acceptedSessions = new Set(body.accepted.sessions);
  const acceptedSetLogs = new Set(body.accepted.setLogs);

  // Only clear rows the server actually accepted. Anything rejected stays dirty
  // and visible, rather than being silently dropped.
  await db.transaction("rw", db.sessions, db.setLogs, async () => {
    for (const row of dirtySessions) {
      if (!acceptedSessions.has(row.id)) continue;
      if (row.deleted === 1) await db.sessions.delete(row.id);
      else await db.sessions.update(row.id, { dirty: 0 });
    }
    for (const row of dirtySetLogs) {
      if (!acceptedSetLogs.has(row.id)) continue;
      if (row.deleted === 1) await db.setLogs.delete(row.id);
      else await db.setLogs.update(row.id, { dirty: 0 });
    }
  });

  const rejected = body.rejected.sessions.length + body.rejected.setLogs.length;
  const pushed = acceptedSessions.size + acceptedSetLogs.size;

  if (rejected > 0) {
    const first = body.rejected.sessions[0] ?? body.rejected.setLogs[0];
    return { status: "partial", pushed, rejected, firstReason: first.reason };
  }

  await db.meta.put({ key: "lastSyncAt", value: new Date().toISOString() });
  return { status: "synced", pushed };
}

/**
 * Wires up automatic sync. Returns a teardown function.
 *
 * `visibilitychange` matters more than it looks: phones aggressively suspend
 * background tabs, so returning to the app is often the first chance to push
 * sets logged while the screen was off.
 */
export function startAutoSync(): () => void {
  if (typeof window === "undefined") return () => {};

  // Results reach the UI via subscribeSyncResult, so nothing is returned here.
  const trigger = () => {
    void pushPending().catch(() => {});
  };

  // Named so teardown can actually remove it — an inline arrow here would leak
  // a listener on every remount.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") trigger();
  };

  window.addEventListener("online", trigger);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Best-effort flush when the page goes away. Not guaranteed to complete, which
  // is fine — anything unsent is still dirty locally and retried next launch.
  window.addEventListener("pagehide", trigger);

  trigger();

  return () => {
    window.removeEventListener("online", trigger);
    window.removeEventListener("pagehide", trigger);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export async function getLastSyncAt(): Promise<Date | null> {
  if (!isLocalDbAvailable()) return null;
  const row = await getLocalDb().meta.get("lastSyncAt");
  return row ? new Date(row.value) : null;
}

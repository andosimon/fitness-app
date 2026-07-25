"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";

import { getLocalDb, isLocalDbAvailable, type CachedExercise, type LocalSetLog } from "@/lib/offline/db";
import {
  cacheExercises,
  deleteSet,
  discardSession,
  finishSession,
  getActiveSession,
  logSet,
  startSession,
} from "@/lib/offline/session";
import {
  countPending,
  startAutoSync,
  subscribeSyncResult,
  type SyncResult,
} from "@/lib/offline/sync";

import { ExercisePicker } from "./exercise-picker";
import { RestTimer } from "./rest-timer";

/**
 * The in-gym logging screen.
 *
 * Reads and writes IndexedDB exclusively; the server is only touched by the
 * background sync. Nothing here awaits the network, so recording a set is
 * instant regardless of signal.
 */

/** Which inputs make sense for a given load type. */
function fieldsFor(loadType: string): { weight: boolean; reps: boolean; time: boolean } {
  switch (loadType) {
    case "time":
      return { weight: false, reps: false, time: true };
    case "distance":
    case "calories":
      return { weight: false, reps: true, time: true };
    case "bodyweight":
    case "reps_only":
    case "band":
    case "bodyweight_assisted":
      return { weight: false, reps: true, time: false };
    default:
      return { weight: true, reps: true, time: false };
  }
}

function SyncStatus() {
  const [pending, setPending] = useState<number | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    if (!isLocalDbAvailable()) return;
    // Subscribing catches outcomes from every trigger, including the pushes
    // kicked off by logging a set.
    const unsubscribe = subscribeSyncResult(setResult);
    const stop = startAutoSync();
    const id = window.setInterval(() => void countPending().then(setPending), 2000);
    void countPending().then(setPending);
    return () => {
      unsubscribe();
      stop();
      window.clearInterval(id);
    };
  }, []);

  if (pending === null) return null;

  const stalled = result?.status === "offline" || result?.status === "error";

  const label =
    pending > 0
      ? stalled
        ? `${pending} set${pending === 1 ? "" : "s"} saved on device`
        : `syncing ${pending}…`
      : "all synced";

  const tone = pending > 0 ? (stalled ? "text-warning" : "text-muted") : "text-success";

  return (
    <p className={`text-xs ${tone}`} aria-live="polite">
      {label}
      {result?.status === "partial" ? ` · ${result.rejected} rejected: ${result.firstReason}` : ""}
      {result?.status === "error" ? ` · ${result.message}` : ""}
    </p>
  );
}

export function SessionView({ exercises: serverExercises }: { exercises: CachedExercise[] }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [activeExerciseIds, setActiveExerciseIds] = useState<string[]>([]);

  // Refresh the offline mirror on every load while a connection exists. This is
  // an effect updating an external system, which is what effects are for.
  useEffect(() => {
    if (!isLocalDbAvailable() || serverExercises.length === 0) return;
    void cacheExercises(serverExercises);
  }, [serverExercises]);

  /**
   * Wrapped in an object so "still loading" is distinguishable from "no active
   * session" — `useLiveQuery` returns undefined until the first result arrives,
   * and `getActiveSession()` also returns undefined when nothing is open.
   *
   * The `isLocalDbAvailable()` guard covers server rendering, where there is no
   * IndexedDB; no mounted flag is needed, which keeps setState out of effects.
   */
  const sessionQuery = useLiveQuery(
    () =>
      isLocalDbAvailable()
        ? getActiveSession().then((s) => ({ session: s ?? null }))
        : undefined,
    [],
  );
  const session = sessionQuery?.session ?? null;

  const sets = useLiveQuery(
    () =>
      isLocalDbAvailable() && session
        ? getLocalDb().setLogs.where("sessionId").equals(session.id).toArray()
        : Promise.resolve([] as LocalSetLog[]),
    [session?.id],
    [] as LocalSetLog[],
  );

  const cached = useLiveQuery(
    () =>
      isLocalDbAvailable()
        ? getLocalDb().exercises.toArray()
        : Promise.resolve([] as CachedExercise[]),
    [],
    [] as CachedExercise[],
  );

  // Prefer the cached mirror once populated; fall back to the server payload on
  // a cold first load before the cache is written.
  const library = cached.length > 0 ? cached : serverExercises;
  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);

  const liveSets = useMemo(() => sets.filter((s) => s.deleted === 0), [sets]);

  /** Exercises in the session, ordered by when each first appeared. */
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, LocalSetLog[]>();
    for (const s of [...liveSets].sort((a, b) => a.completedAt.localeCompare(b.completedAt))) {
      if (!map.has(s.exerciseId)) {
        map.set(s.exerciseId, []);
        order.push(s.exerciseId);
      }
      map.get(s.exerciseId)!.push(s);
    }
    for (const id of activeExerciseIds) {
      if (!map.has(id)) {
        map.set(id, []);
        order.push(id);
      }
    }
    return order.map((id) => ({ exerciseId: id, sets: map.get(id) ?? [] }));
  }, [liveSets, activeExerciseIds]);

  // undefined means the first local read has not resolved yet.
  if (sessionQuery === undefined && isLocalDbAvailable()) {
    return <p className="mt-8 text-sm text-muted">Loading…</p>;
  }

  if (!isLocalDbAvailable()) {
    return (
      <p className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        This browser has no IndexedDB support, so offline logging is unavailable.
      </p>
    );
  }

  if (!session) {
    return (
      <div className="mt-8">
        <p className="text-sm text-muted">No session in progress.</p>
        <button
          type="button"
          onClick={() =>
            void startSession({
              name: new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short",
              }),
            })
          }
          className="mt-4 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Start a session
        </button>
        <SyncStatus />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{session.name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {liveSets.length} set{liveSets.length === 1 ? "" : "s"} ·{" "}
            {new Date(session.startedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <SyncStatus />
        </div>
      </div>

      <RestTimer runningSince={restStartedAt} onDismiss={() => setRestStartedAt(null)} />

      {grouped.map(({ exerciseId, sets: exerciseSets }) => {
        const exercise = byId.get(exerciseId);
        if (!exercise) return null;
        return (
          <ExerciseBlock
            key={exerciseId}
            exercise={exercise}
            sets={exerciseSets}
            sessionId={session.id}
            onLogged={() => setRestStartedAt(Date.now())}
          />
        );
      })}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="rounded-xl border border-dashed border-border px-4 py-3.5 text-base text-muted transition-colors hover:border-accent hover:text-text"
      >
        + Add exercise
      </button>

      <div className="mt-4 flex gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void finishSession(session.id)}
          disabled={liveSets.length === 0}
          className="flex-1 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Finish session
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("Discard this session and everything logged in it?")) {
              void discardSession(session.id);
              setActiveExerciseIds([]);
            }
          }}
          className="rounded-xl border border-border px-4 py-3 text-sm text-muted transition-colors hover:text-danger"
        >
          Discard
        </button>
      </div>

      {pickerOpen ? (
        <ExercisePicker
          exercises={library}
          recentIds={grouped.map((g) => g.exerciseId)}
          onSelect={(ex) => {
            setActiveExerciseIds((prev) => (prev.includes(ex.id) ? prev : [...prev, ex.id]));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ExerciseBlock({
  exercise,
  sets,
  sessionId,
  onLogged,
}: {
  exercise: CachedExercise;
  sets: LocalSetLog[];
  sessionId: string;
  onLogged: () => void;
}) {
  const fields = fieldsFor(exercise.loadType);
  const last = sets[sets.length - 1];

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-medium">{exercise.name}</h2>
      <p className="mt-0.5 text-xs text-muted">
        target {exercise.defaultRepMin}–{exercise.defaultRepMax} reps
      </p>

      {sets.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1">
          {sets.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm"
            >
              <span className="w-5 shrink-0 text-muted">{i + 1}</span>
              <span className="flex-1">
                {s.weightKg != null ? `${s.weightKg} kg × ` : ""}
                {s.reps != null ? `${s.reps}` : ""}
                {s.timeSeconds != null ? `${s.timeSeconds}s` : ""}
                {s.rir != null ? `  @ RIR ${s.rir}` : ""}
              </span>
              {s.dirty === 1 ? (
                <span className="shrink-0 text-xs text-muted" title="Not yet synced">
                  ●
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void deleteSet(s.id)}
                aria-label={`Delete set ${i + 1}`}
                className="shrink-0 px-1 text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {/*
        Keyed on the latest set so the form remounts with fresh initial values
        after each log. This is React's recommended way to reset state when
        inputs change — cheaper to reason about than syncing via an effect, and
        it keeps setState out of effects entirely.
      */}
      <SetEntryForm
        key={last?.id ?? "empty"}
        fields={fields}
        initial={{
          weight: last?.weightKg != null ? String(last.weightKg) : "",
          reps: last?.reps != null ? String(last.reps) : "",
          seconds: last?.timeSeconds != null ? String(last.timeSeconds) : "",
          rir: last?.rir != null ? String(last.rir) : "",
        }}
        onSubmit={async (values) => {
          await logSet(sessionId, exercise.id, {
            weightKg: fields.weight ? values.weight : null,
            reps: fields.reps ? values.reps : null,
            timeSeconds: fields.time ? values.seconds : null,
            rir: values.rir,
          });
          onLogged();
        }}
      />
    </section>
  );
}

type EntryFields = ReturnType<typeof fieldsFor>;

/**
 * Set entry inputs. Values are prefilled from the previous set, because
 * consecutive sets usually repeat the same load — one tap to log rather than
 * re-typing both numbers.
 */
function SetEntryForm({
  fields,
  initial,
  onSubmit,
}: {
  fields: EntryFields;
  initial: { weight: string; reps: string; seconds: string; rir: string };
  onSubmit: (values: {
    weight: number | null;
    reps: number | null;
    seconds: number | null;
    rir: number | null;
  }) => Promise<void>;
}) {
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  const [seconds, setSeconds] = useState(initial.seconds);
  const [rir, setRir] = useState(initial.rir);

  const num = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  };

  const canLog = fields.time ? num(seconds) !== null : num(reps) !== null;

  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-base outline-none focus:border-accent";

  return (
    <div className="mt-3 flex items-end gap-2">
      {fields.weight ? (
        <label className="flex-1">
          <span className="block text-xs text-muted">kg</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      {fields.reps ? (
        <label className="flex-1">
          <span className="block text-xs text-muted">reps</span>
          <input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      {fields.time ? (
        <label className="flex-1">
          <span className="block text-xs text-muted">seconds</span>
          <input
            type="number"
            inputMode="numeric"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      <label className="w-16">
        <span className="block text-xs text-muted">RIR</span>
        <input
          type="number"
          inputMode="numeric"
          value={rir}
          onChange={(e) => setRir(e.target.value)}
          className={inputClass}
        />
      </label>

      <button
        type="button"
        onClick={() =>
          void onSubmit({
            weight: num(weight),
            reps: num(reps),
            seconds: num(seconds),
            rir: num(rir),
          })
        }
        disabled={!canLog}
        className="rounded-lg bg-accent px-4 py-2.5 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        Log
      </button>
    </div>
  );
}

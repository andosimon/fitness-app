"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { getLocalDb, isLocalDbAvailable, type CachedExercise, type LocalSetLog } from "@/lib/offline/db";
import {
  cacheExercises,
  countSetsForSessions,
  deleteSet,
  discardSession,
  finishSession,
  getActiveSession,
  getRecentCompletedSessions,
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

/**
 * Recently finished sessions, shown when nothing is in progress.
 *
 * Read from the local mirror so a session appears the instant it is finished,
 * without waiting for a sync or a server round trip. Previously, finishing a
 * session left the screen showing only "No session in progress", which made the
 * logged work look like it had disappeared.
 */
function RecentSessions() {
  const recent = useLiveQuery(
    () =>
      isLocalDbAvailable()
        ? getRecentCompletedSessions(3)
        : Promise.resolve([] as Awaited<ReturnType<typeof getRecentCompletedSessions>>),
    [],
    [],
  );

  const counts = useLiveQuery(
    () => countSetsForSessions(recent.map((s) => s.id)),
    [recent.map((s) => s.id).join(",")],
    {} as Record<string, number>,
  );

  if (recent.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">Recent</h2>
        <Link href="/history" className="text-sm text-muted transition-colors hover:text-text">
          All history →
        </Link>
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {recent.map((s) => (
          <li key={s.id}>
            <Link
              href={`/history/${s.id}`}
              className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{s.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {counts[s.id] ?? 0} set{(counts[s.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              <span className="mt-0.5 block text-xs text-muted">
                {s.completedAt
                  ? new Date(s.completedAt).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null}
                {s.dirty === 1 ? " · not yet synced" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The prescription for one exercise, as planned. */
export type PlannedRow = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  targetRir: number | null;
  targetRpe: number | null;
  targetPercent1rm: number | null;
  supersetGroup: string | null;
  tempo: string | null;
  notes: string | null;
  /** Derived from logged history; null when there is none yet. */
  suggestedLoadKg: number | null;
  suggestionReason: string | null;
  estimatedOneRepMax: number | null;
  /** True when travel mode found nothing that could stand in. */
  unavailable?: boolean;
};

export type PlannedSessionProp = {
  id: string;
  name: string;
  weekNumber: number;
  isDeload: boolean;
  targetMinutes: number;
  programId: string;
  programName: string;
  notes: string | null;
  exercises: PlannedRow[];
} | null;

/** Renders a prescription the way a coach would write it. */
function describePrescription(row: PlannedRow): string {
  const reps =
    row.repMin === null
      ? ""
      : row.repMin === row.repMax
        ? `${row.repMin}`
        : `${row.repMin}-${row.repMax}`;
  const cue =
    row.targetRpe !== null
      ? ` @ RPE ${row.targetRpe}${row.targetPercent1rm ? ` (~${Math.round(row.targetPercent1rm)}%)` : ""}`
      : row.targetRir !== null
        ? ` @ RIR ${row.targetRir}`
        : "";
  return `${row.sets} × ${reps}${cue}`;
}

export type UpcomingSessionProp = {
  id: string;
  name: string;
  weekNumber: number;
  dayIndex: number;
  isDeload: boolean;
};

export function SessionView({
  exercises: serverExercises,
  planned,
  upcoming,
  availableEquipment,
  equipmentProfileName,
  fatigue,
  equipmentProfiles,
  activeEquipmentId,
  adaptationSummary,
}: {
  exercises: CachedExercise[];
  planned: PlannedSessionProp;
  upcoming: UpcomingSessionProp[];
  availableEquipment: string[];
  equipmentProfileName: string | null;
  fatigue: { status: string; note: string } | null;
  equipmentProfiles: { id: string; name: string }[];
  activeEquipmentId: string | null;
  /** Present when the session has been re-fitted to different kit. */
  adaptationSummary: string | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [activeExerciseIds, setActiveExerciseIds] = useState<string[]>([]);

  /**
   * Whether this browser has IndexedDB.
   *
   * The server snapshot is `true` deliberately. There is no `indexedDB` during
   * server rendering, and treating that as "unsupported" made the initial HTML
   * an error message — which the service worker could then cache. Assuming
   * support on the server lets the planned session, which is server data,
   * render immediately; a genuinely unsupported browser corrects itself on
   * hydration. `useSyncExternalStore` is the supported way to hold a
   * client-only value without writing state from an effect.
   */
  const hasLocalDb = useSyncExternalStore(
    () => () => {},
    () => isLocalDbAvailable(),
    () => true,
  );

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

  /**
   * Exercises in the session.
   *
   * When following a plan, the order comes from the plan itself rather than
   * component state, so it survives a reload mid-session — losing your place
   * because the screen locked would be unforgivable in a gym.
   */
  const followingPlan =
    planned !== null && session?.plannedSessionId === planned.id ? planned : null;

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, LocalSetLog[]>();

    if (followingPlan) {
      for (const row of followingPlan.exercises) {
        if (!map.has(row.exerciseId)) {
          map.set(row.exerciseId, []);
          order.push(row.exerciseId);
        }
      }
    }

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
  }, [liveSets, activeExerciseIds, followingPlan]);

  /** First prescription row per exercise, for showing the target. */
  const prescriptionByExercise = useMemo(() => {
    const map = new Map<string, PlannedRow>();
    for (const row of followingPlan?.exercises ?? []) {
      if (!map.has(row.exerciseId)) map.set(row.exerciseId, row);
    }
    return map;
  }, [followingPlan]);

  if (!hasLocalDb) {
    return (
      <p className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        This browser has no IndexedDB support, so offline logging is unavailable.
      </p>
    );
  }

  if (!session) {
    const adHocName = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });

    // Alternatives to whichever session is currently shown.
    const otherSessions = upcoming.filter((s) => s.id !== planned?.id).slice(0, 5);

    return (
      <div className="mt-6">
        {planned ? (
          <section className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-lg font-semibold tracking-tight">{planned.name}</h1>
              <span className="shrink-0 font-mono text-xs text-muted">
                wk {planned.weekNumber}
                {planned.isDeload ? " · deload" : ""}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {planned.programName} · about {planned.targetMinutes} min
            </p>

            {planned.notes ? (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                {planned.notes}
              </p>
            ) : null}

            {/*
              A pattern read from logged effort, not a verdict. An app knows what
              you recorded, not how you feel.
            */}
            {fatigue && fatigue.status !== "on_track" ? (
              <p
                className={`mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs ${
                  fatigue.status === "running_hot" ? "text-warning" : "text-muted"
                }`}
              >
                {fatigue.note}
              </p>
            ) : null}

            <ol className="mt-3 flex flex-col gap-1">
              {planned.exercises.map((row) => (
                <li
                  key={row.id}
                  className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                    row.unavailable ? "bg-surface-2 opacity-50" : "bg-surface-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className={row.unavailable ? "line-through" : ""}>
                      {row.exerciseName}
                    </span>
                    {row.supersetGroup ? (
                      <span className="ml-1.5 text-xs text-accent">superset</span>
                    ) : null}
                    {row.tempo ? (
                      <span className="mt-0.5 block text-xs text-muted">{row.tempo}</span>
                    ) : null}
                    {/* Swap explanations, so a substitution is never silent. */}
                    {row.notes ? (
                      <span className="mt-0.5 block text-xs text-muted">{row.notes}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs text-muted">
                      {describePrescription(row)}
                    </span>
                    {row.suggestedLoadKg !== null ? (
                      <span className="block font-mono text-xs text-accent">
                        {row.suggestedLoadKg} kg
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() =>
                void startSession({
                  name: planned.name,
                  plannedSessionId: planned.id,
                  programId: planned.programId,
                })
              }
              className="mt-4 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Start this session
            </button>

            {/*
              Travel mode. Substitutes only what the equipment forces, so the
              session stays recognisably the one that was planned, and says
              plainly what it cannot cover.
            */}
            {equipmentProfiles.length > 1 ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs text-muted">Training somewhere else?</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {equipmentProfiles.map((profile) => {
                    const active = profile.id === activeEquipmentId;
                    return (
                      <Link
                        key={profile.id}
                        href={`/?session=${planned.id}&equipment=${profile.id}`}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          active
                            ? "border-accent text-accent"
                            : "border-border text-muted hover:text-text"
                        }`}
                      >
                        {profile.name}
                      </Link>
                    );
                  })}
                </div>
                {adaptationSummary ? (
                  <p className="mt-2 text-xs text-muted">{adaptationSummary}</p>
                ) : null}
              </div>
            ) : null}

            {/*
              The plan is a queue, not a calendar. Training what you are set up
              for is normal, and forcing strict sequence order meant a legs day
              got logged ad-hoc because the queue said upper body.
            */}
            {otherSessions.length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs text-muted">Doing a different one today?</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {otherSessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/?session=${s.id}`}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-text"
                    >
                      {s.name}
                      <span className="ml-1 font-mono opacity-60">wk{s.weekNumber}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <p className="text-sm text-muted">
              No programme yet. Generate one and your next session appears here.
            </p>
            <Link
              href="/program/new"
              className="mt-4 block rounded-xl bg-accent px-4 py-3.5 text-center text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Create a programme
            </Link>
          </>
        )}

        <button
          type="button"
          onClick={() => void startSession({ name: adHocName })}
          className="mt-3 w-full rounded-xl border border-border px-4 py-3 text-sm text-muted transition-colors hover:text-text"
        >
          Log something else instead
        </button>

        <div className="mt-2">
          <SyncStatus />
        </div>
        <RecentSessions />
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
            prescription={prescriptionByExercise.get(exerciseId) ?? null}
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
          availableEquipment={availableEquipment}
          equipmentProfileName={equipmentProfileName}
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
  prescription,
  onLogged,
}: {
  exercise: CachedExercise;
  sets: LocalSetLog[];
  sessionId: string;
  prescription: PlannedRow | null;
  onLogged: () => void;
}) {
  const fields = fieldsFor(exercise.loadType);
  const last = sets[sets.length - 1];
  const done = sets.length;
  const planned = prescription?.sets ?? null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">{exercise.name}</h2>
        {planned !== null ? (
          <span
            className={`shrink-0 font-mono text-xs ${done >= planned ? "text-success" : "text-muted"}`}
          >
            {done}/{planned}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {prescription
          ? describePrescription(prescription)
          : `target ${exercise.defaultRepMin}–${exercise.defaultRepMax} reps`}
        {prescription?.tempo ? ` · ${prescription.tempo}` : ""}
      </p>
      {prescription?.notes ? (
        <p className="mt-1 text-xs text-accent">{prescription.notes}</p>
      ) : null}

      {/* The load suggestion earns its place by explaining itself. */}
      {prescription?.suggestionReason && done === 0 ? (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {prescription.suggestedLoadKg !== null ? (
            <span className="font-mono text-accent">{prescription.suggestedLoadKg} kg · </span>
          ) : null}
          {prescription.suggestionReason}
          {prescription.estimatedOneRepMax !== null ? (
            <span className="mt-0.5 block opacity-70">
              Estimated max {prescription.estimatedOneRepMax} kg.
            </span>
          ) : null}
        </p>
      ) : null}

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
          // Prefill from the last set of this session; failing that, from the
          // suggested load, so the first set of a planned exercise is one tap.
          weight:
            last?.weightKg != null
              ? String(last.weightKg)
              : prescription?.suggestedLoadKg != null
                ? String(prescription.suggestedLoadKg)
                : "",
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

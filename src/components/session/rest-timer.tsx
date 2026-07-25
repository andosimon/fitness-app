"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Rest timer between sets.
 *
 * Remaining time is derived from a target timestamp rather than by decrementing a
 * counter. Phones throttle or suspend timers in backgrounded tabs, so a
 * decrementing interval would silently run slow exactly when you're not looking
 * at it — which is most of a rest period.
 */

const PRESETS = [60, 90, 120, 180, 300];

function format(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Short beep. Not all phones support vibration, so both are attempted. */
function alertDone() {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration unsupported or blocked; the beep below still fires.
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // Audio blocked without a prior user gesture. Non-critical.
  }
}

export function RestTimer({
  defaultSeconds = 120,
  runningSince,
  onDismiss,
}: {
  defaultSeconds?: number;
  /** Set to a timestamp to (re)start the countdown; null keeps it idle. */
  runningSince: number | null;
  onDismiss: () => void;
}) {
  const [duration, setDuration] = useState(defaultSeconds);
  const firedRef = useRef(false);

  const targetAt = runningSince === null ? null : runningSince + duration * 1000;

  /**
   * Only the clock is stored; `remaining` is derived below. Keeping remaining in
   * state would mean writing it from an effect, which causes cascading renders.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    firedRef.current = false;
    if (targetAt === null) return;

    // setState lives in the interval callback — the supported pattern for
    // subscribing to an external source of change, here the clock. 250ms keeps
    // the display honest at negligible battery cost and re-syncs quickly after
    // the tab is restored.
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= targetAt && !firedRef.current) {
        firedRef.current = true;
        alertDone();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [targetAt]);

  // `now` can be stale when the timer starts after a long idle spell, so it is
  // clamped to the start time — worst case the full duration shows for 250ms,
  // which is correct, rather than a nonsense value.
  const remaining =
    targetAt === null
      ? duration
      : (targetAt - Math.max(now, runningSince ?? now)) / 1000;

  const adjust = useCallback((delta: number) => {
    setDuration((d) => Math.max(15, Math.min(600, d + delta)));
  }, []);

  const running = targetAt !== null && remaining > 0;
  const overdue = targetAt !== null && remaining <= 0;

  return (
    <div
      className={`rounded-2xl border px-4 py-3 transition-colors ${
        overdue ? "border-success bg-success/10" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-3xl tabular-nums"
            aria-live="polite"
            aria-atomic="true"
          >
            {format(remaining)}
          </span>
          <span className="text-xs text-muted">
            {overdue ? "rest complete" : running ? "resting" : "rest timer"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjust(-30)}
            aria-label="Decrease rest by 30 seconds"
            className="size-9 rounded-lg border border-border text-sm text-muted hover:text-text"
          >
            −30
          </button>
          <button
            type="button"
            onClick={() => adjust(30)}
            aria-label="Increase rest by 30 seconds"
            className="size-9 rounded-lg border border-border text-sm text-muted hover:text-text"
          >
            +30
          </button>
          {targetAt !== null ? (
            <button
              type="button"
              onClick={onDismiss}
              className="ml-1 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
            >
              Skip
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDuration(p)}
            aria-pressed={duration === p}
            className={`rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${
              duration === p
                ? "border-accent text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {format(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

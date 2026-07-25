"use client";

import { useMemo, useState } from "react";

import type { CachedExercise } from "@/lib/offline/db";

/**
 * Exercise selection sheet.
 *
 * Filters in memory over the cached library so it stays usable with no
 * connection — the whole reason the library is mirrored into IndexedDB.
 */

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

export function ExercisePicker({
  exercises,
  recentIds,
  onSelect,
  onClose,
}: {
  exercises: CachedExercise[];
  /** Exercises already used this session, surfaced first for quick re-entry. */
  recentIds: string[];
  onSelect: (exercise: CachedExercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = exercises.filter((ex) => {
      if (!needle) return true;
      return (
        ex.name.toLowerCase().includes(needle) ||
        ex.aliases.some((a) => a.toLowerCase().includes(needle)) ||
        ex.primaryMuscles.some((m) => m.includes(needle)) ||
        ex.movementPattern.includes(needle)
      );
    });

    // Without a search term, put this session's exercises at the top: adding a
    // second set of something you're already doing is the commonest action.
    if (!needle && recentIds.length > 0) {
      const recent = new Set(recentIds);
      return [
        ...matches.filter((e) => recent.has(e.id)),
        ...matches.filter((e) => !recent.has(e.id)),
      ];
    }
    return matches;
  }, [exercises, query, recentIds]);

  const recent = new Set(recentIds);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          aria-label="Search exercises"
          autoFocus
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-base outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl border border-border px-3 py-2.5 text-sm text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto p-3">
        {results.map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => onSelect(ex)}
              className="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{ex.name}</span>
                {recent.has(ex.id) ? (
                  <span className="shrink-0 text-xs text-accent">in session</span>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {ex.defaultRepMin}–{ex.defaultRepMax}
                  </span>
                )}
              </div>
              <span className="mt-0.5 block text-sm text-muted">
                {humanise(ex.movementPattern)} · {ex.primaryMuscles.map(humanise).join(", ")}
              </span>
            </button>
          </li>
        ))}

        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted">
            {exercises.length === 0
              ? "No exercises cached yet. Connect once to download the library."
              : "Nothing matches that search."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

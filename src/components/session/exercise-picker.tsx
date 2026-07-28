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
  availableEquipment,
  equipmentProfileName,
  onSelect,
  onClose,
}: {
  exercises: CachedExercise[];
  /** Exercises already used this session, surfaced first for quick re-entry. */
  recentIds: string[];
  /** Equipment on hand. Filters the list unless explicitly overridden. */
  availableEquipment: string[];
  equipmentProfileName: string | null;
  onSelect: (exercise: CachedExercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * Filtered by default.
   *
   * Showing all 211 exercises when only 175 are performable led to logging a
   * machine leg curl against a set done with ankle weights. That is not just
   * untidy: the engine reads this history to suggest loads, so attributing work
   * to equipment that isn't there corrupts the input. The override exists
   * because training elsewhere is a normal thing to do.
   */
  const [showAll, setShowAll] = useState(false);

  const performable = useMemo(() => {
    if (showAll || availableEquipment.length === 0) return exercises;
    return exercises.filter((ex) =>
      ex.requiredEquipment.every((item) => availableEquipment.includes(item)),
    );
  }, [exercises, availableEquipment, showAll]);

  const hiddenCount = exercises.length - performable.length;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = performable.filter((ex) => {
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
  }, [performable, query, recentIds]);

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

      {hiddenCount > 0 || showAll ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
          <span className="text-muted">
            {showAll
              ? "Showing every exercise, including ones you have no kit for."
              : `${equipmentProfileName ?? "Your equipment"} · ${hiddenCount} hidden`}
          </span>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-muted transition-colors hover:text-text"
          >
            {showAll ? "Filter to my kit" : "Show all"}
          </button>
        </div>
      ) : null}

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

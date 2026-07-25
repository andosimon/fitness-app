"use client";

import { useMemo, useState } from "react";

import type {
  EquipmentProfileSummary,
  ExerciseListItem,
} from "@/lib/db/queries/exercises";
import { FOUNDATIONAL_PATTERNS } from "@/lib/domain/types";

/**
 * Client-side search and filtering over the whole library.
 *
 * All filtering happens in memory: the payload is small, results are instant,
 * and it keeps working with no connection — the picker is used mid-session.
 */

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

/** An exercise is performable only if every item it requires is available. */
function isAvailable(required: string[], available: string[]): boolean {
  return required.every((item) => available.includes(item));
}

const PATTERN_GROUPS = [
  { label: "All", patterns: null },
  { label: "Squat", patterns: ["squat"] },
  { label: "Hinge", patterns: ["hinge"] },
  { label: "Lunge", patterns: ["lunge"] },
  { label: "Push", patterns: ["horizontal_push", "vertical_push"] },
  { label: "Pull", patterns: ["horizontal_pull", "vertical_pull"] },
  { label: "Core", patterns: [
      "core_anti_extension",
      "core_anti_rotation",
      "core_flexion",
      "core_lateral_flexion",
    ],
  },
  { label: "Isolation", patterns: ["isolation_upper", "isolation_lower"] },
  { label: "Conditioning", patterns: ["conditioning", "carry"] },
] as const;

export function ExerciseBrowser({
  exercises,
  profiles,
}: {
  exercises: ExerciseListItem[];
  profiles: EquipmentProfileSummary[];
}) {
  const [query, setQuery] = useState("");
  const [groupIndex, setGroupIndex] = useState(0);
  const [profileId, setProfileId] = useState<string>("");

  const activeProfile = profiles.find((p) => p.id === profileId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const group = PATTERN_GROUPS[groupIndex];

    return exercises.filter((ex) => {
      if (group.patterns && !group.patterns.includes(ex.movementPattern as never)) return false;

      if (activeProfile && !isAvailable(ex.requiredEquipment, activeProfile.equipment)) {
        return false;
      }

      if (!needle) return true;
      return (
        ex.name.toLowerCase().includes(needle) ||
        ex.aliases.some((a) => a.toLowerCase().includes(needle)) ||
        ex.primaryMuscles.some((m) => m.includes(needle)) ||
        ex.movementPattern.includes(needle)
      );
    });
  }, [exercises, query, groupIndex, activeProfile]);

  /**
   * Which foundational patterns the selected equipment cannot train at all.
   * Surfaced because it is genuinely useful to know before travelling that,
   * say, a bare hotel room leaves you no way to load a vertical pull.
   */
  const uncoveredPatterns = useMemo(() => {
    if (!activeProfile) return [];
    return FOUNDATIONAL_PATTERNS.filter(
      (pattern) =>
        !exercises.some(
          (ex) =>
            ex.movementPattern === pattern &&
            isAvailable(ex.requiredEquipment, activeProfile.equipment),
        ),
    );
  }, [exercises, activeProfile]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Exercises</h1>
        <p className="text-sm text-muted">
          {filtered.length} of {exercises.length}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, muscle or pattern…"
          aria-label="Search exercises"
          className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-base outline-none focus:border-accent"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">
            Available equipment
          </span>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-base outline-none focus:border-accent"
          >
            <option value="">Everything (no filter)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {uncoveredPatterns.length > 0 ? (
        <p className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          <span className="font-medium text-warning">No option for</span>{" "}
          {uncoveredPatterns.map(humanise).join(", ")} with this equipment. The generator will
          redistribute that volume to the patterns you can train.
        </p>
      ) : null}

      <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PATTERN_GROUPS.map((group, i) => (
          <button
            key={group.label}
            type="button"
            onClick={() => setGroupIndex(i)}
            aria-pressed={i === groupIndex}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              i === groupIndex
                ? "border-accent bg-accent text-accent-fg"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {filtered.map((ex) => (
          <li
            key={ex.id}
            className="rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">{ex.name}</h2>
              <span className="shrink-0 font-mono text-xs text-muted">
                {ex.defaultRepMin}–{ex.defaultRepMax}
              </span>
            </div>

            <p className="mt-1 text-sm text-muted">
              <span className="text-accent">{humanise(ex.movementPattern)}</span>
              {" · "}
              {ex.primaryMuscles.map(humanise).join(", ")}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {ex.requiredEquipment.map((item) => (
                <span
                  key={item}
                  className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                >
                  {humanise(item)}
                </span>
              ))}
              {ex.isUnilateral ? (
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                  unilateral
                </span>
              ) : null}
              {/* Stimulus-to-fatigue is the tag the generator leans on most when
                  the time budget is tight, so it is worth surfacing. */}
              <span className="ml-auto shrink-0 font-mono text-xs text-muted">
                SFR {ex.stimulusFatigueRatio}/5
              </span>
            </div>
          </li>
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted">
          Nothing matches. Try clearing the equipment filter or the search.
        </p>
      ) : null}
    </div>
  );
}

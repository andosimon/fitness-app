"use client";

import { useActionState, useState } from "react";

import { createProgramAction, type CreateProgramState } from "../actions";

const initial: CreateProgramState = {};

const SPLITS = [
  { value: "upper_lower", label: "Upper / Lower", note: "Even at 4 days" },
  { value: "full_body", label: "Full Body", note: "Highest frequency" },
  { value: "push_pull_legs", label: "Push / Pull / Legs", note: "Rolls at 4 days" },
  { value: "push_pull", label: "Push / Pull", note: "Even at 4 days" },
];

const SPECIALISATIONS = [
  { value: "", label: "No specific lift — balanced" },
  { value: "squat", label: "Squat" },
  { value: "hinge", label: "Deadlift / hinge" },
  { value: "horizontal_push", label: "Bench press" },
  { value: "vertical_push", label: "Overhead press" },
  { value: "vertical_pull", label: "Pull-up" },
  { value: "horizontal_pull", label: "Row" },
];

const field =
  "w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-base outline-none focus:border-accent";

export function ProgramForm({
  profiles,
}: {
  profiles: { id: string; name: string; isDefault: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(createProgramAction, initial);

  const [days, setDays] = useState(4);
  const [minutes, setMinutes] = useState(45);
  const [strengthShare, setStrengthShare] = useState(50);
  const [split, setSplit] = useState("upper_lower");
  const [specialisation, setSpecialisation] = useState("");

  const defaultProfile = profiles.find((p) => p.isDefault) ?? profiles[0];

  // A three-day cycle does not divide into a four-day week; it rolls instead.
  const rolling = split === "push_pull_legs" && days % 3 !== 0;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Programme name</span>
        <input name="name" defaultValue="Block 1" required className={field} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Sessions per week</span>
          <input
            name="daysPerWeek"
            type="number"
            inputMode="numeric"
            min={1}
            max={7}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Minutes lifting</span>
          <input
            name="minutesPerSession"
            type="number"
            inputMode="numeric"
            min={15}
            max={180}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className={field}
          />
          <span className="text-xs text-muted">Excluding warm-up</span>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Split</legend>
        <div className="grid grid-cols-2 gap-2">
          {SPLITS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-xl border px-3 py-2.5 transition-colors ${
                split === option.value ? "border-accent bg-surface-2" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="splitType"
                value={option.value}
                checked={split === option.value}
                onChange={(e) => setSplit(e.target.value)}
                className="sr-only"
              />
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted">{option.note}</span>
            </label>
          ))}
        </div>
        {rolling ? (
          <p className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-muted">
            <span className="text-warning">Rolling schedule.</span> A three-day cycle across{" "}
            {days} sessions means each day type comes round about{" "}
            {Math.round((days / 3) * 10) / 10} times a week, and the weekly layout shifts. That is
            workable, but full body or upper/lower will train each lift more often.
          </p>
        ) : null}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Emphasis — {strengthShare}% strength / {100 - strengthShare}% hypertrophy
        </span>
        <input
          name="strengthShare"
          type="range"
          min={0}
          max={100}
          step={10}
          value={strengthShare}
          onChange={(e) => setStrengthShare(Number(e.target.value))}
          className="accent-accent"
        />
        <span className="text-xs text-muted">
          Strength work uses heavier loads and longer rests, so a session fits fewer sets.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Working on a specific lift?</span>
        <select
          name="specialisationPattern"
          value={specialisation}
          onChange={(e) => setSpecialisation(e.target.value)}
          className={field}
        >
          {SPECIALISATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {specialisation
            ? "That lift gets priority volume and supporting accessories. Other muscles are trimmed to pay for it — adding volume everywhere just raises fatigue."
            : "Volume is spread evenly across all muscle groups."}
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Equipment</span>
          <select name="equipmentProfileId" defaultValue={defaultProfile?.id} className={field}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Block length</span>
          <select name="weeks" defaultValue="4" className={field}>
            <option value="4">4 weeks (3 + deload)</option>
            <option value="5">5 weeks (4 + deload)</option>
            <option value="6">6 weeks (5 + deload)</option>
          </select>
        </label>
      </div>

      <input type="hidden" name="experience" value="advanced" />

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate programme"}
      </button>
    </form>
  );
}

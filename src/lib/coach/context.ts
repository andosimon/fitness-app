import { desc, eq } from "drizzle-orm";

import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { equipmentProfiles, profile, programs } from "@/lib/db/schema";
import type { Equipment, GoalWeights, MovementPattern } from "@/lib/domain/types";

/**
 * The standing facts about this lifter.
 *
 * These go in the system prompt rather than behind a tool. Experience level,
 * injuries and the current programme's goal shape *every* answer — a coach that
 * had to call a tool to discover the user is an advanced lifter with a squat
 * specialisation would give a generic first answer to every conversation.
 */

export type LifterSnapshot = {
  experience: string;
  units: string;
  bodyweightKg: number | null;
  limitations: string | null;
  program: {
    name: string;
    splitType: string;
    daysPerWeek: number;
    minutesPerSession: number;
    totalWeeks: number;
    primaryGoal: string;
    goalWeights: GoalWeights;
    specialisationPattern: MovementPattern | null;
    startDate: Date | null;
  } | null;
  equipment: { name: string; items: Equipment[] } | null;
};

export async function getLifterSnapshot(): Promise<LifterSnapshot> {
  await requireAuth();
  return unsafe_getLifterSnapshot();
}

/** See the note on `unsafe_createProgram` in ../db/queries/programs. */
export async function unsafe_getLifterSnapshot(): Promise<LifterSnapshot> {
  const db = getDb();

  const [me] = await db.select().from(profile).limit(1);

  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.status, "active"))
    .orderBy(desc(programs.createdAt))
    .limit(1);

  const equipmentProfileId = program?.equipmentProfileId ?? null;
  const [kit] = equipmentProfileId
    ? await db
        .select()
        .from(equipmentProfiles)
        .where(eq(equipmentProfiles.id, equipmentProfileId))
        .limit(1)
    : await db
        .select()
        .from(equipmentProfiles)
        .where(eq(equipmentProfiles.isDefault, true))
        .limit(1);

  /*
   * The specialisation lives inside the stored generation inputs rather than a
   * column, because it is an input to the engine and not a property of the
   * programme. Read defensively: an older programme predates the field.
   */
  const inputs = (program?.generationInputs ?? {}) as { specialisationPattern?: MovementPattern };

  return {
    experience: me?.experienceLevel ?? "advanced",
    units: me?.units ?? "kg",
    bodyweightKg: me?.bodyweightKg ?? null,
    limitations: me?.limitations?.trim() ? me.limitations.trim() : null,
    program: program
      ? {
          name: program.name,
          splitType: program.splitType,
          daysPerWeek: program.daysPerWeek,
          minutesPerSession: program.minutesPerSession,
          totalWeeks: program.totalWeeks,
          primaryGoal: program.primaryGoal,
          goalWeights: program.goalWeights,
          specialisationPattern: inputs.specialisationPattern ?? null,
          startDate: program.startDate,
        }
      : null,
    equipment: kit ? { name: kit.name, items: kit.equipment } : null,
  };
}

/** Renders the snapshot as the prose block that goes into the system prompt. */
export function describeSnapshot(snapshot: LifterSnapshot): string {
  const lines: string[] = ["<lifter>"];

  lines.push(`Experience: ${snapshot.experience}`);
  lines.push(`Preferred units: ${snapshot.units}`);
  if (snapshot.bodyweightKg !== null) lines.push(`Bodyweight: ${snapshot.bodyweightKg} kg`);
  lines.push(
    snapshot.limitations
      ? `Injuries and limitations: ${snapshot.limitations}`
      : "Injuries and limitations: none recorded",
  );

  if (snapshot.program) {
    const p = snapshot.program;
    const weights = Object.entries(p.goalWeights)
      .filter(([, weight]) => typeof weight === "number" && weight > 0)
      .map(([goal, weight]) => `${goal} ${Math.round((weight as number) * 100)}%`)
      .join(", ");

    lines.push("");
    lines.push(
      `Current programme: "${p.name}" — ${p.splitType.replace(/_/g, " ")}, ` +
        `${p.daysPerWeek} days/week, ${p.minutesPerSession} lifting minutes per session, ` +
        `${p.totalWeeks} weeks.`,
    );
    lines.push(`Goal: ${p.primaryGoal}${weights ? ` (${weights})` : ""}`);
    if (p.specialisationPattern) {
      lines.push(
        `Specialisation: ${p.specialisationPattern.replace(/_/g, " ")} — this programme is ` +
          "deliberately biased toward that pattern, at the cost of volume elsewhere.",
      );
    }
  } else {
    lines.push("");
    lines.push("No active programme. Sessions logged so far are ad-hoc.");
  }

  if (snapshot.equipment) {
    lines.push("");
    lines.push(
      `Training with the "${snapshot.equipment.name}" equipment profile: ` +
        `${snapshot.equipment.items.join(", ")}.`,
    );
    lines.push("Do not suggest exercises requiring equipment outside that list.");
  }

  lines.push("</lifter>");
  return lines.join("\n");
}

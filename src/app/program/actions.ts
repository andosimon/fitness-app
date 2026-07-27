"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { archiveActiveProgram, createProgram } from "@/lib/db/queries/programs";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  minutesPerSession: z.coerce.number().int().min(15).max(180),
  splitType: z.enum(["full_body", "upper_lower", "push_pull_legs", "push_pull"]),
  weeks: z.coerce.number().int().min(2).max(12),
  equipmentProfileId: z.string().uuid(),
  /** 0-100; the remainder goes to hypertrophy. */
  strengthShare: z.coerce.number().min(0).max(100),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  specialisationPattern: z
    .enum([
      "squat",
      "hinge",
      "horizontal_push",
      "vertical_push",
      "vertical_pull",
      "horizontal_pull",
    ])
    .optional(),
});

export type CreateProgramState = { error?: string };

export async function createProgramAction(
  _prev: CreateProgramState,
  formData: FormData,
): Promise<CreateProgramState> {
  await requireAuth();

  const raw = Object.fromEntries(formData);
  // An empty select value means "no specialisation" rather than an invalid one.
  if (raw.specialisationPattern === "") delete raw.specialisationPattern;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those settings aren't valid." };
  }

  const { strengthShare, ...rest } = parsed.data;
  const strength = strengthShare / 100;

  try {
    await createProgram({
      ...rest,
      goalWeights: { strength, hypertrophy: 1 - strength },
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not generate the programme.",
    };
  }

  revalidatePath("/");
  revalidatePath("/program");
  redirect("/program");
}

export async function archiveProgramAction(): Promise<void> {
  await requireAuth();
  await archiveActiveProgram();
  revalidatePath("/");
  revalidatePath("/program");
  redirect("/program/new");
}

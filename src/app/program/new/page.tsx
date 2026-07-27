import { AppNav } from "@/components/app-nav";
import { listEquipmentProfiles } from "@/lib/db/queries/exercises";

import { ProgramForm } from "./program-form";

export const metadata = { title: "New programme · Fitness Tracker" };

export default async function NewProgramPage() {
  const profiles = await listEquipmentProfiles();

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16">
        <h1 className="text-xl font-semibold tracking-tight">New programme</h1>
        <p className="mt-1 text-sm text-muted">
          Generated from your equipment, the time you have, and what you&rsquo;re training for.
        </p>
        <ProgramForm
          profiles={profiles.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
        />
      </main>
    </>
  );
}

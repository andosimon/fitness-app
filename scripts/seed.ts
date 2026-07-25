import { config } from "dotenv";

// Loaded before the db module is imported, since it reads DATABASE_URL lazily
// but the connection string must be present by first query.
config({ path: ".env.local" });

async function main() {
  const { seedEquipmentProfiles, seedExercises } = await import("@/lib/db/seed");

  const profiles = await seedEquipmentProfiles();
  console.log(
    profiles > 0
      ? `equipment profiles: created ${profiles}`
      : "equipment profiles: already present, left alone",
  );

  const { count } = await seedExercises();
  console.log(`exercises: upserted ${count}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

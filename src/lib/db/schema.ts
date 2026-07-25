import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Equipment, GoalWeights, MuscleGroup } from "@/lib/domain/types";
import {
  CARDIO_MODALITIES,
  CONDITIONING_FORMATS,
  EXPERIENCE_LEVELS,
  GOALS,
  LOAD_TYPES,
  MOVEMENT_PATTERNS,
  SESSION_TYPES,
  SPLIT_TYPES,
  UNITS,
} from "@/lib/domain/types";

/**
 * Conventions used throughout this schema:
 *
 * - **UUID primary keys, generated client-side.** Offline logging needs to
 *   create rows before the device has any contact with the server, so IDs
 *   cannot come from a sequence. Sync then becomes an idempotent upsert on the
 *   primary key rather than a fuzzy match on timestamps.
 * - **All weights stored in kilograms.** Unit preference is a display concern.
 * - **All timestamps are timezone-aware.** Training across timezones is a real
 *   scenario for this app, given travel is a first-class feature.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const movementPatternEnum = pgEnum("movement_pattern", MOVEMENT_PATTERNS);
export const loadTypeEnum = pgEnum("load_type", LOAD_TYPES);
export const goalEnum = pgEnum("goal", GOALS);
export const experienceLevelEnum = pgEnum("experience_level", EXPERIENCE_LEVELS);
export const sessionTypeEnum = pgEnum("session_type", SESSION_TYPES);
export const splitTypeEnum = pgEnum("split_type", SPLIT_TYPES);
export const cardioModalityEnum = pgEnum("cardio_modality", CARDIO_MODALITIES);
export const conditioningFormatEnum = pgEnum("conditioning_format", CONDITIONING_FORMATS);
export const unitEnum = pgEnum("unit", UNITS);
export const programStatusEnum = pgEnum("program_status", ["draft", "active", "completed", "archived"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

const emptyTextArray = sql`'{}'::text[]`;

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------

/**
 * Single-user app, so this table holds exactly one row. Kept as a table rather
 * than a config file so preferences survive redeploys and can be edited in-app.
 */
export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  units: unitEnum("units").notNull().default("kg"),
  experienceLevel: experienceLevelEnum("experience_level").notNull().default("advanced"),
  bodyweightKg: real("bodyweight_kg"),
  heightCm: real("height_cm"),
  birthYear: integer("birth_year"),
  /** Free-text injuries/limitations. Also fed to the coach as context. */
  limitations: text("limitations"),
  /** Exercise IDs to never program, e.g. movements that aggravate an old injury. */
  excludedExerciseIds: uuid("excluded_exercise_ids").array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Named sets of available equipment. Switching the active profile is what makes
 * a hotel-room session generate differently from a commercial-gym session while
 * still chasing the same weekly volume targets.
 */
export const equipmentProfiles = pgTable("equipment_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  equipment: text("equipment").array().$type<Equipment[]>().notNull().default(emptyTextArray),
  isDefault: boolean("is_default").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Alternate names, so search finds "RDL" and "Romanian deadlift" alike. */
    aliases: text("aliases").array().notNull().default(emptyTextArray),

    movementPattern: movementPatternEnum("movement_pattern").notNull(),
    primaryMuscles: text("primary_muscles").array().$type<MuscleGroup[]>().notNull().default(emptyTextArray),
    secondaryMuscles: text("secondary_muscles").array().$type<MuscleGroup[]>().notNull().default(emptyTextArray),

    /**
     * ALL of these must be present in the active equipment profile for this
     * exercise to be selectable. This is the hard constraint that guarantees a
     * generated hotel workout never asks for a cable machine.
     */
    requiredEquipment: text("required_equipment").array().$type<Equipment[]>().notNull().default(emptyTextArray),
    /** Improves the exercise but is not necessary (e.g. a rack for squats). */
    optionalEquipment: text("optional_equipment").array().$type<Equipment[]>().notNull().default(emptyTextArray),

    loadType: loadTypeEnum("load_type").notNull(),
    isUnilateral: boolean("is_unilateral").notNull().default(false),
    isCompound: boolean("is_compound").notNull().default(false),

    /** 1 = trivial to learn, 5 = high skill (e.g. snatch). Gates by experience. */
    complexity: integer("complexity").notNull().default(2),
    /**
     * Stimulus-to-fatigue ratio, 1-5. Higher means more training effect per unit
     * of systemic fatigue, so the selector prefers these when the time budget is
     * tight. Deadlifts score low here despite being excellent lifts.
     */
    stimulusFatigueRatio: integer("stimulus_fatigue_ratio").notNull().default(3),

    defaultRepMin: integer("default_rep_min").notNull().default(6),
    defaultRepMax: integer("default_rep_max").notNull().default(12),

    /**
     * Exercises sharing a substitution group are interchangeable for
     * programming purposes, which is how travel-mode swaps stay sensible.
     */
    substitutionGroup: text("substitution_group"),

    setupNotes: text("setup_notes"),
    cues: text("cues"),
    videoUrl: text("video_url"),

    /** User-created exercises are never overwritten by library reseeds. */
    isCustom: boolean("is_custom").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("exercises_slug_idx").on(table.slug),
    index("exercises_pattern_idx").on(table.movementPattern),
    index("exercises_substitution_idx").on(table.substitutionGroup),
  ],
);

// ---------------------------------------------------------------------------
// Programs (the generated plan)
// ---------------------------------------------------------------------------

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),

  /** Weighted goals, e.g. { hypertrophy: 0.6, fat_loss: 0.4 }. */
  goalWeights: jsonb("goal_weights").$type<GoalWeights>().notNull(),
  primaryGoal: goalEnum("primary_goal").notNull(),

  daysPerWeek: integer("days_per_week").notNull(),
  minutesPerSession: integer("minutes_per_session").notNull(),
  splitType: splitTypeEnum("split_type").notNull(),
  totalWeeks: integer("total_weeks").notNull().default(4),

  equipmentProfileId: uuid("equipment_profile_id").references(() => equipmentProfiles.id, {
    onDelete: "set null",
  }),

  /** Snapshot of the inputs used at generation time, for reproducibility. */
  generationInputs: jsonb("generation_inputs").notNull(),
  /** Engine version, so we can tell which algorithm produced a given block. */
  engineVersion: text("engine_version").notNull().default("0.1.0"),

  status: programStatusEnum("status").notNull().default("draft"),
  startDate: timestamp("start_date", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programWeeks = pgTable(
  "program_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    isDeload: boolean("is_deload").notNull().default(false),
    /** Planned weekly sets per muscle group, the engine's volume contract. */
    targetVolume: jsonb("target_volume").$type<Partial<Record<MuscleGroup, number>>>().notNull(),
    /** Multiplier applied to loads this week; deloads sit around 0.6-0.7. */
    intensityModifier: real("intensity_modifier").notNull().default(1),
  },
  (table) => [uniqueIndex("program_weeks_unique_idx").on(table.programId, table.weekNumber)],
);

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programWeekId: uuid("program_week_id")
      .notNull()
      .references(() => programWeeks.id, { onDelete: "cascade" }),
    /** 0-indexed slot within the week, not a fixed weekday. */
    dayIndex: integer("day_index").notNull(),
    name: text("name").notNull(),
    sessionType: sessionTypeEnum("session_type").notNull(),
    targetMinutes: integer("target_minutes").notNull(),
    /** Muscle groups or patterns this session is responsible for. */
    focus: text("focus").array().notNull().default(emptyTextArray),
    notes: text("notes"),
  },
  (table) => [index("planned_sessions_week_idx").on(table.programWeekId, table.dayIndex)],
);

export const plannedExercises = pgTable(
  "planned_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    plannedSessionId: uuid("planned_session_id")
      .notNull()
      .references(() => plannedSessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull(),

    sets: integer("sets").notNull(),
    repMin: integer("rep_min"),
    repMax: integer("rep_max"),

    /** Reps in reserve target. Primary intensity cue for hypertrophy work. */
    targetRir: integer("target_rir"),
    /** RPE target. Primary intensity cue for strength work. */
    targetRpe: real("target_rpe"),
    /** Percentage of 1RM, when running true percentage-based strength blocks. */
    targetPercent1rm: real("target_percent_1rm"),
    /** Engine's load suggestion, derived from logged history. */
    suggestedLoadKg: real("suggested_load_kg"),

    restSeconds: integer("rest_seconds").notNull(),
    tempo: text("tempo"),
    /** Groups exercises performed back-to-back; shared value = same superset. */
    supersetGroup: text("superset_group"),
    /** Conditioning blocks carry their format and parameters here. */
    conditioningFormat: conditioningFormatEnum("conditioning_format"),
    conditioningParams: jsonb("conditioning_params"),
    notes: text("notes"),
  },
  (table) => [index("planned_exercises_session_idx").on(table.plannedSessionId, table.orderIndex)],
);

// ---------------------------------------------------------------------------
// Performed training (the log)
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for ad-hoc sessions logged outside any program. */
    plannedSessionId: uuid("planned_session_id").references(() => plannedSessions.id, {
      onDelete: "set null",
    }),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    sessionType: sessionTypeEnum("session_type").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Session RPE, 1-10. Cheap, high-signal input for autoregulation. */
    perceivedEffort: real("perceived_effort"),
    bodyweightKg: real("bodyweight_kg"),
    equipmentProfileId: uuid("equipment_profile_id").references(() => equipmentProfiles.id, {
      onDelete: "set null",
    }),
    locationNote: text("location_note"),
    notes: text("notes"),

    /** Set when the row arrived from an offline device, for debugging sync. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_started_idx").on(table.startedAt)],
);

export const setLogs = pgTable(
  "set_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    /** Links back to what was prescribed, enabling planned-vs-actual analysis. */
    plannedExerciseId: uuid("planned_exercise_id").references(() => plannedExercises.id, {
      onDelete: "set null",
    }),

    setIndex: integer("set_index").notNull(),
    weightKg: real("weight_kg"),
    reps: integer("reps"),
    rir: real("rir"),
    rpe: real("rpe"),

    /** Time-, distance- and calorie-based work (carries, holds, ergometers). */
    timeSeconds: integer("time_seconds"),
    distanceM: real("distance_m"),
    calories: integer("calories"),

    isWarmup: boolean("is_warmup").notNull().default(false),
    /** As-many-reps-as-possible sets are excluded from load progression maths. */
    isAmrap: boolean("is_amrap").notNull().default(false),
    /** Failed/abandoned sets stay in the log but do not count toward volume. */
    isFailed: boolean("is_failed").notNull().default(false),

    tempo: text("tempo"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (table) => [
    index("set_logs_session_idx").on(table.sessionId, table.setIndex),
    // Drives "how has my bench progressed" queries and e1RM recalculation.
    index("set_logs_exercise_time_idx").on(table.exerciseId, table.completedAt),
  ],
);

/**
 * Rolling estimated and tested maxes. Kept as history rather than a single
 * mutable value so strength trends are visible and percentage-based blocks can
 * reference the max that was current when the block was generated.
 */
export const exerciseMaxes = pgTable(
  "exercise_maxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    estimated1rmKg: real("estimated_1rm_kg"),
    tested1rmKg: real("tested_1rm_kg"),
    /** Which set produced the estimate, for traceability. */
    sourceSetLogId: uuid("source_set_log_id").references(() => setLogs.id, { onDelete: "set null" }),
    formula: text("formula").default("epley"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("exercise_maxes_exercise_idx").on(table.exerciseId, table.calculatedAt)],
);

// ---------------------------------------------------------------------------
// Cardio & conditioning
// ---------------------------------------------------------------------------

/**
 * Deliberately shaped to accept a wearable import later without a migration:
 * the HR/GPS/stream fields exist now and are simply null for manual entries.
 */
export const cardioActivities = pgTable(
  "cardio_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    modality: cardioModalityEnum("modality").notNull(),
    format: conditioningFormatEnum("format"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    distanceM: real("distance_m"),
    calories: integer("calories"),
    elevationGainM: real("elevation_gain_m"),

    avgHeartRate: integer("avg_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    /** Seconds spent in each HR zone, once a wearable source exists. */
    hrZoneSeconds: jsonb("hr_zone_seconds").$type<Record<string, number>>(),
    avgPaceSecPerKm: real("avg_pace_sec_per_km"),
    avgPowerWatts: integer("avg_power_watts"),

    perceivedEffort: real("perceived_effort"),
    /** Interval structure actually performed. */
    intervals: jsonb("intervals"),

    /** Import provenance. Null means hand-entered. */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    externalRaw: jsonb("external_raw"),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cardio_started_idx").on(table.startedAt),
    // Prevents the same wearable activity being imported twice.
    uniqueIndex("cardio_external_idx").on(table.externalSource, table.externalId),
  ],
);

// ---------------------------------------------------------------------------
// Body metrics
// ---------------------------------------------------------------------------

export const bodyMetrics = pgTable(
  "body_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    bodyweightKg: real("bodyweight_kg"),
    waistCm: real("waist_cm"),
    bodyFatPercent: real("body_fat_percent"),
    restingHeartRate: integer("resting_heart_rate"),
    notes: text("notes"),
  },
  (table) => [index("body_metrics_time_idx").on(table.measuredAt)],
);

// ---------------------------------------------------------------------------
// Coach conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    /** Anthropic content blocks, preserved verbatim so tool_use round-trips. */
    content: jsonb("content").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Profile = typeof profile.$inferSelect;
export type EquipmentProfile = typeof equipmentProfiles.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type Program = typeof programs.$inferSelect;
export type ProgramWeek = typeof programWeeks.$inferSelect;
export type PlannedSession = typeof plannedSessions.$inferSelect;
export type PlannedExercise = typeof plannedExercises.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SetLog = typeof setLogs.$inferSelect;
export type NewSetLog = typeof setLogs.$inferInsert;
export type CardioActivity = typeof cardioActivities.$inferSelect;
export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

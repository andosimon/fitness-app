CREATE TYPE "public"."cardio_modality" AS ENUM('run_outdoor', 'run_treadmill', 'cycle_outdoor', 'cycle_stationary', 'row', 'ski_erg', 'air_bike', 'swim', 'walk', 'hike', 'elliptical', 'stair_climber', 'jump_rope', 'circuit', 'other');--> statement-breakpoint
CREATE TYPE "public"."conditioning_format" AS ENUM('steady_state', 'intervals', 'emom', 'amrap', 'for_time', 'tabata', 'circuit', 'finisher');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('hypertrophy', 'strength', 'fat_loss', 'endurance', 'general');--> statement-breakpoint
CREATE TYPE "public"."load_type" AS ENUM('barbell', 'dumbbell_pair', 'dumbbell_single', 'kettlebell', 'machine_load', 'cable_load', 'bodyweight', 'bodyweight_loaded', 'bodyweight_assisted', 'band', 'time', 'distance', 'calories', 'reps_only');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."movement_pattern" AS ENUM('squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'carry', 'core_anti_extension', 'core_anti_rotation', 'core_flexion', 'core_lateral_flexion', 'isolation_upper', 'isolation_lower', 'olympic', 'conditioning', 'mobility');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('draft', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('strength', 'hypertrophy', 'conditioning', 'cardio', 'mobility', 'rest');--> statement-breakpoint
CREATE TYPE "public"."split_type" AS ENUM('full_body', 'upper_lower', 'push_pull_legs', 'push_pull', 'upper_lower_full', 'body_part', 'hybrid_conditioning');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('kg', 'lb');--> statement-breakpoint
CREATE TABLE "body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"bodyweight_kg" real,
	"waist_cm" real,
	"body_fat_percent" real,
	"resting_heart_rate" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "cardio_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"modality" "cardio_modality" NOT NULL,
	"format" "conditioning_format",
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"distance_m" real,
	"calories" integer,
	"elevation_gain_m" real,
	"avg_heart_rate" integer,
	"max_heart_rate" integer,
	"hr_zone_seconds" jsonb,
	"avg_pace_sec_per_km" real,
	"avg_power_watts" integer,
	"perceived_effort" real,
	"intervals" jsonb,
	"external_source" text,
	"external_id" text,
	"external_raw" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_maxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"estimated_1rm_kg" real,
	"tested_1rm_kg" real,
	"source_set_log_id" uuid,
	"formula" text DEFAULT 'epley',
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"movement_pattern" "movement_pattern" NOT NULL,
	"primary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"optional_equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"load_type" "load_type" NOT NULL,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	"is_compound" boolean DEFAULT false NOT NULL,
	"complexity" integer DEFAULT 2 NOT NULL,
	"stimulus_fatigue_ratio" integer DEFAULT 3 NOT NULL,
	"default_rep_min" integer DEFAULT 6 NOT NULL,
	"default_rep_max" integer DEFAULT 12 NOT NULL,
	"substitution_group" text,
	"setup_notes" text,
	"cues" text,
	"video_url" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"sets" integer NOT NULL,
	"rep_min" integer,
	"rep_max" integer,
	"target_rir" integer,
	"target_rpe" real,
	"target_percent_1rm" real,
	"suggested_load_kg" real,
	"rest_seconds" integer NOT NULL,
	"tempo" text,
	"superset_group" text,
	"conditioning_format" "conditioning_format",
	"conditioning_params" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_week_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"name" text NOT NULL,
	"session_type" "session_type" NOT NULL,
	"target_minutes" integer NOT NULL,
	"focus" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"units" "unit" DEFAULT 'kg' NOT NULL,
	"experience_level" "experience_level" DEFAULT 'advanced' NOT NULL,
	"bodyweight_kg" real,
	"height_cm" real,
	"birth_year" integer,
	"limitations" text,
	"excluded_exercise_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"is_deload" boolean DEFAULT false NOT NULL,
	"target_volume" jsonb NOT NULL,
	"intensity_modifier" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"goal_weights" jsonb NOT NULL,
	"primary_goal" "goal" NOT NULL,
	"days_per_week" integer NOT NULL,
	"minutes_per_session" integer NOT NULL,
	"split_type" "split_type" NOT NULL,
	"total_weeks" integer DEFAULT 4 NOT NULL,
	"equipment_profile_id" uuid,
	"generation_inputs" jsonb NOT NULL,
	"engine_version" text DEFAULT '0.1.0' NOT NULL,
	"status" "program_status" DEFAULT 'draft' NOT NULL,
	"start_date" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_session_id" uuid,
	"program_id" uuid,
	"name" text NOT NULL,
	"session_type" "session_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"perceived_effort" real,
	"bodyweight_kg" real,
	"equipment_profile_id" uuid,
	"location_note" text,
	"notes" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"planned_exercise_id" uuid,
	"set_index" integer NOT NULL,
	"weight_kg" real,
	"reps" integer,
	"rir" real,
	"rpe" real,
	"time_seconds" integer,
	"distance_m" real,
	"calories" integer,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"is_amrap" boolean DEFAULT false NOT NULL,
	"is_failed" boolean DEFAULT false NOT NULL,
	"tempo" text,
	"notes" text,
	"completed_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cardio_activities" ADD CONSTRAINT "cardio_activities_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_maxes" ADD CONSTRAINT "exercise_maxes_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_maxes" ADD CONSTRAINT "exercise_maxes_source_set_log_id_set_logs_id_fk" FOREIGN KEY ("source_set_log_id") REFERENCES "public"."set_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_program_week_id_program_weeks_id_fk" FOREIGN KEY ("program_week_id") REFERENCES "public"."program_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_weeks" ADD CONSTRAINT "program_weeks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_equipment_profile_id_equipment_profiles_id_fk" FOREIGN KEY ("equipment_profile_id") REFERENCES "public"."equipment_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_equipment_profile_id_equipment_profiles_id_fk" FOREIGN KEY ("equipment_profile_id") REFERENCES "public"."equipment_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_planned_exercise_id_planned_exercises_id_fk" FOREIGN KEY ("planned_exercise_id") REFERENCES "public"."planned_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_metrics_time_idx" ON "body_metrics" USING btree ("measured_at");--> statement-breakpoint
CREATE INDEX "cardio_started_idx" ON "cardio_activities" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cardio_external_idx" ON "cardio_activities" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE INDEX "exercise_maxes_exercise_idx" ON "exercise_maxes" USING btree ("exercise_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_slug_idx" ON "exercises" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "exercises_pattern_idx" ON "exercises" USING btree ("movement_pattern");--> statement-breakpoint
CREATE INDEX "exercises_substitution_idx" ON "exercises" USING btree ("substitution_group");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "planned_exercises_session_idx" ON "planned_exercises" USING btree ("planned_session_id","order_index");--> statement-breakpoint
CREATE INDEX "planned_sessions_week_idx" ON "planned_sessions" USING btree ("program_week_id","day_index");--> statement-breakpoint
CREATE UNIQUE INDEX "program_weeks_unique_idx" ON "program_weeks" USING btree ("program_id","week_number");--> statement-breakpoint
CREATE INDEX "sessions_started_idx" ON "sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "set_logs_session_idx" ON "set_logs" USING btree ("session_id","set_index");--> statement-breakpoint
CREATE INDEX "set_logs_exercise_time_idx" ON "set_logs" USING btree ("exercise_id","completed_at");
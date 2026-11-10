CREATE TYPE "public"."classify_state" AS ENUM('suggested', 'approved', 'changed');--> statement-breakpoint
CREATE TYPE "public"."lawyer_status" AS ENUM('open', 'requested', 'answered');--> statement-breakpoint
CREATE TABLE "review_item_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"status" "lawyer_status" DEFAULT 'open' NOT NULL,
	"request_note" text,
	"resolution" text,
	"answer_note" text,
	"requested_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_item_states_review_item" UNIQUE("review_id","item_index")
);
--> statement-breakpoint
CREATE TABLE "subtypes" (
	"id" text PRIMARY KEY NOT NULL,
	"name_ko" text NOT NULL,
	"group" text,
	"standard_id" text,
	"status" text,
	"definition" text,
	"include_signals" jsonb,
	"exclude_signals" jsonb,
	"bucket" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "standard_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "has_standard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "include_signals" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "exclude_signals" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "estimate" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "classify_state" "classify_state" DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "classify_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "classify_note" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "subtype_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "needs_re_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "re_review_job_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "risk_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "lawyer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "note_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "bucket" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_item_states" ADD CONSTRAINT "review_item_states_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
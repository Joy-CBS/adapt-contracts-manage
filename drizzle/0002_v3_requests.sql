ALTER TABLE "categories" ADD COLUMN "group" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "taxonomy_status" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "extract_job_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "review_job_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "request_note" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "completed_at" timestamp with time zone;
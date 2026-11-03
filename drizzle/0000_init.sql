CREATE TYPE "public"."category_origin" AS ENUM('adapt_standard', 'derived', 'new');--> statement-breakpoint
CREATE TYPE "public"."category_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."contract_source" AS ENUM('legacy', 'slack', 'upload');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('registered', 'processing', 'analyzed', 'reviewed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."template_source" AS ENUM('adapt_original', 'representative', 'generated_draft');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"origin" "category_origin" NOT NULL,
	"status" "category_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_class_key_unique" UNIQUE("class_key")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "contract_source" NOT NULL,
	"filename" text NOT NULL,
	"source_path" text,
	"source_folder" text,
	"sha256" text,
	"blob_url" text,
	"studio_file_id" text,
	"studio_job_id" text,
	"status" "contract_status" DEFAULT 'registered' NOT NULL,
	"language" text,
	"category_id" uuid,
	"classify_confidence" double precision,
	"metadata" jsonb,
	"slack_channel" text,
	"slack_ts" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"template_id" uuid,
	"verdict" text,
	"risks" jsonb,
	"studio_job_id" text,
	"redline_docx_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" "template_source" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"clauses" jsonb,
	"docx_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_resources" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_template_id_standard_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."standard_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_templates" ADD CONSTRAINT "standard_templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
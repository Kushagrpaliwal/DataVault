CREATE TABLE "note_ai_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"base_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_payments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_payments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vendors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "categories" CASCADE;--> statement-breakpoint
DROP TABLE "customers" CASCADE;--> statement-breakpoint
DROP TABLE "invoice_items" CASCADE;--> statement-breakpoint
DROP TABLE "invoice_payments" CASCADE;--> statement-breakpoint
DROP TABLE "invoices" CASCADE;--> statement-breakpoint
DROP TABLE "payment_methods" CASCADE;--> statement-breakpoint
DROP TABLE "payments" CASCADE;--> statement-breakpoint
DROP TABLE "recurring_payments" CASCADE;--> statement-breakpoint
DROP TABLE "refunds" CASCADE;--> statement-breakpoint
DROP TABLE "vendors" CASCADE;--> statement-breakpoint
ALTER TABLE "ai_credit_periods" DROP CONSTRAINT "ai_credit_periods_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "saved_records" ALTER COLUMN "record_type" SET DATA TYPE text;--> statement-breakpoint
/**
 * The types that described bookkeeping are gone, so anything that was filed
 * under one of them is filed as "other" rather than being lost.
 */
UPDATE "saved_records" SET "record_type" = 'other' WHERE "record_type" IN ('payment','expense','income','receipt','invoice','subscription','customer','vendor','refund','travel');--> statement-breakpoint
DROP TYPE "public"."record_type";--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('article', 'quote', 'statistic', 'definition', 'person', 'product', 'event', 'webpage', 'highlight', 'document', 'image', 'bookmark', 'note', 'link', 'other');--> statement-breakpoint
ALTER TABLE "saved_records" ALTER COLUMN "record_type" SET DATA TYPE "public"."record_type" USING "record_type"::"public"."record_type";--> statement-breakpoint
ALTER TABLE "ai_credit_periods" DROP CONSTRAINT "ai_credit_periods_organization_id_user_id_period_start_pk";--> statement-breakpoint
/**
 * The allowance belongs to the person, not to the workspace, so the rows are
 * merged into one per person and day. The credits used in each workspace are
 * added together, so nobody loses what they had spent.
 */
UPDATE "ai_credit_periods" AS p SET "used" = m.total FROM (SELECT "user_id", "period_start", sum("used")::int AS total FROM "ai_credit_periods" GROUP BY "user_id", "period_start") AS m WHERE p."user_id" = m."user_id" AND p."period_start" = m."period_start";--> statement-breakpoint
DELETE FROM "ai_credit_periods" a USING "ai_credit_periods" b WHERE a."user_id" = b."user_id" AND a."period_start" = b."period_start" AND a."organization_id" > b."organization_id";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "currency" SET DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "locale" SET DEFAULT 'en-US';--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "time_zone" SET DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "ai_credit_periods" ADD CONSTRAINT "ai_credit_periods_user_id_period_start_pk" PRIMARY KEY("user_id","period_start");--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "note_ai_previews" ADD CONSTRAINT "note_ai_previews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_ai_previews" ADD CONSTRAINT "note_ai_previews_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_ai_previews" ADD CONSTRAINT "note_ai_previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_ai_previews_note_idx" ON "note_ai_previews" USING btree ("organization_id","note_id");--> statement-breakpoint
CREATE INDEX "note_ai_previews_expiry_idx" ON "note_ai_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_credit_ledger_idempotency_idx" ON "ai_credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "ai_credit_periods" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "saved_records" DROP COLUMN "summary_amount";--> statement-breakpoint
ALTER TABLE "saved_records" DROP COLUMN "summary_currency";--> statement-breakpoint
ALTER TABLE "saved_records" DROP COLUMN "summary_party";--> statement-breakpoint
ALTER TABLE "saved_records" DROP COLUMN "summary_status";--> statement-breakpoint
DROP TYPE "public"."invoice_kind";--> statement-breakpoint
DROP TYPE "public"."invoice_status";--> statement-breakpoint
DROP TYPE "public"."payment_direction";--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
DROP TYPE "public"."recurring_frequency";--> statement-breakpoint
DROP TYPE "public"."recurring_status";--> statement-breakpoint
DROP TYPE "public"."refund_status";
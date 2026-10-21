CREATE TABLE "ai_consents" (
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'gemini' NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_consents_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "ai_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"credits" integer NOT NULL,
	"reason" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credit_periods" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"granted" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_periods_organization_id_user_id_period_start_pk" PRIMARY KEY("organization_id","user_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "ai_response_cache" (
	"content_hash" text NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_response_cache_content_hash_feature_pk" PRIMARY KEY("content_hash","feature")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached" integer DEFAULT 0 NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_consents" ADD CONSTRAINT "ai_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_credit_periods" ADD CONSTRAINT "ai_credit_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_credit_periods" ADD CONSTRAINT "ai_credit_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_credit_ledger_user_idx" ON "ai_credit_ledger" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_ledger_request_unique" ON "ai_credit_ledger" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "ai_credit_periods_period_idx" ON "ai_credit_periods" USING btree ("period_start");
--> statement-breakpoint
CREATE INDEX "ai_response_cache_created_idx" ON "ai_response_cache" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "ai_usage_events_user_idx" ON "ai_usage_events" USING btree ("user_id","created_at");

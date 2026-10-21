CREATE TABLE "ai_global_counters" (
	"key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_global_counters_key_period_start_pk" PRIMARY KEY("key","period_start")
);
--> statement-breakpoint
CREATE INDEX "ai_global_counters_period_idx" ON "ai_global_counters" USING btree ("period_start");
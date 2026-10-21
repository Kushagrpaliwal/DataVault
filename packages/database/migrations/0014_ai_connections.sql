-- The model providers that people connect themselves.
--
-- A person may have a subscription of their own, and a person may run a
-- model on their own machine. The key is held encrypted, and it is never
-- sent back to the browser: the column holds the ciphertext and the last
-- four of the key, which is enough to tell two keys apart.
--
-- The row follows the person rather than the workspace, because a key
-- belongs to a person and not to a place they work in. The rule on the
-- table is the same one the other tables of a person have.

CREATE TABLE "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"preset" text DEFAULT 'custom' NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text,
	"key_hint" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_connections_user_idx" ON "ai_connections" USING btree ("user_id");

-- The table is behind the rules of the person, like the other tables that
-- hold what a person owns.
ALTER TABLE "ai_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_isolation ON "ai_connections";
CREATE POLICY account_isolation ON "ai_connections"
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

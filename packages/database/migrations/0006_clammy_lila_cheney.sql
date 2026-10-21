CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"reason" text DEFAULT 'autosave' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vault_id" uuid,
	"parent_id" uuid,
	"title" text DEFAULT 'Untitled doc' NOT NULL,
	"icon" text,
	"content" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"arrange_mode" text DEFAULT 'page' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"clip_count" integer DEFAULT 0 NOT NULL,
	"last_clipped_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_note_prefs" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"current_note_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_note_prefs_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_id_notes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_note_prefs" ADD CONSTRAINT "user_note_prefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_note_prefs" ADD CONSTRAINT "user_note_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_note_prefs" ADD CONSTRAINT "user_note_prefs_current_note_id_notes_id_fk" FOREIGN KEY ("current_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_revisions_note_idx" ON "note_revisions" USING btree ("organization_id","note_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "note_revisions_note_version_unique" ON "note_revisions" USING btree ("note_id","version");--> statement-breakpoint
CREATE INDEX "notes_org_updated_idx" ON "notes" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_org_parent_idx" ON "notes" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "notes_org_pinned_idx" ON "notes" USING btree ("organization_id","is_pinned");--> statement-breakpoint

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['notes', 'note_revisions', 'user_note_prefs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      tenant_table
    );
  END LOOP;
END $$;
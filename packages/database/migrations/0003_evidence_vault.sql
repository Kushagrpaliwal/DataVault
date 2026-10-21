ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'webpage';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'highlight';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'document';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'image';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'product';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'travel';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE IF NOT EXISTS 'bookmark';--> statement-breakpoint

ALTER TABLE "organizations" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE "vaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "kind" text DEFAULT 'workspace' NOT NULL,
  "color" text DEFAULT '#b8a4ed' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vaults_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "vaults_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_org_slug_unique" ON "vaults" USING btree ("organization_id", "slug");--> statement-breakpoint
CREATE INDEX "vaults_org_default_idx" ON "vaults" USING btree ("organization_id", "is_default");--> statement-breakpoint

INSERT INTO "vaults" ("organization_id", "name", "slug", "kind", "is_default", "created_by")
SELECT "id", CASE WHEN "is_personal" THEN 'Personal Vault' ELSE 'Workspace Vault' END, 'inbox', CASE WHEN "is_personal" THEN 'personal' ELSE 'workspace' END, true, "created_by"
FROM "organizations"
ON CONFLICT ("organization_id", "slug") DO NOTHING;--> statement-breakpoint

ALTER TABLE "saved_records" ADD COLUMN "vault_id" uuid;--> statement-breakpoint
UPDATE "saved_records" AS "record" SET "vault_id" = "vault"."id" FROM "vaults" AS "vault" WHERE "vault"."organization_id" = "record"."organization_id" AND "vault"."is_default" = true;--> statement-breakpoint
ALTER TABLE "saved_records" ALTER COLUMN "vault_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_records" ADD CONSTRAINT "saved_records_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "saved_records" ADD COLUMN "capture_kind" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_records" ADD COLUMN "review_status" text DEFAULT 'inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_records" ADD COLUMN "privacy_level" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_records" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "saved_records_vault_created_idx" ON "saved_records" USING btree ("organization_id", "vault_id", "created_at");--> statement-breakpoint

CREATE TABLE "evidence_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "saved_record_id" uuid NOT NULL,
  "source_url" text,
  "source_title" text,
  "source_domain" text,
  "captured_text" text,
  "content_hash" text NOT NULL,
  "extractor_id" text NOT NULL,
  "extractor_version" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evidence_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "evidence_snapshots_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX "evidence_snapshots_record_idx" ON "evidence_snapshots" USING btree ("organization_id", "saved_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_snapshots_record_hash_unique" ON "evidence_snapshots" USING btree ("saved_record_id", "content_hash");--> statement-breakpoint

CREATE TABLE "vault_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "vault_id" uuid NOT NULL,
  "name" text NOT NULL,
  "color" text DEFAULT '#b8a4ed' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vault_collections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "vault_collections_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade,
  CONSTRAINT "vault_collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "vault_collections_name_unique" ON "vault_collections" USING btree ("vault_id", "name");--> statement-breakpoint
CREATE INDEX "vault_collections_org_vault_idx" ON "vault_collections" USING btree ("organization_id", "vault_id");--> statement-breakpoint

CREATE TABLE "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "color" text DEFAULT '#b8a4ed' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_unique" ON "tags" USING btree ("organization_id", "name");--> statement-breakpoint

CREATE TABLE "saved_record_collections" (
  "saved_record_id" uuid NOT NULL,
  "collection_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_record_collections_saved_record_id_collection_id_pk" PRIMARY KEY("saved_record_id", "collection_id"),
  CONSTRAINT "saved_record_collections_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade,
  CONSTRAINT "saved_record_collections_collection_id_vault_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."vault_collections"("id") ON DELETE cascade,
  CONSTRAINT "saved_record_collections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX "saved_record_collections_org_collection_idx" ON "saved_record_collections" USING btree ("organization_id", "collection_id");--> statement-breakpoint

CREATE TABLE "saved_record_tags" (
  "saved_record_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_record_tags_saved_record_id_tag_id_pk" PRIMARY KEY("saved_record_id", "tag_id"),
  CONSTRAINT "saved_record_tags_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade,
  CONSTRAINT "saved_record_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade,
  CONSTRAINT "saved_record_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX "saved_record_tags_org_tag_idx" ON "saved_record_tags" USING btree ("organization_id", "tag_id");--> statement-breakpoint

CREATE TABLE "processing_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "saved_record_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'ready' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" numeric(4, 0) DEFAULT '0' NOT NULL,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "processing_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "processing_jobs_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX "processing_jobs_org_status_idx" ON "processing_jobs" USING btree ("organization_id", "status", "created_at");--> statement-breakpoint

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['vaults', 'evidence_snapshots', 'vault_collections', 'tags', 'saved_record_collections', 'saved_record_tags', 'processing_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      tenant_table
    );
  END LOOP;
END $$;

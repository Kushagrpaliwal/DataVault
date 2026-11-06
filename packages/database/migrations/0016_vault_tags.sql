CREATE TABLE "vault_tags" (
	"vault_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_tags_vault_id_tag_id_pk" PRIMARY KEY("vault_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "vault_tags" ADD CONSTRAINT "vault_tags_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_tags" ADD CONSTRAINT "vault_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_tags" ADD CONSTRAINT "vault_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vault_tags_org_tag_idx" ON "vault_tags" USING btree ("organization_id","tag_id");
--> statement-breakpoint
CREATE INDEX "vault_tags_org_vault_idx" ON "vault_tags" USING btree ("organization_id","vault_id");
--> statement-breakpoint
ALTER TABLE "vault_tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault_tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vault_tags" USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

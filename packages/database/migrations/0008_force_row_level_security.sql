-- Make the row-level security rules bite.
--
-- The rules were only ever enabled, not forced. A table's owner is exempt
-- from its own rules unless they are forced, and the application used to
-- connect as the owner, so the rules were documentation rather than a
-- boundary. Forcing them means a query that forgets to scope itself by
-- workspace returns nothing instead of everything.
--
-- The migrations run as the administrative role, which is not affected by
-- this, so a migration can still create and change the tables.

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'attachments', 'audit_logs', 'capture_sources', 'evidence_snapshots', 'idempotency_keys',
    'note_revisions', 'notes', 'processing_jobs', 'saved_record_collections', 'saved_record_tags',
    'saved_records', 'saved_views', 'tags', 'user_note_prefs', 'vault_collections', 'vaults'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
  END LOOP;
END $$;

-- The credit tables follow the person rather than the workspace, because the
-- allowance belongs to the person. A workspace the person is not in must not
-- be able to read their usage.
--
-- The application sets app.user_id in the same transaction as
-- app.organization_id. Without it the query sees nothing, which is the
-- answer we want.

DO $$
DECLARE
  user_table text;
BEGIN
  FOREACH user_table IN ARRAY ARRAY['ai_credit_periods', 'ai_credit_ledger', 'ai_usage_events', 'ai_consents']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', user_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', user_table);
    EXECUTE format('DROP POLICY IF EXISTS account_isolation ON %I', user_table);
    EXECUTE format(
      'CREATE POLICY account_isolation ON %I USING (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)',
      user_table
    );
  END LOOP;
END $$;

-- The answers waiting to be applied follow the person and the workspace.
ALTER TABLE "note_ai_previews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_ai_previews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "note_ai_previews";
CREATE POLICY tenant_isolation ON "note_ai_previews"
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

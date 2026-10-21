-- The numbers that say what a saved item is about.
--
-- The numbers are kept in a plain list rather than in the vector type of the
-- pgvector extension, so that the search works on any PostgreSQL. The table
-- is the same either way, so the extension can be used later without
-- changing anything else.
--
-- The rule on the table is the same as the rule on the other tables of a
-- workspace, so the numbers of one workspace are never seen by another.

CREATE TABLE "record_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_embeddings" ADD CONSTRAINT "record_embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_embeddings" ADD CONSTRAINT "record_embeddings_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_embeddings_record_idx" ON "record_embeddings" USING btree ("organization_id","saved_record_id");--> statement-breakpoint
CREATE INDEX "record_embeddings_model_idx" ON "record_embeddings" USING btree ("model");

-- The table is behind the rules of the workspace, like every other table that
-- holds business data.
ALTER TABLE "record_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_embeddings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "record_embeddings";
CREATE POLICY tenant_isolation ON "record_embeddings"
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- How alike two lists of numbers are.
--
-- The answer is a number between -1 and 1, and 1 means the two texts mean
-- the same thing. The lists are compared over the length they share, so a
-- list of a different length is not an error.
CREATE OR REPLACE FUNCTION datavault_cosine(a real[], b real[]) RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH shared AS (
    SELECT least(coalesce(array_length(a, 1), 0), coalesce(array_length(b, 1), 0)) AS length
  ), dots AS (
    SELECT
      coalesce(sum(a[i] * b[i]), 0) AS dot,
      coalesce(sum(a[i] * a[i]), 0) AS left_length,
      coalesce(sum(b[i] * b[i]), 0) AS right_length
    FROM shared, generate_series(1, shared.length) AS i
  )
  SELECT CASE
    WHEN coalesce(dots.left_length, 0) = 0 OR coalesce(dots.right_length, 0) = 0 THEN 0
    ELSE dots.dot / (sqrt(dots.left_length) * sqrt(dots.right_length))
  END
  FROM dots;
$$;

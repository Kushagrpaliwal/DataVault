-- Let the search look through the words of a saved item.
--
-- The column is worked out by the database itself, so it can never fall
-- behind the text it was made from. A title says more than a description,
-- and a description says more than the text that was captured, so the
-- three are given different weights and the search is ordered by them.
--
-- The index is what makes the search quick. Without it, every saved item
-- in every workspace is read for every search.

ALTER TABLE "saved_records" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B') || setweight(to_tsvector('english', coalesce("source_page_title", '')), 'B') || setweight(to_tsvector('english', coalesce("original_text", '')), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "saved_records_search_idx" ON "saved_records" USING gin ("search_vector");

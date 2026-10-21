-- Keep the page as it was.
--
-- A page changes, and a page that is gone cannot be read again. The
-- snapshot is the markup of the parts of the page that were kept, so that
-- an item can always be traced back to what the page said at the time it
-- was saved.

ALTER TABLE "evidence_snapshots" ADD COLUMN "page_html" text;

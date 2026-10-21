-- Let the server see the row that holds a request key.
--
-- The credit ledger follows the person, so the rule on that table only shows
-- a person their own rows. The server has to find out whether a request key
-- has been used before, and it has to find that out even when the row that
-- holds the key belongs to somebody else. The key is named in app.claim_key
-- for the length of the transaction, and this rule lets that one row
-- through.
--
-- The rule is only about reading. Writing is still checked against the
-- person, so a row cannot be written for somebody else, and the other rows
-- of the ledger stay out of sight.

DROP POLICY IF EXISTS idempotency_claim ON "ai_credit_ledger";
CREATE POLICY idempotency_claim ON "ai_credit_ledger" FOR SELECT
  USING ("idempotency_key" = nullif(current_setting('app.claim_key', true), ''));

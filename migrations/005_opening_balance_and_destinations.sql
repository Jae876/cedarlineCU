ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS destination_account_number TEXT NOT NULL DEFAULT '';
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS destination_routing_number TEXT NOT NULL DEFAULT '';

DELETE FROM transactions
WHERE transaction_id IN (
  SELECT transaction_id FROM account_transactions
  WHERE source = 'admin_generated_history' AND generated = TRUE
);

INSERT INTO account_transactions
  (account_id, transaction_type, amount_cents, balance_after_cents, source, description, transaction_id, occurred_at)
SELECT account_id, 'opening_balance', SUM(amount_cents)::bigint, SUM(amount_cents)::bigint, 'admin_opening_balance',
  'Initial account funding',
  'FIC-OPENING-MIG-' || account_id::text, MIN(occurred_at)
FROM account_transactions
WHERE source = 'admin_generated_history' AND generated = TRUE
GROUP BY account_id;

INSERT INTO transactions
  (account_id, type, amount, description, balance, date, transaction_id)
SELECT account_id, 'opening_balance', SUM(amount_cents) / 100.0,
  'Initial account funding', SUM(amount_cents) / 100.0,
  MIN(occurred_at), 'FIC-OPENING-MIG-' || account_id::text
FROM account_transactions
WHERE source = 'admin_opening_balance' AND description = 'Initial account funding'
GROUP BY account_id;

DELETE FROM account_transactions
WHERE source = 'admin_generated_history' AND generated = TRUE;
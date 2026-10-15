ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_type_check;

UPDATE accounts SET account_type = 'joint' WHERE account_type = 'institutional';
UPDATE users SET account_type = 'joint' WHERE account_type = 'institutional';
UPDATE accounts SET account_number = '99' || id::text WHERE account_number LIKE 'CL%';
UPDATE accounts SET routing_number = '900000000' WHERE routing_number = '';

ALTER TABLE accounts ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN ('individual', 'business', 'joint'));
ALTER TABLE users ADD CONSTRAINT users_account_type_check
  CHECK (account_type IN ('individual', 'business', 'joint'));
ALTER TABLE account_transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE account_transactions ADD COLUMN IF NOT EXISTS generated BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE account_transactions SET transaction_id = 'FIC-LEGACY-' || id::text WHERE transaction_id IS NULL;
ALTER TABLE account_transactions ALTER COLUMN transaction_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_transactions_transaction_id_idx ON account_transactions (transaction_id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS generated BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE transactions SET transaction_id = 'FIC-LEGACY-' || id::text WHERE transaction_id IS NULL;
ALTER TABLE transactions ALTER COLUMN transaction_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_transaction_id_idx ON transactions (transaction_id);

ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS destination_account_number TEXT NOT NULL DEFAULT '';
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS destination_routing_number TEXT NOT NULL DEFAULT '';
UPDATE account_requests SET transaction_id = 'FIC-REQUEST-' || id::text WHERE transaction_id IS NULL;
ALTER TABLE account_requests ALTER COLUMN transaction_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_requests_transaction_id_idx ON account_requests (transaction_id);
CREATE INDEX IF NOT EXISTS account_requests_user_created_idx ON account_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_requests_status_created_idx ON account_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC, id DESC);
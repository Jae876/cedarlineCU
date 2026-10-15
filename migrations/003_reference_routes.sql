ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS buying_power NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS total_deposits NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS unrealized_gains NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS margin_level NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS routing_number VARCHAR(9) NOT NULL DEFAULT '';

UPDATE accounts SET balance = balance_cents / 100.0, buying_power = balance_cents / 100.0
WHERE balance = 0 AND balance_cents <> 0;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO admin_users (username) VALUES ('admin') ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  description TEXT NOT NULL,
  balance NUMERIC(15, 2) NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported BOOLEAN NOT NULL DEFAULT FALSE,
  source_date TIMESTAMPTZ,
  CHECK (NOT imported OR source_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  quantity NUMERIC(15, 4) NOT NULL,
  avg_cost NUMERIC(15, 2) NOT NULL,
  current_price NUMERIC(15, 2) NOT NULL,
  unrealized_pl NUMERIC(15, 2) NOT NULL DEFAULT 0,
  unrealized_pl_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_method_settings (
  id BIGSERIAL PRIMARY KEY,
  payment_method TEXT NOT NULL UNIQUE CHECK (payment_method IN ('ACH', 'WIRE', 'INTERNAL')),
  account_number TEXT NOT NULL,
  routing_number VARCHAR(9),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_requests (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('deposit', 'withdrawal')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_number_last4 VARCHAR(4) NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);


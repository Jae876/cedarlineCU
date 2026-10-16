ALTER TABLE account_transactions DROP CONSTRAINT IF EXISTS account_transactions_transaction_type_check;
ALTER TABLE account_transactions ADD CONSTRAINT account_transactions_transaction_type_check
  CHECK (transaction_type IN ('opening_balance', 'balance_adjustment', 'deposit', 'withdrawal', 'transfer', 'bill_payment', 'card_purchase'));

UPDATE account_transactions
SET description = CASE description
  WHEN 'Incoming transfer (fictional demo)' THEN 'Incoming transfer'
  WHEN 'Outgoing transfer (fictional demo)' THEN 'Outgoing transfer'
  ELSE description
END
WHERE generated = TRUE AND source = 'admin_generated_transfer';

UPDATE transactions
SET description = CASE description
  WHEN 'Incoming transfer (fictional demo)' THEN 'Incoming transfer'
  WHEN 'Outgoing transfer (fictional demo)' THEN 'Outgoing transfer'
  ELSE description
END
WHERE generated = TRUE AND description IN ('Incoming transfer (fictional demo)', 'Outgoing transfer (fictional demo)');
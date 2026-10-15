UPDATE account_transactions
SET description = 'Initial account funding'
WHERE transaction_type = 'opening_balance';

UPDATE transactions
SET description = 'Initial account funding'
WHERE type = 'opening_balance';

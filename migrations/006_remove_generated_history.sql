UPDATE accounts SET account_number = '99' || id::text WHERE account_number LIKE 'CL%';

DELETE FROM account_transactions
WHERE source = 'admin_generated_history' AND generated = TRUE;

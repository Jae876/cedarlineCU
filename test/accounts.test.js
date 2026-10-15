const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');
const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp } = require('../app');

let pool;
let app;
let admin;

beforeEach(() => {
  pool = new (newDb().adapters.createPg().Pool)();
  app = createApp({ pool, adminPassword: 'test-master-secret', initializeDatabase: true });
  admin = request.agent(app);
});

afterEach(async () => pool.end());

async function signInAdmin() {
  const response = await admin.post('/api/auth/admin-login').send({ password: 'test-master-secret' });
  assert.equal(response.status, 200);
  assert.equal(response.body.admin.role, 'admin');
  return response.body.token;
}

async function signUpUser(email = 'member@example.com') {
  const user = request.agent(app);
  const response = await user.post('/api/auth/signup').send({
    firstName: 'Taylor',
    lastName: 'Member',
    email,
    password: 'StrongPass1!',
    accountType: 'individual',
  });
  assert.equal(response.status, 201);
  return { user, response };
}

test('health endpoint confirms database readiness without exposing configuration', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, database: 'connected' });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('master password protects admin routes and returns a server-issued session', async () => {
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
  assert.equal((await request(app).get('/api/admin/stats')).status, 401);
  assert.equal((await request(app).get('/api/admin/audit')).status, 401);
  assert.equal((await request(app).post('/api/transactions').send({ operation: 'deposit', amount: '10.00' })).status, 401);
  assert.equal((await request(app).post('/api/auth/admin-login').send({ password: 'wrong' })).status, 401);
  await signInAdmin();
  assert.equal((await admin.get('/api/admin/users')).status, 200);
  assert.equal((await admin.get('/api/admin/session')).status, 200);
});

test('framework signup and login hash passwords and return persisted account data', async () => {
  const { user, response } = await signUpUser();
  assert.equal(response.body.user.email, 'member@example.com');
  assert.equal(response.body.user.account.balance, 50000);
  assert.equal(response.body.user.account.transactions.length, 1);
  assert.equal(response.body.user.account.transactions[0].type, 'opening_balance');
  assert.equal(response.body.user.account.transactions[0].description, 'Initial account funding');
  assert.match(response.body.user.account.accountNumber, /^\d{10}$/);
  assert.match(response.body.user.account.routingNumber, /^\d{9}$/);
  assert.equal((await user.get('/api/auth/verify')).status, 200);
  const profile = await user.put('/api/profile').send({
    firstName: 'Taylor', lastName: 'Member',
    address: { line1: '10 Main Street', line2: 'Unit 4', city: 'Madison', state: 'WI', postalCode: '53703' },
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.address.line1, '10 Main Street');
  assert.equal(profile.body.user.address.postalCode, '53703');
  assert.equal((await request(app).put('/api/profile').send({ firstName: 'Other', lastName: 'Person' })).status, 401);

  const saved = await pool.query(
    `SELECT u.password_hash, a.balance_cents, a.total_deposits
     FROM users u JOIN accounts a ON a.id = u.account_id WHERE u.email = $1`,
    ['member@example.com']
  );
  assert.match(saved.rows[0].password_hash, /^\$2[aby]\$/);
  assert.equal(Number(saved.rows[0].balance_cents), 5000000);
  assert.equal(Number(saved.rows[0].total_deposits), 50000);

  const signedIn = request.agent(app);
  const login = await signedIn.post('/api/auth/login').send({ email: 'member@example.com', password: 'StrongPass1!' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.account.accountNumber, response.body.user.account.accountNumber);
  assert.equal((await signedIn.get('/api/auth/verify')).status, 200);
  assert.equal((await signedIn.post('/api/auth/logout')).status, 200);
  assert.equal((await signedIn.get('/api/auth/verify')).status, 401);
});

test('admin users route creates, lists, updates balances, and deletes a user with ledger consistency', async () => {
  await signInAdmin();
  const created = await admin.post('/api/admin/users').send({
    email: 'admin-created@example.com',
    password: 'StrongPass1!',
    firstName: 'Admin',
    lastName: 'Created',
    accountType: 'joint',
    balance: '1250.37',
    accountNumber: '123456789012',
    routingNumber: '123456780',
    createdAt: '2021-06-14',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.balance, 1250.37);
  assert.equal(created.body.user.accountType, 'joint');
  assert.equal(created.body.user.accountNumber, '123456789012');
  assert.equal(created.body.user.routingNumber, '123456780');
  assert.equal(new Date(created.body.user.createdAt).toISOString().slice(0, 10), '2021-06-14');
  const openingLedger = await pool.query('SELECT description, occurred_at FROM account_transactions WHERE account_id = (SELECT id FROM accounts WHERE account_number = $1) AND transaction_type = $2', [created.body.user.accountNumber, 'opening_balance']);
  assert.equal(openingLedger.rows[0].description, 'Initial account funding');
  assert.equal(new Date(openingLedger.rows[0].occurred_at).toISOString().slice(0, 10), '2021-06-14');
  const compatibilityOpening = await pool.query('SELECT description, date FROM transactions WHERE account_id = (SELECT id FROM accounts WHERE account_number = $1) AND type = $2', [created.body.user.accountNumber, 'opening_balance']);
  assert.equal(compatibilityOpening.rows[0].description, 'Initial account funding');
  assert.equal(new Date(compatibilityOpening.rows[0].date).toISOString().slice(0, 10), '2021-06-14');
  const accountIdForNormalization = (await pool.query('SELECT id FROM accounts WHERE account_number = $1', [created.body.user.accountNumber])).rows[0].id;
  await pool.query("UPDATE account_transactions SET description = 'Fictional opening balance set by administrator' WHERE account_id = $1 AND transaction_type = 'opening_balance'", [accountIdForNormalization]);
  await pool.query("UPDATE transactions SET description = 'Fictional opening balance set by administrator' WHERE account_id = $1 AND type = 'opening_balance'", [accountIdForNormalization]);
  await pool.query(await fs.readFile(path.join(__dirname, '..', 'migrations', '011_normalize_opening_funding.sql'), 'utf8'));
  assert.equal((await pool.query('SELECT description FROM account_transactions WHERE account_id = $1 AND transaction_type = $2', [accountIdForNormalization, 'opening_balance'])).rows[0].description, 'Initial account funding');
  assert.equal((await pool.query('SELECT description FROM transactions WHERE account_id = $1 AND type = $2', [accountIdForNormalization, 'opening_balance'])).rows[0].description, 'Initial account funding');
  const duplicateAccountNumber = await admin.post('/api/admin/users').send({
    email: 'second-member@example.com', password: 'StrongPass1!', firstName: 'Second', lastName: 'Member',
    accountNumber: '123456789012', routingNumber: '321654987', balance: '0',
  });
  assert.equal(duplicateAccountNumber.status, 409);
  const invalidAccountNumber = await admin.post('/api/admin/users').send({
    email: 'invalid-member@example.com', password: 'StrongPass1!', firstName: 'Invalid', lastName: 'Member',
    accountNumber: 'CL12345678', routingNumber: '321654987', balance: '0',
  });
  assert.equal(invalidAccountNumber.status, 400);
  const futureAccountDate = await admin.post('/api/admin/users').send({
    email: 'future-member@example.com', password: 'StrongPass1!', firstName: 'Future', lastName: 'Member',
    createdAt: '2999-01-01',
  });
  assert.equal(futureAccountDate.status, 400);

  const listed = await admin.get('/api/admin/users');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.users.length, 1);
  assert.equal(listed.body.users[0].email, 'admin-created@example.com');
  const accountId = listed.body.users[0].accountId;

  const updated = await admin.put('/api/admin/users').send({
    userId: created.body.user.id,
    firstName: 'Updated',
    lastName: 'Member',
    accountType: 'joint',
    balance: '1999.99',
    accountNumber: '2345678901234',
    routingNumber: '321654987',
  });
  assert.equal(updated.status, 200);
  const ledger = await pool.query('SELECT transaction_type, amount_cents, balance_after_cents FROM account_transactions ORDER BY id');
  assert.equal(ledger.rows.length, 2);
  assert.deepEqual([ledger.rows[0].transaction_type, Number(ledger.rows[0].amount_cents), Number(ledger.rows[0].balance_after_cents)], ['opening_balance', 125037, 125037]);
  assert.deepEqual([Number(ledger.rows[1].amount_cents), Number(ledger.rows[1].balance_after_cents)], [74962, 199999]);
  const savedBalance = await pool.query('SELECT balance_cents FROM accounts WHERE id = $1', [accountId]);
  assert.equal(Number(savedBalance.rows[0].balance_cents), 199999);
  const member = request.agent(app);
  await member.post('/api/auth/login').send({ email: 'admin-created@example.com', password: 'StrongPass1!' });
  const memberAccount = (await member.get('/api/auth/verify')).body.user.account;
  assert.equal(memberAccount.balance, 1999.99);
  assert.equal(memberAccount.accountNumber, '2345678901234');
  assert.equal(memberAccount.routingNumber, '321654987');
  assert.equal(new Date(memberAccount.createdAt).toISOString().slice(0, 10), '2021-06-14');
  const replacement = createApp({ pool, adminPassword: 'test-master-secret', initializeDatabase: false });
  const replacementAdmin = request.agent(replacement);
  assert.equal((await replacementAdmin.post('/api/auth/admin-login').send({ password: 'test-master-secret' })).status, 200);
  const persistedUsers = await replacementAdmin.get('/api/admin/users');
  assert.equal(persistedUsers.body.users[0].balance, 1999.99);
  assert.equal(persistedUsers.body.users[0].transactionCount, 2);
  const audit = await replacementAdmin.get('/api/admin/audit');
  assert.ok(audit.body.events.some((event) => event.action === 'account_created'));
  assert.ok(audit.body.events.some((event) => event.action === 'account_updated'));

  assert.equal((await request(app).delete('/api/admin/users').send({ userId: created.body.user.id })).status, 401);
  assert.equal((await admin.delete('/api/admin/users').send({ userId: created.body.user.id })).status, 200);
  assert.equal((await admin.get('/api/admin/users')).body.users.length, 0);
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM accounts WHERE id = $1', [accountId])).rows[0].count, 0);
});

test('admin stats and payment instructions use protected persistent routes', async () => {
  await signInAdmin();
  const saved = await admin.put('/api/admin/payment-settings').send({
    paymentMethod: 'ACH',
    accountNumber: '1234567890',
    routingNumber: '021000021',
    notes: 'Business day processing',
  });
  assert.equal(saved.status, 200);
  const settings = await admin.get('/api/admin/payment-settings');
  assert.equal(settings.body.ACH.accountNumber, '1234567890');
  assert.equal(settings.body.ACH.routingNumber, '021000021');
  assert.equal((await admin.get('/api/admin/stats')).body.stats.totalAccounts, 0);
});

test('confirmed demo deposit and withdrawal persist balances, history, and a withdrawal receipt', async () => {
  const { user, response } = await signUpUser('requester@example.com');
  const userId = response.body.user.id;
  const accountId = (await pool.query('SELECT account_id FROM users WHERE id = $1', [userId])).rows[0].account_id;
  await signInAdmin();
  await admin.put('/api/admin/payment-settings').send({ paymentMethod: 'ACH', accountNumber: '1234567890', routingNumber: '123456789', notes: 'Fictional demo instructions' });
  const submitted = await user.post('/api/transactions').send({ operation: 'deposit', amount: '25.50', paymentMethod: 'ACH', reference: 'TEST-01' });
  assert.equal(submitted.status, 201);
  assert.match(submitted.body.request.transaction_id, /^FIC-[A-F0-9]{20}$/);
  const pendingHistory = (await user.get('/api/auth/verify')).body.user.account.transactions;
  assert.equal(pendingHistory.at(-1).status, 'completed');
  assert.equal(pendingHistory.at(-1).transactionId, submitted.body.request.transaction_id);
  assert.equal(pendingHistory.at(-1).balance, 50025.5);
  const savedRequest = await pool.query('SELECT destination_account_number, destination_routing_number FROM account_requests WHERE transaction_id = $1', [submitted.body.request.transaction_id]);
  assert.deepEqual([savedRequest.rows[0].destination_account_number, savedRequest.rows[0].destination_routing_number], ['', '']);
  assert.equal(Number((await pool.query('SELECT balance_cents FROM accounts WHERE id = $1', [accountId])).rows[0].balance_cents), 5002550);
  const tooPrecise = await user.post('/api/transactions').send({ operation: 'deposit', amount: '0.001', paymentMethod: 'ACH' });
  assert.equal(tooPrecise.status, 400);

  const requests = await admin.get('/api/admin/requests');
  assert.equal(requests.status, 200);
  assert.equal(requests.body[0].status, 'approved');
  const overdraft = await user.post('/api/transactions').send({ operation: 'withdrawal', amount: '50025.51', bankName: 'Fictional Savings Bank', accountNumber: '987654321012', routingNumber: '987654320' });
  assert.equal(overdraft.status, 409);
  assert.equal(Number((await pool.query('SELECT balance_cents FROM accounts WHERE id = $1', [accountId])).rows[0].balance_cents), 5002550);
  const withdrawal = await user.post('/api/transactions').send({ operation: 'withdrawal', amount: '12.34', bankName: 'Fictional Savings Bank', accountNumber: '987654321012', routingNumber: '987654320' });
  assert.equal(withdrawal.status, 201);
  const withdrawalRequest = (await admin.get('/api/admin/requests')).body.find((item) => item.transactionId === withdrawal.body.request.transaction_id);
  assert.equal(withdrawalRequest.status, 'approved');
  const verified = (await user.get('/api/auth/verify')).body.user;
  assert.equal(verified.account.balance, 50013.16);
  const receipt = verified.account.transactions.find((item) => item.transactionId === withdrawal.body.request.transaction_id);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.receiptAvailable, true);
  assert.equal(receipt.description, 'Withdrawal to Fictional Savings Bank (1012) - 987654320');
  const savedWithdrawal = await pool.query('SELECT description FROM transactions WHERE transaction_id = $1', [withdrawal.body.request.transaction_id]);
  assert.equal(savedWithdrawal.rows[0].description, receipt.description);
  const savedWithdrawalLedger = await pool.query('SELECT description FROM account_transactions WHERE transaction_id = $1', [withdrawal.body.request.transaction_id]);
  assert.equal(savedWithdrawalLedger.rows[0].description, receipt.description);
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM account_transactions WHERE account_id = $1', [accountId])).rows[0].count, 3);
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM transactions WHERE account_id = $1', [accountId])).rows[0].count, 3);
});

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const SESSION_COOKIE = 'cedarline_session';
const SESSION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function formatDollars(cents) {
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function parseBalance(value) {
  const amount = String(value ?? '');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function parseAccountCreatedAt(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const dateOnly = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || dateOnly > new Date().toISOString().slice(0, 10)) return null;
  const createdAt = new Date(`${dateOnly}T00:00:00.000Z`);
  return Number.isNaN(createdAt.getTime()) || createdAt.toISOString().slice(0, 10) !== dateOnly ? null : createdAt;
}

function createTransactionId() {
  return `TXN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function createFictionalAccountNumber() {
  return String(crypto.randomInt(1000000000, 9999999999));
}

function createFictionalRoutingNumber() {
  const firstEight = String(crypto.randomInt(10000000, 99999999));
  const digits = firstEight.split('').map(Number);
  const checksum = (10 - ((digits[0] * 3 + digits[1] * 7 + digits[2] + digits[3] * 3 + digits[4] * 7 + digits[5] + digits[6] * 3 + digits[7] * 7) % 10)) % 10;
  return `${firstEight}${(checksum + 1) % 10}`;
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function setSessionCookie(res, token, maxAge = SESSION_MS) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

function getRequestSessionToken(req) {
  const authorization = String(req.headers.authorization || '');
  return req.cookies?.[SESSION_COOKIE] || (authorization.startsWith('Bearer ') ? authorization.slice(7) : null);
}

async function createSession(pool, sessionType, userId = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (sessionType === 'admin' ? SESSION_MS : 30 * 24 * 60 * 60 * 1000));
  await pool.query(
    'INSERT INTO user_sessions (token_hash, session_type, user_id, expires_at) VALUES ($1, $2, $3, $4)',
    [hashToken(token), sessionType, userId, expiresAt]
  );
  return { token, maxAge: expiresAt.getTime() - Date.now() };
}

async function recordLedgerEvent(client, event) {
  const transactionId = event.transactionId || createTransactionId();
  const result = await client.query(
    `INSERT INTO account_transactions
      (account_id, transaction_type, amount_cents, balance_after_cents, source, description, imported, source_date, transaction_id, generated, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW())) RETURNING occurred_at`,
    [event.accountId, event.type, event.amountCents, event.balanceAfterCents, event.source, event.description, Boolean(event.imported), event.sourceDate || null, transactionId, Boolean(event.generated), event.occurredAt || null]
  );
  await client.query(
    `INSERT INTO transactions (account_id, type, amount, description, balance, date, imported, source_date, transaction_id, generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [event.accountId, event.type, formatDollars(event.amountCents), event.description, formatDollars(event.balanceAfterCents), result.rows[0].occurred_at, Boolean(event.imported), event.sourceDate || null, transactionId, Boolean(event.generated)]
  );
  return transactionId;
}

async function recordAdminAudit(client, action, targetUserId, details) {
  await client.query(
    'INSERT INTO admin_audit_log (actor_username, action, target_user_id, details) VALUES ($1, $2, $3, $4)',
    ['admin', action, targetUserId || null, JSON.stringify(details)]
  );
}

async function updateAccountBalance(client, accountId, balanceCents) {
  const dollars = formatDollars(balanceCents);
  await client.query(
    'UPDATE accounts SET balance_cents = $1, balance = $2, buying_power = $2 WHERE id = $3',
    [balanceCents, dollars, accountId]
  );
}

async function getUserDetails(database, userId) {
  const userResult = await database.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.address_line1, u.address_line2,
      u.city, u.state_code, u.postal_code, u.account_type, a.id AS account_id,
      a.balance_cents, a.buying_power, a.total_deposits, a.unrealized_gains, a.margin_level,
      a.account_number, a.routing_number, a.created_at, a.status
     FROM users u JOIN accounts a ON a.id = u.account_id WHERE u.id = $1`,
    [userId]
  );
  if (!userResult.rowCount) return null;
  const user = userResult.rows[0];
  const [transactionsResult, requestsResult, positionsResult] = await Promise.all([
    database.query(
      `SELECT type, amount, description, balance, transaction_id, generated,
        CASE WHEN imported THEN source_date ELSE date END AS transaction_date, imported
       FROM transactions WHERE account_id = $1 ORDER BY date ASC, id ASC`,
      [user.account_id]
    ),
    database.query(
      `SELECT id, transaction_id, operation, amount_cents, bank_name, account_number_last4,
        destination_routing_number, status, created_at
       FROM account_requests WHERE account_id = $1 ORDER BY created_at ASC, id ASC`,
      [user.account_id]
    ),
    database.query(
      `SELECT symbol, quantity, avg_cost, current_price, unrealized_pl, unrealized_pl_percent
       FROM positions WHERE account_id = $1 ORDER BY symbol`,
      [user.account_id]
    ),
  ]);
  const requestsByTransactionId = new Map(requestsResult.rows.map((row) => [row.transaction_id, row]));
  const transactions = transactionsResult.rows.map((transaction) => {
    const request = requestsByTransactionId.get(transaction.transaction_id);
    return {
      id: transaction.transaction_id,
      transactionId: transaction.transaction_id,
      date: transaction.transaction_date,
      type: transaction.type,
      amount: Number(transaction.amount),
      description: request?.operation === 'withdrawal' && request.status === 'approved'
        ? `Withdrawal to ${request.bank_name} (${request.account_number_last4}) - ${request.destination_routing_number}`
        : transaction.description,
      balance: Number(transaction.balance),
      imported: transaction.imported,
      generated: transaction.generated,
      status: request ? (request.status === 'approved' ? 'completed' : request.status) : 'completed',
      bankName: request?.bank_name || '',
      destinationAccountLast4: request?.account_number_last4 || '',
      destinationRoutingNumber: request?.destination_routing_number || '',
      requestId: request?.id || null,
      receiptAvailable: Boolean(request && request.status === 'approved' && request.operation === 'withdrawal'),
    };
  });
  const loggedTransactionIds = new Set(transactions.map((transaction) => transaction.transactionId));
  for (const request of requestsResult.rows) {
    if (loggedTransactionIds.has(request.transaction_id)) continue;
    const amount = Number(formatDollars(request.amount_cents)) * (request.operation === 'withdrawal' ? -1 : 1);
    transactions.push({
      id: request.transaction_id,
      transactionId: request.transaction_id,
      date: request.created_at,
      type: request.operation,
      amount,
      description: `${request.operation === 'withdrawal' ? 'Withdrawal' : 'Deposit'} request to ${request.bank_name || 'a U.S. bank'}`,
      balance: null,
      imported: false,
      generated: false,
      status: request.status,
      bankName: request.bank_name,
      destinationAccountLast4: request.account_number_last4,
      destinationRoutingNumber: request.destination_routing_number,
      requestId: request.id,
      receiptAvailable: false,
    });
  }
  transactions.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    address: {
      line1: user.address_line1,
      line2: user.address_line2,
      city: user.city,
      state: user.state_code,
      postalCode: user.postal_code,
    },
    accountType: user.account_type,
    account: {
      balance: Number(formatDollars(user.balance_cents)),
      buyingPower: Number(user.buying_power || 0),
      totalDeposits: Number(user.total_deposits || 0),
      unrealizedGains: Number(user.unrealized_gains || 0),
      marginLevel: Number(user.margin_level || 0),
      accountNumber: user.account_number,
      routingNumber: user.routing_number,
      createdAt: user.created_at,
      positions: positionsResult.rows.map((position) => ({
        symbol: position.symbol,
        quantity: Number(position.quantity),
        avgCost: Number(position.avg_cost),
        currentPrice: Number(position.current_price),
        unrealizedPL: Number(position.unrealized_pl),
        unrealizedPLPercent: Number(position.unrealized_pl_percent),
      })),
      transactions,
    },
  };
}

function createApp({ pool, adminPassword, initializeDatabase = true } = {}) {
  const databaseConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  const database = pool || new Pool({ connectionString: databaseConnectionString });
  const masterPassword = adminPassword ?? process.env.ADMIN_MASTER_PASSWORD;
  const app = express();
  const migrationDirectory = path.join(__dirname, 'migrations');
  let ready;
  function ensureReady() {
    if (!initializeDatabase) return Promise.resolve();
    if (!ready) {
      ready = Promise.resolve().then(async () => {
        if (!pool && !databaseConnectionString) {
          throw new Error('DATABASE_URL or POSTGRES_URL must be configured.');
        }
        const files = await fs.readdir(migrationDirectory);
        const migrationFiles = files.filter((file) => /^\d+_[\w-]+\.sql$/.test(file)).sort();
        await database.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)');
        await database.query("INSERT INTO schema_migrations (version) VALUES ('__migration_lock__') ON CONFLICT DO NOTHING");
        const client = await database.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT version FROM schema_migrations WHERE version = $1 FOR UPDATE', ['__migration_lock__']);
          for (const file of migrationFiles) {
            const version = file.replace(/\.sql$/, '');
            const alreadyApplied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
            if (!alreadyApplied.rowCount) {
              const migration = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
              await client.query(migration);
              if (version === '010_opening_funding_dates') {
                const canonicalOpeningRows = await client.query(
                  `SELECT ledger.id, accounts.created_at
                   FROM account_transactions ledger JOIN accounts ON accounts.id = ledger.account_id
                   WHERE ledger.transaction_type = 'opening_balance'`
                );
                for (const row of canonicalOpeningRows.rows) {
                  await client.query('UPDATE account_transactions SET occurred_at = $1 WHERE id = $2', [row.created_at, row.id]);
                }
                const historyOpeningRows = await client.query(
                  `SELECT ledger.id, accounts.created_at
                   FROM transactions ledger JOIN accounts ON accounts.id = ledger.account_id
                   WHERE ledger.type = 'opening_balance'`
                );
                for (const row of historyOpeningRows.rows) {
                  await client.query('UPDATE transactions SET date = $1 WHERE id = $2', [row.created_at, row.id]);
                }
              }
              if (version === '012_replace_legacy_transaction_ids') {
                const legacyIds = new Set();
                for (const table of ['account_transactions', 'transactions', 'account_requests']) {
                  const result = await client.query(`SELECT transaction_id FROM ${table} WHERE transaction_id LIKE 'FIC-%'`);
                  for (const row of result.rows) legacyIds.add(row.transaction_id);
                }
                for (const legacyId of legacyIds) {
                  const transactionId = createTransactionId();
                  await client.query('UPDATE account_transactions SET transaction_id = $1 WHERE transaction_id = $2', [transactionId, legacyId]);
                  await client.query('UPDATE transactions SET transaction_id = $1 WHERE transaction_id = $2', [transactionId, legacyId]);
                  await client.query('UPDATE account_requests SET transaction_id = $1 WHERE transaction_id = $2', [transactionId, legacyId]);
                }
              }
              await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
            }
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      });
    }
    return ready;
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.get('/api/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await ensureReady();
      await database.query('SELECT 1');
      return res.json({ ok: true, database: 'connected' });
    } catch (error) {
      console.error('Health check failed:', error);
      return res.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    ensureReady().then(() => next()).catch(next);
  });
  app.set('trust proxy', 1);

  async function getSession(req) {
    const token = getRequestSessionToken(req);
    if (!token) return null;
    const result = await database.query(
      'SELECT session_type, user_id FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [hashToken(token)]
    );
    return result.rows[0] || null;
  }

  async function requireAdmin(req, res, next) {
    try {
      const session = await getSession(req);
      if (session?.session_type !== 'admin') return res.status(401).json({ error: 'Admin authentication required.' });
      req.adminSession = session;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireUser(req, res, next) {
    try {
      const session = await getSession(req);
      if (session?.session_type !== 'user') return res.status(401).json({ error: 'Sign in to continue.' });
      const result = await database.query(
        `SELECT u.id, u.email, u.account_id FROM users u
         JOIN accounts a ON a.id = u.account_id
         WHERE u.id = $1 AND u.status = $2 AND a.status = 'active'`,
        [session.user_id, 'active']
      );
      if (!result.rowCount) return res.status(401).json({ error: 'This login is no longer active.' });
      req.user = result.rows[0];
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireAuthenticated(req, res, next) {
    try {
      const session = await getSession(req);
      if (session?.session_type === 'admin') {
        req.adminSession = session;
        return next();
      }
      if (session?.session_type === 'user') {
        const result = await database.query(
          `SELECT u.id, u.email, u.account_id FROM users u JOIN accounts a ON a.id = u.account_id
           WHERE u.id = $1 AND u.status = 'active' AND a.status = 'active'`,
          [session.user_id]
        );
        if (result.rowCount) {
          req.user = result.rows[0];
          return next();
        }
      }
      return res.status(401).json({ error: 'Sign in to continue.' });
    } catch (error) {
      return next(error);
    }
  }

  app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie || '';
    req.cookies = Object.fromEntries(cookieHeader.split(';').map((part) => {
      const separator = part.indexOf('=');
      return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
    }).filter(([name]) => name));
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  const adminLoginHandler = async (req, res) => {
    if (!masterPassword) return res.status(503).json({ error: 'Admin access is not configured on this server.' });
    const password = String(req.body?.password || '');
    const passwordMatches = password && password.length <= 1024 && crypto.timingSafeEqual(
      crypto.createHash('sha256').update(password).digest(),
      crypto.createHash('sha256').update(masterPassword).digest()
    );
    if (!passwordMatches) return res.status(401).json({ error: 'Invalid admin password.' });
    const session = await createSession(database, 'admin');
    const adminResult = await database.query('SELECT id, username FROM admin_users WHERE username = $1', ['admin']);
    setSessionCookie(res, session.token, session.maxAge);
    return res.json({ token: session.token, ok: true, admin: { id: adminResult.rows[0]?.id || 1, username: 'admin', role: 'admin' } });
  };
  app.post('/api/auth/admin-login', adminLoginHandler);

  app.get('/api/admin/session', requireAdmin, (_, res) => res.json({ authenticated: true }));
  app.post('/api/admin/logout', requireAdmin, async (req, res) => {
    await database.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(getRequestSessionToken(req))]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/admin/stats', requireAdmin, async (_, res) => {
    const [accounts, users, volume, deposits, average, pendingRequests] = await Promise.all([
      database.query(`SELECT COUNT(*)::int AS total_accounts,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_accounts,
        COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents FROM accounts`),
      database.query(`SELECT COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_users FROM users`),
      database.query(`SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN 0 - amount_cents ELSE amount_cents END), 0)::bigint AS value
        FROM account_transactions WHERE transaction_type = 'trade'`),
      database.query(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS value
        FROM account_transactions WHERE transaction_type = 'deposit' AND amount_cents > 0`),
      database.query('SELECT COALESCE(AVG(balance_cents), 0)::bigint AS value FROM accounts'),
      database.query("SELECT COUNT(*)::int AS value FROM account_requests WHERE status = 'pending'"),
    ]);
    res.json({ stats: {
      totalUsers: users.rows[0].total_users,
      activeUsers: users.rows[0].active_users,
      totalAccounts: accounts.rows[0].total_accounts,
      pendingRequests: pendingRequests.rows[0].value,
      totalVolume: Number(formatDollars(volume.rows[0].value)),
      totalDeposits: Number(formatDollars(deposits.rows[0].value)),
      averageBalance: Number(formatDollars(average.rows[0].value)),
      totalBalance: formatDollars(accounts.rows[0].total_balance_cents),
      activeAccounts: accounts.rows[0].active_accounts,
    } });
  });

  app.get('/api/admin/users', requireAdmin, async (_, res) => {
    const result = await database.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.account_type, u.status,
        a.id AS account_id, a.account_number, a.routing_number, a.balance_cents, a.buying_power, a.created_at AS account_created_at
      FROM users u
      JOIN accounts a ON a.id = u.account_id
      ORDER BY u.created_at DESC, u.id ASC
    `);
    const users = await Promise.all(result.rows.map(async (user) => {
      const count = await database.query('SELECT COUNT(*)::int AS value FROM transactions WHERE account_id = $1', [user.account_id]);
      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        accountType: user.account_type,
        status: user.status,
        balance: Number(formatDollars(user.balance_cents)),
        buyingPower: Number(user.buying_power || 0),
        transactionCount: count.rows[0].value,
        createdAt: user.account_created_at,
        accountId: user.account_id,
        accountNumber: user.account_number,
        routingNumber: user.routing_number,
      };
    }));
    res.json({ users });
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const password = String(req.body?.password || '');
    const accountType = String(req.body?.accountType || 'individual');
    const balanceCents = parseBalance(req.body?.balance ?? req.body?.openingBalance ?? '50000');
    const accountCreatedAt = parseAccountCreatedAt(req.body?.createdAt);
    if (!validEmail(email) || !firstName || !lastName || !password) {
      return res.status(400).json({ error: 'Email, first name, last name, and password are required.' });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      return res.status(400).json({ error: 'Password must have at least 8 characters, an uppercase letter, a lowercase letter, a number, and a special character.' });
    }
    if (!['individual', 'business', 'joint'].includes(accountType)) {
      return res.status(400).json({ error: 'Choose a supported account type.' });
    }
    if (balanceCents === null) return res.status(400).json({ error: 'Balance must be a valid non-negative amount with up to two decimal places.' });
    if (!accountCreatedAt) return res.status(400).json({ error: 'Enter a valid account opening date that is not in the future.' });
    const accountNumber = String(req.body?.accountNumber || '').trim() || createFictionalAccountNumber();
    const routingNumber = String(req.body?.routingNumber || '').trim() || createFictionalRoutingNumber();
    if (!/^\d{8,17}$/.test(accountNumber) || !/^\d{9}$/.test(routingNumber)) {
      return res.status(400).json({ error: 'Use an 8–17 digit account number and a 9-digit routing number.' });
    }
    if ((await database.query('SELECT id FROM users WHERE email = $1', [email])).rowCount) {
      return res.status(409).json({ error: 'User already exists.' });
    }

    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query(
        `INSERT INTO accounts
          (account_number, routing_number, account_type, balance_cents, balance, buying_power, total_deposits, created_at)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $6)
         RETURNING id, account_number, routing_number, created_at`,
        [accountNumber, routingNumber, accountType, balanceCents, formatDollars(balanceCents), accountCreatedAt]
      );
      const account = accountResult.rows[0];
      const passwordHash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        `INSERT INTO users (email, account_id, password_hash, status, first_name, last_name, account_type)
         VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
        [email, account.id, passwordHash, firstName, lastName, accountType]
      );
      const userId = userResult.rows[0].id;
      await client.query('UPDATE accounts SET user_id = $1 WHERE id = $2', [userId, account.id]);
      if (balanceCents > 0) {
        await recordLedgerEvent(client, {
          accountId: account.id,
          type: 'opening_balance',
          amountCents: balanceCents,
          balanceAfterCents: balanceCents,
          source: 'admin_opening_balance',
          description: 'Initial account funding',
          occurredAt: account.created_at,
        });
      }
      const historyStart = new Date(account.created_at).getTime();
      const historyEnd = Date.now();
      const pairCount = crypto.randomInt(4, 11);
      const splitPairIndex = pairCount < 10 && crypto.randomInt(0, 2) ? crypto.randomInt(0, pairCount) : -1;
      const activities = [];
      const incomingOptions = [
        { type: 'deposit', description: 'Payroll deposit' },
        { type: 'transfer', description: 'Transfer from Jordan Reed' },
        { type: 'deposit', description: 'Refund from Greenfield Market' },
      ];
      const outgoingOptions = [
        { type: 'bill_payment', description: 'Electric bill payment - Lakeview Energy' },
        { type: 'bill_payment', description: 'Internet bill payment - MetroNet' },
        { type: 'card_purchase', description: 'Card purchase - Northstar Market' },
        { type: 'card_purchase', description: 'Card purchase - Greenfield Grocery' },
        { type: 'transfer', description: 'Transfer to Casey Morgan' },
      ];
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        const amountCents = crypto.randomInt(1250, 25001) * 2;
        const incoming = pairIndex === 0 ? incomingOptions[0] : incomingOptions[crypto.randomInt(0, incomingOptions.length)];
        const outgoing = pairIndex === 0 ? outgoingOptions[0] : pairIndex === 1 ? outgoingOptions[2] : outgoingOptions[crypto.randomInt(0, outgoingOptions.length)];
        activities.push({ ...incoming, amountCents });
        if (pairIndex === splitPairIndex) {
          activities.push({ ...outgoing, amountCents: -Math.floor(amountCents / 2) });
          activities.push({ ...outgoing, amountCents: -(amountCents - Math.floor(amountCents / 2)) });
        } else {
          activities.push({ ...outgoing, amountCents: -amountCents });
        }
      }
      let runningBalanceCents = balanceCents;
      for (let index = 0; index < activities.length; index += 1) {
        const activity = activities[index];
        runningBalanceCents += activity.amountCents;
        const occurredAt = new Date(historyStart + Math.floor(((historyEnd - historyStart) * (index + 1)) / (activities.length + 1)));
        await recordLedgerEvent(client, {
          accountId: account.id,
          type: activity.type,
          amountCents: activity.amountCents,
          balanceAfterCents: runningBalanceCents,
          source: 'admin_generated_activity',
          description: activity.description,
          generated: true,
          occurredAt,
        });
      }
      await recordAdminAudit(client, 'account_created', userId, { email, accountType, balanceCents, accountNumber, routingNumber, createdAt: account.created_at });
      await client.query('COMMIT');
      return res.status(201).json({
        message: 'User created successfully.',
        user: {
          id: userId,
          email,
          firstName,
          lastName,
          accountType,
          balance: Number(formatDollars(balanceCents)),
          buyingPower: Number(formatDollars(balanceCents)),
          accountNumber,
          routingNumber,
          createdAt: account.created_at,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Email or account number is already in use.' });
      throw error;
    } finally {
      client.release();
    }
  });

  app.put('/api/admin/users', requireAdmin, async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    const hasBalance = req.body.balance !== undefined && req.body.balance !== null && req.body.balance !== '';
    const requestedBalance = hasBalance ? parseBalance(req.body.balance) : null;
    if (hasBalance && requestedBalance === null) return res.status(400).json({ error: 'Balance must be a valid non-negative amount with up to two decimal places.' });
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query('SELECT id, account_id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!userResult.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }
      const { account_id: accountId } = userResult.rows[0];
      const accountResult = await client.query('SELECT balance_cents, account_type FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!accountResult.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User account not found.' });
      }
      const accountType = String(req.body.accountType || accountResult.rows[0].account_type);
      if (!['individual', 'business', 'joint'].includes(accountType)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose a supported account type.' });
      }
      const accountNumber = req.body.accountNumber === undefined ? null : String(req.body.accountNumber).trim();
      const routingNumber = req.body.routingNumber === undefined ? null : String(req.body.routingNumber).trim();
      if ((accountNumber !== null && !/^\d{8,17}$/.test(accountNumber)) || (routingNumber !== null && !/^\d{9}$/.test(routingNumber))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Use an 8–17 digit account number and a 9-digit routing number.' });
      }
      await client.query('UPDATE accounts SET account_type = $1 WHERE id = $2', [accountType, accountId]);
      if (accountNumber !== null || routingNumber !== null) {
        await client.query(
          'UPDATE accounts SET account_number = COALESCE($1, account_number), routing_number = COALESCE($2, routing_number) WHERE id = $3',
          [accountNumber || null, routingNumber || null, accountId]
        );
      }
      const firstName = req.body.firstName === undefined ? null : String(req.body.firstName).trim();
      const lastName = req.body.lastName === undefined ? null : String(req.body.lastName).trim();
      await client.query(
        'UPDATE users SET account_type = $1, first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), updated_at = NOW() WHERE id = $4',
        [accountType, firstName, lastName, userId]
      );
      const previousBalance = Number(accountResult.rows[0].balance_cents);
      let nextBalance = previousBalance;
      let adjustmentDescription = 'Admin balance adjustment';
      let transactionType = 'balance_adjustment';
      let source = 'admin_adjustment';
      if (req.body.operation === 'admin_transfer') {
        const amountCents = parseBalance(req.body.amount);
        if (amountCents === null || amountCents <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Enter a valid positive adjustment amount.' });
        }
        nextBalance += amountCents;
        adjustmentDescription = 'Administrator-recorded balance adjustment';
      } else if (hasBalance) {
        nextBalance = requestedBalance;
      }
      if (!Number.isSafeInteger(nextBalance)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Balance exceeds the supported exact-cent range.' });
      }
      if (nextBalance !== previousBalance) {
        await updateAccountBalance(client, accountId, nextBalance);
        if (nextBalance > previousBalance) {
          transactionType = 'deposit';
          source = 'admin_adjustment';
        }
        await recordLedgerEvent(client, {
          accountId,
          type: transactionType,
          amountCents: nextBalance - previousBalance,
          balanceAfterCents: nextBalance,
          source,
          description: adjustmentDescription,
        });
      }
      await recordAdminAudit(client, 'account_updated', userId, {
        accountType,
        accountNumber,
        routingNumber,
        previousBalanceCents: previousBalance,
        nextBalanceCents: nextBalance,
        firstName,
        lastName,
      });
      await client.query('COMMIT');
      return res.json({ message: 'User updated successfully.' });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'That account number is already in use.' });
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/admin/users', requireAdmin, async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, email, account_id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }
      await recordAdminAudit(client, 'account_deleted', result.rows[0].id, { email: result.rows[0].email, accountId: result.rows[0].account_id });
      await client.query('DELETE FROM accounts WHERE id = $1', [result.rows[0].account_id]);
      await client.query('COMMIT');
      return res.json({ message: 'User deleted successfully.' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/admin/audit', requireAdmin, async (_, res) => {
    const result = await database.query(
      `SELECT id, actor_username, action, target_user_id, details, created_at
       FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT 100`
    );
    return res.json({ events: result.rows.map((row) => ({ ...row, details: JSON.parse(row.details) })) });
  });

  app.get('/api/admin/payment-settings', requireAuthenticated, async (_, res) => {
    const result = await database.query('SELECT payment_method, account_number, routing_number, notes FROM payment_method_settings');
    const settings = Object.fromEntries(result.rows.map((row) => [row.payment_method, {
      accountNumber: row.account_number,
      routingNumber: row.routing_number || '',
      notes: row.notes || '',
    }]));
    return res.json({
      ACH: settings.ACH || { accountNumber: '', routingNumber: '', notes: '' },
      WIRE: settings.WIRE || { accountNumber: '', routingNumber: '', notes: '' },
      INTERNAL: settings.INTERNAL || { accountNumber: '', routingNumber: '', notes: '' },
    });
  });

  app.put('/api/admin/payment-settings', requireAdmin, async (req, res) => {
    const paymentMethod = String(req.body?.paymentMethod || '').toUpperCase();
    const accountNumber = String(req.body?.accountNumber || '').trim();
    const routingNumber = String(req.body?.routingNumber || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!['ACH', 'WIRE', 'INTERNAL'].includes(paymentMethod) || !/^\d{8,17}$/.test(accountNumber) || !/^\d{9}$/.test(routingNumber) || notes.length > 500) {
      return res.status(400).json({ error: 'Provide valid payment method details.' });
    }
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payment_method_settings (payment_method, account_number, routing_number, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (payment_method) DO UPDATE SET account_number = EXCLUDED.account_number,
           routing_number = EXCLUDED.routing_number, notes = EXCLUDED.notes, updated_at = NOW()`,
        [paymentMethod, accountNumber, routingNumber, notes]
      );
      await recordAdminAudit(client, 'deposit_instructions_updated', null, { paymentMethod, accountNumber, routingNumber });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return res.json({ message: 'Payment settings saved successfully.' });
  });

  const processMemberTransaction = async (req, res) => {
    const operation = String(req.body?.operation || '').toLowerCase();
    const amountCents = parseBalance(req.body?.amount);
    if (!['deposit', 'withdrawal'].includes(operation) || amountCents === null || amountCents <= 0) {
      return res.status(400).json({ error: 'Choose a deposit or withdrawal and enter a valid positive amount.' });
    }
    const paymentMethod = String(req.body?.paymentMethod || '').trim().toUpperCase();
    const reference = String(req.body?.reference || '').trim().slice(0, 120);
    const bankName = operation === 'withdrawal' ? String(req.body?.bankName || '').trim().slice(0, 100) : 'Cedarline';
    const destinationAccountNumber = String(req.body?.accountNumber || '').trim();
    const destinationRoutingNumber = String(req.body?.routingNumber || '').trim();
    if (operation === 'deposit' && !['ACH', 'WIRE', 'INTERNAL'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Choose an available deposit method.' });
    }
    if (operation === 'withdrawal' && (!bankName || !/^\d{8,17}$/.test(destinationAccountNumber) || !/^\d{9}$/.test(destinationRoutingNumber))) {
      return res.status(400).json({ error: 'Enter a bank, an 8–17 digit account number, and a 9-digit routing number.' });
    }
    const transactionId = createTransactionId();
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      if (operation === 'deposit') {
        const instructions = await client.query('SELECT account_number FROM payment_method_settings WHERE payment_method = $1', [paymentMethod]);
        if (!instructions.rowCount || !instructions.rows[0].account_number) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'This deposit method is not configured yet.' });
        }
      }
      const accountResult = await client.query('SELECT balance_cents FROM accounts WHERE id = $1 FOR UPDATE', [req.user.account_id]);
      if (!accountResult.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Account not found.' });
      }
      const currentBalance = BigInt(accountResult.rows[0].balance_cents);
      const amount = BigInt(amountCents);
      const signedAmount = operation === 'withdrawal' ? -amount : amount;
      const nextBalance = currentBalance + signedAmount;
      if (nextBalance < 0n) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The withdrawal exceeds the available balance.' });
      }
      if (nextBalance > BigInt(Number.MAX_SAFE_INTEGER)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Balance exceeds the supported exact-cent range.' });
      }
      const requestResult = await client.query(
        `INSERT INTO account_requests
          (account_id, user_id, operation, amount_cents, payment_method, reference, bank_name, account_number_last4, transaction_id,
           destination_account_number, destination_routing_number, status, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'approved', NOW())
         RETURNING id, created_at, status, transaction_id`,
        [req.user.account_id, req.user.id, operation, amountCents, paymentMethod, reference, bankName, destinationAccountNumber.slice(-4), transactionId, destinationAccountNumber, destinationRoutingNumber]
      );
      await updateAccountBalance(client, req.user.account_id, Number(nextBalance));
      if (operation === 'deposit') {
        await client.query('UPDATE accounts SET total_deposits = total_deposits + $1 WHERE id = $2', [formatDollars(amountCents), req.user.account_id]);
      }
      await recordLedgerEvent(client, {
        accountId: req.user.account_id,
        type: operation,
        amountCents: Number(signedAmount),
        balanceAfterCents: Number(nextBalance),
        source: 'member_simulation',
        description: operation === 'deposit'
          ? `Deposit via ${paymentMethod}`
          : `Withdrawal to ${bankName} (${destinationAccountNumber.slice(-4)}) - ${destinationRoutingNumber}`,
        transactionId,
      });
      await client.query('COMMIT');
      const transaction = (await getUserDetails(database, req.user.id)).account.transactions.find((item) => item.transactionId === transactionId);
      return res.status(201).json({
        message: `${operation === 'deposit' ? 'Deposit' : 'Withdrawal'} recorded. No external transfer was made.`,
        request: requestResult.rows[0],
        transaction,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  app.post('/api/transactions', requireUser, processMemberTransaction);
  app.patch('/api/admin/users', requireUser, processMemberTransaction);

  app.get('/api/admin/requests', requireAdmin, async (_, res) => {
    const result = await database.query(`
      SELECT r.id, r.account_id, r.user_id, r.operation, r.amount_cents, r.payment_method, r.reference,
        r.bank_name, r.account_number_last4, r.destination_routing_number, r.status, r.created_at, r.transaction_id,
        ledger.id AS ledger_id, u.email, u.first_name, u.last_name, a.account_number
      FROM account_requests r JOIN users u ON u.id = r.user_id
      JOIN accounts a ON a.id = r.account_id
      LEFT JOIN account_transactions ledger ON ledger.transaction_id = r.transaction_id
      ORDER BY r.created_at DESC
    `);
    return res.json(result.rows.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      accountId: row.account_id,
      userId: row.user_id,
      operation: row.operation,
      amount: formatDollars(row.amount_cents),
      paymentMethod: row.payment_method,
      reference: row.reference,
      bankName: row.bank_name,
      accountNumberLast4: row.account_number_last4,
      routingNumber: row.destination_routing_number,
      status: row.status,
      settled: row.ledger_id !== null,
      createdAt: row.created_at,
      email: row.email,
      fullName: `${row.first_name} ${row.last_name}`.trim(),
      accountNumber: row.account_number,
    })));
  });

  app.patch('/api/admin/requests/:id', requireAdmin, async (req, res) => {
    const decision = String(req.body?.decision || '');
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Choose approve or reject.' });
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const requestResult = await client.query('SELECT * FROM account_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!requestResult.rowCount || requestResult.rows[0].status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending request not found.' });
      }
      const requestRow = requestResult.rows[0];
      await client.query('UPDATE account_requests SET status = $1, reviewed_at = NOW() WHERE id = $2', [decision === 'approve' ? 'approved' : 'rejected', requestRow.id]);
      await recordAdminAudit(client, `request_${decision}d`, requestRow.user_id, { transactionId: requestRow.transaction_id, operation: requestRow.operation, amountCents: Number(requestRow.amount_cents) });
      await client.query('COMMIT');
      return res.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected', transactionId: requestRow.transaction_id });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const accountType = String(req.body?.accountType || 'individual');
    if (!firstName || !lastName || !validEmail(email) || !password) {
      return res.status(400).json({ message: 'First name, last name, valid email, and password are required.' });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      return res.status(400).json({ message: 'Password must have at least 8 characters, an uppercase letter, a lowercase letter, a number, and a special character.' });
    }
    if (!['individual', 'business', 'joint'].includes(accountType)) {
      return res.status(400).json({ message: 'Choose a supported account type.' });
    }
    const existing = await database.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) return res.status(409).json({ message: 'Email exists' });

    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const balanceCents = 5000000;
      const accountNumber = createFictionalAccountNumber();
      const routingNumber = createFictionalRoutingNumber();
      const accountResult = await client.query(
        `INSERT INTO accounts
          (account_number, routing_number, account_type, balance_cents, balance, buying_power, total_deposits)
         VALUES ($1, $2, $3, $4, $5, $5, $5) RETURNING id, account_number, routing_number, created_at`,
        [accountNumber, routingNumber, accountType, balanceCents, '50000.00']
      );
      const account = accountResult.rows[0];
      const passwordHash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        `INSERT INTO users (email, account_id, password_hash, status, first_name, last_name, account_type)
         VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
        [email, account.id, passwordHash, firstName, lastName, accountType]
      );
      const userId = userResult.rows[0].id;
      await client.query('UPDATE accounts SET user_id = $1 WHERE id = $2', [userId, account.id]);
      await recordLedgerEvent(client, {
        accountId: account.id,
          type: 'opening_balance',
        amountCents: balanceCents,
        balanceAfterCents: balanceCents,
        source: 'signup_initial_funding',
        description: 'Initial account funding',
        occurredAt: account.created_at,
      });
      await client.query('COMMIT');
      const session = await createSession(database, 'user', userId);
      setSessionCookie(res, session.token, session.maxAge);
      const user = await getUserDetails(database, userId);
      return res.status(201).json({ token: session.token, user });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ message: 'Email exists' });
      throw error;
    } finally {
      client.release();
    }
  });

  const loginHandler = async (req, res) => {
    const email = cleanEmail(req.body?.email ?? req.body?.usernameOrEmail);
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const result = await database.query(
      `SELECT u.id, u.email, u.password_hash, u.status FROM users u
       JOIN accounts a ON a.id = u.account_id
       WHERE u.email = $1 AND a.status = 'active'`,
      [email]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active' || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const session = await createSession(database, 'user', user.id);
    setSessionCookie(res, session.token, session.maxAge);
    const details = await getUserDetails(database, user.id);
    return res.json({ token: session.token, ok: true, email: user.email, user: details });
  };
  app.post('/api/auth/login', loginHandler);

  const userDetailsHandler = async (req, res) => {
    const user = await getUserDetails(database, req.user.id);
    return res.json({ token: getRequestSessionToken(req), user });
  };
  app.get('/api/auth/verify', requireUser, userDetailsHandler);

  app.put('/api/profile', requireUser, async (req, res) => {
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const addressLine1 = String(req.body?.address?.line1 || '').trim();
    const addressLine2 = String(req.body?.address?.line2 || '').trim();
    const city = String(req.body?.address?.city || '').trim();
    const state = String(req.body?.address?.state || '').trim().toUpperCase();
    const postalCode = String(req.body?.address?.postalCode || '').trim();
    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || addressLine1.length > 120 || addressLine2.length > 120 || city.length > 100 || (state && !/^[A-Z]{2}$/.test(state)) || (postalCode && !/^\d{5}(?:-\d{4})?$/.test(postalCode))) {
      return res.status(400).json({ error: 'Check the name and address fields.' });
    }
    await database.query(
      `UPDATE users SET first_name = $1, last_name = $2, address_line1 = $3, address_line2 = $4,
       city = $5, state_code = $6, postal_code = $7, updated_at = NOW() WHERE id = $8`,
      [firstName, lastName, addressLine1, addressLine2, city, state, postalCode, req.user.id]
    );
    return res.json({ user: await getUserDetails(database, req.user.id) });
  });

  app.post('/api/auth/logout', requireUser, async (req, res) => {
    await database.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(getRequestSessionToken(req))]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/chat', async (_, res) => {
    const result = await database.query('SELECT id, sender, email, message, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 30');
    res.json(result.rows.reverse());
  });

  app.post('/api/chat', async (req, res) => {
    const sender = String(req.body?.sender || '').trim();
    const email = cleanEmail(req.body?.email) || null;
    const message = String(req.body?.message || '').trim();
    if (!sender || !message) return res.status(400).json({ error: 'Name and message are required.' });
    const result = await database.query(
      'INSERT INTO chat_messages (sender, email, message) VALUES ($1, $2, $3) RETURNING id, sender, email, message, created_at',
      [sender, email, message]
    );
    res.status(201).json(result.rows[0]);
  });

  app.use((error, req, res, next) => {
    console.error('Request failed:', error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'The request could not be completed. Please try again.' });
  });

  app.locals.pool = database;
  Object.defineProperty(app.locals, 'ready', { get: ensureReady });
  return app;
}

const app = createApp();
app.createApp = createApp;

module.exports = app;
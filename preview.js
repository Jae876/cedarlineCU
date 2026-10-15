const crypto = require('crypto');
const { newDb } = require('pg-mem');
const { Pool } = require('pg');
const { createApp } = require('./app');

const previewPassword = process.env.ADMIN_MASTER_PASSWORD || crypto.randomBytes(24).toString('base64url');
const usesNeon = Boolean(process.env.DATABASE_URL);
const pool = usesNeon
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new (newDb().adapters.createPg().Pool)();
const app = createApp({ pool, adminPassword: previewPassword });
const port = Number(process.env.API_PORT || 3001);

app.locals.ready.then(() => {
  const server = app.listen(port, () => {
    console.log(`Temporary API preview: http://localhost:${port}`);
    console.log(process.env.ADMIN_MASTER_PASSWORD ? 'Admin password loaded from server-side .env.' : `Temporary admin password: ${previewPassword}`);
    console.log(usesNeon ? 'Neon PostgreSQL persistence is enabled.' : 'Preview data is in-memory and is discarded when this process stops.');
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Set PORT to another available port and retry.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}).catch((error) => {
  console.error('Unable to initialize the preview database:', error.message);
  process.exitCode = 1;
});

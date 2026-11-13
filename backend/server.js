const { createServer } = require('node:http');
const config = require('./config');
const db = require('./db');
const app = require('./app');
const { initSocket } = require('./services/socket');
const { seedDemoIfEmpty } = require('./scripts/seed-demo');

async function main() {
  await db.initDb();

  // Local development only: create a demo company on an empty database.
  if (!config.isProduction) await seedDemoIfEmpty();

  const server = createServer(app);
  initSocket(server);
  server.listen(config.port, () => {
    console.log(`NOVA backend listening on http://localhost:${config.port} (${config.env}, ${process.env.DATABASE_URL ? 'PostgreSQL' : 'embedded PostgreSQL'})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await db.closeDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

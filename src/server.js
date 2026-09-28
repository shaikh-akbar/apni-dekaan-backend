import { assertEnv, env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './app.js';
import { verifyMailTransport } from './services/mail.service.js';

assertEnv();

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`Apni Dukaan API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  verifyMailTransport();
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

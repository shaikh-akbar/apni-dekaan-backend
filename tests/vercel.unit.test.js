import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import fs from 'node:fs';
import request from 'supertest';

// Dummy configuration: these tests never contact a database or mail server.
Object.assign(process.env, {
  VERCEL: '1', NODE_ENV: 'production', COOKIE_SECURE: 'true',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/not_used',
  JWT_SECRET: 'test-only-vercel-secret-at-least-32-characters', SMTP_HOST: 'smtp.invalid',
});

let app;
it('imports the Vercel entry point without creating directories', async () => {
  const original = fs.mkdirSync;
  fs.mkdirSync = () => { throw new Error('Read-only deployment filesystem'); };
  try {
    ({ default: app } = await import('../src/app.js'));
    assert.equal(typeof app, 'function');
  } finally { fs.mkdirSync = original; }
});

it('serves health and handles missing favicons without crashing', async () => {
  const health = await request(app).get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  for (const path of ['/favicon.ico', '/favicon.png']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 404);
    assert.ok(response.body.error);
  }
});

it('rejects local disk uploads on Vercel before persisting an unusable file', async () => {
  const { default: express } = await import('express');
  const { imageUpload } = await import('../src/middleware/upload.js');
  const probe = express();
  probe.post('/upload', imageUpload.single('image'), (_req, res) => res.sendStatus(201));
  probe.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  const response = await request(probe).post('/upload')
    .attach('image', Buffer.from('test'), { filename: 'test.png', contentType: 'image/png' });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /persistent object storage/);
});

after(async () => {
  const { prisma } = await import('../src/config/prisma.js');
  await prisma.$disconnect();
});

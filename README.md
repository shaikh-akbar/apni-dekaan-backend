# Apni Dukaan — Backend

Express 5 + Prisma REST API for the loyalty system, using PostgreSQL (including Supabase). See [Supabase setup](docs/supabase.md) for connection settings, deployment, testing, and existing MySQL data migration.

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
npm test   # needs .env.test pointing at a *_test database
```

Set both `DATABASE_URL` and `DIRECT_URL` in `.env` before running Prisma commands.
The existing frontend continues using the Express API; it does not connect to Supabase directly.

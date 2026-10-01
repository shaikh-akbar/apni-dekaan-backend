# Supabase PostgreSQL setup

The backend now uses PostgreSQL with Prisma 6. API routes, response fields, cookie authentication, and business rules are unchanged. The frontend requires no database-specific code changes.

## Connect a new Supabase database

1. Create a Supabase project and open its **Connect** panel. Use database connection strings, not the project HTTPS URL or an API key.
2. Set the following in the backend `.env` or hosting environment. Copy the actual host and username from your project's Connect panel; the values below are placeholders. URL-encode special characters in the database password.

```dotenv
# Transaction pooler for runtime connections (especially serverless deployments).
DATABASE_URL="postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=require"
# Session pooler for migrations, available over IPv4. Do not use port 6543 here.
DIRECT_URL="postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require"
```

A direct database URL from Connect can also be used for `DIRECT_URL` when your host supports its network requirements. For local PostgreSQL, both variables can contain the same local URL from `.env.example`.

3. With the target empty database configured, run:

```sh
npm install
npm run db:generate
npm run db:deploy
```

4. Set `NODE_ENV=production`, a strong `JWT_SECRET`, `COOKIE_SECURE=true`, your SMTP settings, and unique `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` values before running `npm run db:seed` for production. Production seeding creates the initial admin/access control/settings without demo customers. Never use the example admin password in production.

The migration enables row-level security on all application tables without browser policies. Access stays through the authenticated Express API using a trusted database owner connection (such as Supabase's postgres connection). Do not add public read/write policies or put database credentials in frontend variables. If you later use a restricted database role, design its permissions/RLS access explicitly.

## Frontend deployment

The existing frontend at `frontend/apni-dukaan-frontend` already uses `VITE_API_URL` and sends cookies with requests. For separate subdomain hosting:

```dotenv
# Frontend hosting environment, followed by a frontend rebuild:
VITE_API_URL=https://api-dukaan.gomodexa.com/api
# Backend hosting environment:
CORS_ORIGINS=https://dukaan.gomodexa.com
COOKIE_SECURE=true
```

Continue hosting the Express backend. This database migration does not deploy the app to Vercel or move local uploads into Supabase Storage.

## Existing MySQL installations

`prisma/mysql-migrations/` and `prisma/schema.mysql.prisma` preserve the old MySQL schema/history for reference. Active migrations are PostgreSQL-only. Do not apply them to MySQL, reuse MySQL's `_prisma_migrations` records in PostgreSQL, or run `db:reset` on a live database.

The new migration creates tables; it does **not** transfer existing records. Before switching a live installation:

1. Back up MySQL and keep the old deployment available for rollback.
2. Create the empty PostgreSQL schema, then arrange a separate data export/import while application writes are paused. Preserve IDs, decimal amounts, timestamps, JSON, enums, and relationships. Import parent tables before dependent tables.
3. Advance PostgreSQL sequences past imported IDs; otherwise future inserts can collide.
4. Compare row counts, customer balances, purchases, reward states, and login behavior before switching backend connection variables.

Search explicitly uses case-insensitive Prisma filters to retain ordinary mixed-case search behavior. PostgreSQL collation is not an exact replacement for MySQL's accent/collation rules. Existing emails and invoices should conform to the application's lowercase-email/uppercase-invoice normalization before import.

Your private `.env` and `.env.test` are not overwritten by this change; replace old MySQL URLs locally before starting the migrated backend.

## Tests

Use a disposable PostgreSQL database whose **database name ends with `_test`**. Copy `.env.test.example` to `.env.test` and configure its credentials. Run `npm test`. The integration helper forces migrations to use the same test database and truncates only the application's tables, resetting their sequences.

For database-free checks: `node --test tests/loyalty.unit.test.js`.

References: [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Prisma 6 case sensitivity](https://docs.prisma.io/docs/orm/v6/prisma-client/queries/case-sensitivity).

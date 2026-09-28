# Apni Dukaan — Backend

Express 5 + Prisma REST API for the loyalty system. See the [project README](../README.md) for setup, business rules, API reference and deployment.

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
npm test   # needs .env.test pointing at a *_test database
```

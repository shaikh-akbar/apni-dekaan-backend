import { PrismaClient, Prisma } from '@prisma/client';

// Money columns are DECIMAL(12,2); serialise them as plain numbers in JSON responses.
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return this.toNumber();
};

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export { Prisma };

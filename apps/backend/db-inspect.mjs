import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
config({ path: new URL('./.env', import.meta.url).pathname });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const tenants = await prisma.tenant.findMany({
  include: {
    users: { select: { id: true, email: true, role: true } },
    suppliers: { select: { id: true, name: true, feedUrl: true, lastSyncedAt: true } },
  },
});
console.log(JSON.stringify(tenants, null, 2));
const productCount = await prisma.product.count();
const categoryCount = await prisma.category.count();
console.log('products:', productCount, 'categories:', categoryCount);
await prisma.$disconnect();

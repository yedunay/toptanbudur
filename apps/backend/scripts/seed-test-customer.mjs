/* eslint-disable no-console */
/**
 * Seed Test Customer
 * ------------------
 *  - Test ortamı için tek bir Customer kaydı oluşturur / günceller.
 *  - Idempotent: tekrar çalıştırıldığında aynı kullanıcı upsert edilir.
 *
 * Komut:
 *   docker compose exec backend node scripts/seed-test-customer.mjs
 *   # veya
 *   pnpm --filter backend run seed:test-customer
 *
 * Env:
 *   DATABASE_URL  (PostgreSQL connection string)
 *
 * Çıktı:
 *   email:    musteri@test.local  (override: TEST_CUSTOMER_EMAIL)
 *   password: test1234            (override: TEST_CUSTOMER_PASSWORD)
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

try {
  const { config } = await import('dotenv');
  config({ path: new URL('../.env', import.meta.url).pathname });
} catch {
  // env zaten container runtime tarafından sağlandı
}

const EMAIL = process.env.TEST_CUSTOMER_EMAIL ?? 'musteri@test.local';
const PASSWORD = process.env.TEST_CUSTOMER_PASSWORD ?? 'test1234';
const NAME = process.env.TEST_CUSTOMER_NAME ?? 'Test Müşteri';
const PHONE = process.env.TEST_CUSTOMER_PHONE ?? '+905000000000';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  console.log('[seed-test-customer] starting');

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const customer = await prisma.customer.upsert({
    where: { email: EMAIL },
    update: {
      name: NAME,
      phone: PHONE,
      passwordHash,
      discountPercent: 0,
    },
    create: {
      email: EMAIL,
      passwordHash,
      name: NAME,
      phone: PHONE,
      discountPercent: 0,
    },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
  });

  console.log('\n=== TEST CUSTOMER ===');
  console.log('Email:    ', customer.email);
  console.log('Password: ', PASSWORD);
  console.log('Name:     ', customer.name);
  console.log('Phone:    ', customer.phone);
  console.log('CreatedAt:', customer.createdAt);
  console.log('=====================\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed-test-customer] FAILED:', err);
  process.exit(1);
});

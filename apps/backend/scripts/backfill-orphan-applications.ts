/**
 * Tek seferlik backfill: Customer kaydı olmayan DealerApplication'lar için
 * pasif (isActive=false, mustChangePassword=true) Customer üret.
 *
 * Kullanım (backend container içinde):
 *   pnpm tsx scripts/backfill-orphan-applications.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ssl: { rejectUnauthorized: false } }),
});
const BCRYPT_ROUNDS = 12;

function generateTempPassword(): string {
  // 12 karakter base64url — sadece hash'lenip atılacak, dışarı çıkmayacak.
  return crypto.randomBytes(9).toString('base64url');
}

function normalizeTrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) return '+90' + d.slice(1);
  if (d.length === 10) return '+90' + d;
  if (d.length === 12 && d.startsWith('90')) return '+' + d;
  return raw;
}

async function main() {
  const apps = await prisma.dealerApplication.findMany({
    orderBy: { createdAt: 'asc' },
  });
  let created = 0;
  let skipped = 0;
  for (const app of apps) {
    const email = app.email.trim().toLowerCase();
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      skipped++;
      console.log(`SKIP existing customer email=${email}`);
      continue;
    }
    const conflict = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (conflict && conflict.role !== 'CUSTOMER') {
      skipped++;
      console.log(`SKIP admin-user conflict email=${email}`);
      continue;
    }
    const hash = await bcrypt.hash(generateTempPassword(), BCRYPT_ROUNDS);
    await prisma.customer.create({
      data: {
        email,
        passwordHash: hash,
        name: app.name,
        phone: normalizeTrPhone(app.phone),
        vergiDairesi: app.vergiDairesi ?? null,
        discountPercent: 0,
        mustChangePassword: true,
        isActive: false,
      },
    });
    if (app.status === 'PENDING') {
      await prisma.dealerApplication.update({
        where: { id: app.id },
        data: { status: 'PRE_REGISTERED' },
      });
    }
    created++;
    console.log(`CREATED customer email=${email} fromStatus=${app.status}`);
  }
  console.log(`\nDone. created=${created} skipped=${skipped} total=${apps.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

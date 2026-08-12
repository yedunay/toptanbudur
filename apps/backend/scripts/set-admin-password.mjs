/* eslint-disable no-console */
/**
 * One-shot: belirtilen admin kullanıcısının parolasını direkt günceller.
 * Kod parola policy'sini bypass eder — sadece dev için.
 *
 *   node scripts/set-admin-password.mjs <email> <newPassword>
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

try {
  const { config } = await import('dotenv');
  config({ path: new URL('../.env', import.meta.url).pathname });
} catch {}

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('Kullanım: node scripts/set-admin-password.mjs <email> <password>');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`Kullanıcı bulunamadı: ${email}`);
  process.exit(2);
}

const hash = await bcrypt.hash(password, 12);
await prisma.user.update({
  where: { id: user.id },
  data: { passwordHash: hash, mustChangePassword: false },
});

console.log(`OK: ${email} parolası güncellendi (mustChangePassword=false).`);
await prisma.$disconnect();

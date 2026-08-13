/**
 * Toptan Budur — minimum seed.
 *
 * SADECE iki kayıt oluşturur:
 *   1. Tenant  (slug: toptanbudur)
 *   2. Tek OWNER kullanıcı (admin@toptanbudur.com)
 *
 * Demo ürün / tedarikçi / müşteri verisi BİLİNÇLİ OLARAK YOKTUR — sistem
 * müşteriye bomboş teslim edilir. Idempotent: tekrar çalıştırmak güvenlidir,
 * mevcut parolayı EZMEZ (parola sıfırlamak için scripts/reset-admin.ts).
 *
 * Çalıştırma:
 *   pnpm seed                 # (= tsx prisma/seed.ts)
 *   pnpm prisma db seed
 *
 * Env:
 *   DATABASE_URL          (zorunlu)
 *   SEED_TENANT_SLUG      (varsayılan: toptanbudur)
 *   SEED_TENANT_NAME      (varsayılan: Toptan Budur)
 *   SEED_ADMIN_EMAIL      (varsayılan: admin@toptanbudur.com)
 *   SEED_ADMIN_PASSWORD   (verilmezse güçlü bir varsayılan kullanılır ve
 *                          konsola basılır — ilk girişten sonra DEĞİŞTİRİN)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'toptanbudur';
// `??` yerine boşluk-kırpılmış kontrol: `.env.example` dosyalarında bu
// anahtarlar BOŞ olarak bulunuyor; `??` boş string'i "verilmiş" sayıp
// PAROLASIZ admin oluşturuyordu (giriş her denemede 401 dönüyordu).
const envOr = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v !== undefined && v.trim() !== '' ? v : fallback;
};

const TENANT_NAME = envOr('SEED_TENANT_NAME', 'Toptan Budur');
const ADMIN_EMAIL = envOr('SEED_ADMIN_EMAIL', 'admin@toptanbudur.com');
const ADMIN_PASSWORD = envOr('SEED_ADMIN_PASSWORD', 'TbAdmin!2026.Degistir');
const PASSWORD_FROM_ENV =
  (process.env.SEED_ADMIN_PASSWORD ?? '').trim() !== '';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL tanımlı değil.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME },
    create: { slug: TENANT_SLUG, name: TENANT_NAME },
  });
  console.log(`tenant: ${tenant.slug} (${tenant.name})`);

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  });

  if (existing) {
    // Parolayı EZME — yalnızca tenant/rol bağını garanti et.
    await prisma.user.update({
      where: { id: existing.id },
      data: { tenantId: tenant.id, role: 'OWNER' },
    });
    console.log(`admin: ${ADMIN_EMAIL} (zaten var, parola korundu)`);
  } else {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        name: 'Admin',
        role: 'OWNER',
        tenantId: tenant.id,
        mustChangePassword: !PASSWORD_FROM_ENV,
      },
    });
    console.log(`admin: ${ADMIN_EMAIL} (oluşturuldu)`);
    if (!PASSWORD_FROM_ENV) {
      console.log(
        `parola: ${ADMIN_PASSWORD}  — SEED_ADMIN_PASSWORD verilmediği için ` +
          `varsayılan kullanıldı; ilk girişte değiştirilmesi zorunlu.`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

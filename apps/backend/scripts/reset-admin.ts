/**
 * Tek OWNER admin kullanıcısının parolasını sıfırlar (yoksa oluşturur).
 *
 *   pnpm tsx scripts/reset-admin.ts
 *
 * Env:
 *   DATABASE_URL          (zorunlu)
 *   SEED_TENANT_SLUG      (varsayılan: toptanbudur)
 *   SEED_ADMIN_EMAIL      (varsayılan: admin@toptanbudur.com)
 *   SEED_ADMIN_PASSWORD   (zorunlu — kısa/boş parola kabul edilmez)
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }

  const tenantSlug = process.env.SEED_TENANT_SLUG ?? 'toptanbudur';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@toptanbudur.com';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      'SEED_ADMIN_PASSWORD zorunlu ve en az 12 karakter olmalı.',
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const passwordHash = await bcrypt.hash(password, 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: {},
    create: { slug: tenantSlug, name: 'Toptan Budur' },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, tenantId: tenant.id, role: 'OWNER', name: 'Admin' },
    create: {
      email,
      passwordHash,
      tenantId: tenant.id,
      role: 'OWNER',
      name: 'Admin',
    },
  });

  console.log(`OK ${user.email} tenant=${tenant.slug} (parola güncellendi)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// LOKAL DEMO VERİSİ — sadece geliştirme/inceleme için.
// Müşteriye teslim edilen sistemde ÇALIŞTIRILMAZ (sistem boş teslim edilir).
// Çalıştır: docker compose exec -T backend node scripts/demo-data.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const CUSTOMER_EMAIL = 'bayi@toptanbudur.com';
const CUSTOMER_PASSWORD = 'Bayi1234!';

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'toptanbudur' } });
  if (!tenant) throw new Error('tenant bulunamadı — önce prisma/seed.ts çalıştır');

  // --- Demo bayi (müşteri) ---
  const customer = await prisma.customer.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: { isActive: true },
    create: {
      email: CUSTOMER_EMAIL,
      passwordHash: await bcrypt.hash(CUSTOMER_PASSWORD, 10),
      name: 'Demo Bayi',
      companyTitle: 'Demo Bayi Ticaret Ltd. Şti.',
      phone: '+905550000001',
      isActive: true,
      mustChangePassword: false,
    },
  });

  // --- Demo tedarikçi ---
  let supplier = await prisma.supplier.findFirst({
    where: { tenantId: tenant.id, name: 'Demo Tedarikçi' },
  });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: { tenantId: tenant.id, name: 'Demo Tedarikçi', active: true },
    });
  }

  // --- Demo kategori ---
  let category = await prisma.category.findFirst({
    where: { tenantId: tenant.id, slug: 'demo-kategori' },
  });
  if (!category) {
    category = await prisma.category.create({
      data: { tenantId: tenant.id, name: 'Demo Kategori', slug: 'demo-kategori', path: 'Demo Kategori' },
    });
  }

  // --- Demo ürünler ---
  const items = [
    { code: 'DEMO-001', name: 'Demo Ürün 1 — Kablosuz Kulaklık', brand: 'DemoMarka', cost: 250, price: 399.9, stock: 120 },
    { code: 'DEMO-002', name: 'Demo Ürün 2 — Powerbank 10000mAh', brand: 'DemoMarka', cost: 180, price: 289.9, stock: 80 },
    { code: 'DEMO-003', name: 'Demo Ürün 3 — USB-C Kablo 2m', brand: 'DemoMarka', cost: 35, price: 69.9, stock: 500 },
  ];

  for (const it of items) {
    const slug = it.code.toLowerCase();
    await prisma.product.upsert({
      where: { tenantId_supplierId_externalCode: { tenantId: tenant.id, supplierId: supplier.id, externalCode: it.code } },
      update: { stock: it.stock, price: it.price, active: true },
      create: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        categoryId: category.id,
        externalCode: it.code,
        slug,
        name: it.name,
        brand: it.brand,
        costPrice: it.cost,
        price: it.price,
        currency: 'TRY',
        stock: it.stock,
        active: true,
        isCanonical: true,
        contentHash: `demo-${it.code}`,
      },
    });
  }

  const counts = {
    musteri: await prisma.customer.count(),
    tedarikci: await prisma.supplier.count(),
    urun: await prisma.product.count(),
  };
  console.log(JSON.stringify({ customer: customer.email, password: CUSTOMER_PASSWORD, ...counts }));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().finally(() => process.exit(1)); });

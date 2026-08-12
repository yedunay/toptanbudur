# Toptan Budur — B2B Toptan Satış Platformu

Bayilere kapalı devre toptan satış yapmak için kullanılan üç parçalı bir
uygulama: bayi vitrini, yönetim paneli ve bunları besleyen API.

| Uygulama | Klasör | Teknoloji | Port (dev) |
|----------|--------|-----------|-----------|
| API | `apps/backend` | NestJS + Prisma + PostgreSQL + Redis | 4000 |
| Bayi vitrini | `apps/frontend` | Next.js (App Router) | 3001 |
| Yönetim paneli | `apps/admin` | React + Vite (SPA, `/admin/`) | 3002 |

Üretimde hepsi tek alan adı altında nginx arkasında yayınlanır:
`/api` → backend, `/admin/` → panel, geri kalan her şey → vitrin.

## Ne yapar?

- **Katalog** — ürün, kategori, marka yönetimi; tedarikçi XML feed'lerinden
  içe aktarım ve eşleştirme.
- **Fiyatlandırma** — bayi bazlı iskonto, kademeli kâr marjı, KDV yönetimi.
- **Sipariş** — sepet, sipariş yaşam döngüsü, kargo takibi (Basit Kargo
  entegrasyonu), sipariş PDF'i.
- **Cari** — bayi cari hesabı, bakiye yükleme, ekstre, tahsilat makbuzu.
- **Ödeme** — PayTR sanal POS (iFrame API).
- **Fatura** — BirFatura entegrasyonu ile e-fatura/e-arşiv.
- **Destek** — bayi destek talepleri ve mesajlaşma.
- **Raporlama** — kârlılık, günlük Z raporu, tedarikçi bakiye senkronu.

## Hızlı başlangıç (yerel)

```bash
# 1) Env dosyaları
cp .env.dev.example .env
cp apps/backend/.env.dev.example  apps/backend/.env
cp apps/frontend/.env.example     apps/frontend/.env.local
cp apps/admin/.env.example        apps/admin/.env
# apps/backend/.env içindeki JWT_*/VAULT_*/ORDER_TOKEN_* alanlarını doldurun:
#   openssl rand -hex 32

# 2) Veri katmanı (Postgres + Redis + MinIO) — 127.0.0.1'e bağlı
docker compose up -d postgres redis minio

# 3) Bağımlılıklar (her uygulama bağımsız)
(cd apps/backend  && pnpm install)
(cd apps/frontend && pnpm install)
(cd apps/admin    && pnpm install)

# 4) Şema + ilk yönetici
cd apps/backend
pnpm prisma migrate deploy
SEED_ADMIN_PASSWORD='<güçlü-parola>' pnpm seed

# 5) Çalıştır (ayrı terminallerde)
(cd apps/backend  && pnpm dev)   # http://localhost:4000
(cd apps/frontend && pnpm dev)   # http://localhost:3001
(cd apps/admin    && pnpm dev)   # http://localhost:3002/admin/
```

Tüm stack'i container içinde çalıştırmak için `.env`'deki `COMPOSE_FILE`
zaten `docker-compose.yml:docker-compose.dev.yml` olarak ayarlıdır; sadece
`docker compose up -d` demek yeterlidir.

## Seed

`pnpm seed` **yalnızca** tenant (`toptanbudur`) ve tek bir OWNER kullanıcısı
(`admin@toptanbudur.com`) oluşturur. Demo ürün / tedarikçi / müşteri verisi
yoktur — sistem boş başlar. Parola `SEED_ADMIN_PASSWORD` ile verilir; verilmezse
varsayılan bir parola kullanılır, konsola basılır ve ilk girişte değiştirilmesi
zorunlu tutulur.

## Kurulum ve işletim

Sunucu kurulumu, DNS, TLS, yedekleme ve günlük operasyon adımları için
[`DEPLOY.md`](./DEPLOY.md) dosyasına bakın.

## Klasörler

```
apps/backend    NestJS API + Prisma şeması, migration'lar, bakım script'leri
apps/frontend   Next.js bayi vitrini
apps/admin      Vite + React yönetim paneli
infra/          nginx şablonları, certbot entrypoint, watchdog, env örnekleri
```

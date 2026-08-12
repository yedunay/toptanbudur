# Toptan Budur — Backend (API)

NestJS + Prisma + PostgreSQL + Redis üzerine kurulu B2B API. Vitrin
(`apps/frontend`) ve yönetim paneli (`apps/admin`) bu servisi tüketir.
Tüm uçlar `/api` ön ekiyle yayınlanır; XML feed uçları `/xml` altındadır.

## Kurulum

```bash
cp .env.dev.example .env      # sonra JWT_*/VAULT_*/ORDER_TOKEN_* doldurun
pnpm install
pnpm prisma migrate deploy
SEED_ADMIN_PASSWORD='<güçlü-parola>' pnpm seed
pnpm dev                      # http://localhost:4000
```

Postgres ve Redis'i repo kökünden ayağa kaldırabilirsiniz:

```bash
docker compose up -d postgres redis minio
```

## Komutlar

| Komut | Ne yapar |
|-------|----------|
| `pnpm dev` | Watch modda geliştirme sunucusu |
| `pnpm build` / `pnpm start:prod` | Derle / derlenmiş sürümü çalıştır |
| `pnpm test` · `pnpm test:cov` | Birim testleri · kapsam |
| `pnpm test:e2e` | Uçtan uca testler |
| `pnpm lint` · `pnpm format` | ESLint (--fix) · Prettier |
| `pnpm seed` | Tenant + tek OWNER admin (boş sistem) |
| `pnpm prisma migrate dev` | Şema değişikliğinden migration üret |

## Seed

`prisma/seed.ts` **yalnızca** iki kayıt oluşturur: `toptanbudur` tenant'ı ve
`admin@toptanbudur.com` OWNER kullanıcısı. Demo ürün/tedarikçi/müşteri verisi
bilinçli olarak yoktur. Idempotenttir ve mevcut parolayı ezmez.

| Env | Varsayılan |
|-----|-----------|
| `SEED_TENANT_SLUG` | `toptanbudur` |
| `SEED_TENANT_NAME` | `Toptan Budur` |
| `SEED_ADMIN_EMAIL` | `admin@toptanbudur.com` |
| `SEED_ADMIN_PASSWORD` | verilmezse güçlü bir varsayılan (konsola basılır, ilk girişte değişmesi zorunlu) |

Parolayı sonradan sıfırlamak için: `pnpm tsx scripts/reset-admin.ts`.

## Yapılandırma

Tüm ayarlar `.env` üzerinden okunur; şablonlar:

- `.env.dev.example` — yerel geliştirme
- `.env.prod.example` — sunucu (harici Postgres, Cloudflare R2 storage)
- `.env.example` — kodun okuduğu tüm anahtarların tam referansı

Çalışma zamanında değişebilen ayarlar (fatura bekleme süresi, POS komisyonu,
kargo paket ölçüleri vb.) `.env`'de değil, yönetim panelindeki
**Ayarlar → Değişkenler** ekranında (`AppSetting`) tutulur.

## `scripts/`

Tek seferlik bakım ve backfill script'leri. Hiçbiri otomatik çalışmaz; elle
tetiklenir ve çoğu `--dry-run` / `DRY_RUN=1` destekler. Çalıştırmadan önce
dosyanın başındaki açıklamayı okuyun.

# Toptan Budur — Production Deployment

Tek sunucu, tek alan adı (`toptanbudur.com`), önünde Docker içinde **nginx**.
Diğer her şey (Redis, NestJS backend, Next.js storefront, admin SPA) özel bir
docker network'ünde yaşar ve host'a hiçbir port açmaz — tek kapı nginx'tir.

Postgres **harici** bir sunucuda (native daemon), object storage **Cloudflare
R2**'dedir. Temiz bir sunucuda `docker compose up -d` yeterlidir; certbot ilk
açılışta sertifikayı alır ve sonrasında kendisi yeniler.

---

## 1. DNS

Kayıt operatöründe (Cloudflare kullanıyorsanız ACME HTTP-01 için
**DNS-only / gri bulut** modunda):

| Type | Name | Value        | TTL |
|------|------|--------------|-----|
| A    | @    | `<SUNUCU_IPV4>` | 300 |
| AAAA | @    | `<SUNUCU_IPV6>` | 300 |
| A    | www  | `<SUNUCU_IPV4>` | 300 |
| AAAA | www  | `<SUNUCU_IPV6>` | 300 |

`www`, nginx tarafından apex'e 301 ile yönlendirilir.

> Cloudflare proxy (turuncu bulut) kullanacaksanız DNS-01 challenge'a geçin —
> HTTP-01, Cloudflare edge'i ile çakışır. En kolay ilk deploy: gri bulut,
> sertifika alındıktan sonra turuncuya geçin.

## 2. Firewall

Yalnızca **22 / 80 / 443** açık olmalı. Redis / backend / app portları
yayınlanmaz; docker bridge üzerinde kalır.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Açılıştan sonra `docker compose ps` çıktısında host portu **yalnızca**
`tb-nginx` için (`0.0.0.0:80, 0.0.0.0:443`) görünmelidir. Başka bir şey
görünüyorsa yanlış yapılandırma vardır.

## 3. Sunucu hazırlığı

```bash
# Docker Engine + compose plugin (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # çıkış yapıp tekrar girin
```

Repoyu klonlayın ve env dosyalarını hazırlayın:

```bash
git clone <repo> /opt/tb-platform
cd /opt/tb-platform

cp .env.prod.example .env
cp apps/backend/.env.prod.example  apps/backend/.env
cp apps/frontend/.env.example      apps/frontend/.env.local
cp apps/admin/.env.example         apps/admin/.env
# Düzenle:
#   /.env                    — DOMAIN, TENANT_SLUG, LETSENCRYPT_*, TELEGRAM_*,
#                              WATCHDOG_* (Postgres prod'da harici — POSTGRES_* YOK)
#   apps/backend/.env        — DATABASE_URL (uzak postgres), JWT_*, R2_*,
#                              SMTP_*, BIRFATURA_*, PAYTR_*
#   apps/frontend/.env.local — NEXT_PUBLIC_*, INTERNAL_API_BASE
#   apps/admin/.env          — VITE_*
```

> Env yapısı **4 dosyalı, sıkı izole**:
> - `/.env` (kök) — sadece compose okur (DOMAIN, TENANT_SLUG, LETSENCRYPT_*, TELEGRAM_*, WATCHDOG_*)
> - `apps/backend/.env` — backend secret'ları (DATABASE_URL, JWT, R2, SMTP, BirFatura, PayTR)
> - `apps/frontend/.env.local` — NEXT_PUBLIC_*, INTERNAL_API_BASE, TB_API_BASE
> - `apps/admin/.env` — VITE_*
>
> Hiçbir uygulama diğerinin secret'ına erişemez.
>
> Kök `.env`'de `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` vardır;
> aynı `docker compose up -d` komutu hem laptop'ta dev hem sunucuda prod stack'ini
> ayağa kaldırır.

Güçlü değerler üretin (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ORDER_TOKEN_SECRET`,
`VAULT_MASTER_KEY`, `PASSWORD_VAULT_KEY`):

```bash
openssl rand -hex 32   # her biri için ayrı çıktı kullanın
```

## 4. İlk SSL — staging prova (önerilir)

Let's Encrypt prod uç noktası hostname başına haftada 5 sertifika ile
sınırlıdır. Önce staging'e karşı deneyin:

```bash
# .env içinde
LETSENCRYPT_STAGING=1

docker compose up -d
docker compose logs -f certbot
# "Successfully received certificate" arayın — sertifika tarayıcıda güvenilir olmaz
```

Staging çalıştıktan sonra prod'a dönüp yeniden alın:

```bash
# .env içinde
LETSENCRYPT_STAGING=0

docker compose down certbot nginx
docker volume rm tb-platform_letsencrypt   # staging artıklarını at
docker compose up -d
```

> Volume ön eki compose'daki `name: tb-platform` ile eşleşir. Proje adını
> değiştirdiyseniz ona göre uyarlayın (`docker volume ls` ile bakın).

## 5. Açılış

```bash
docker compose up -d
docker compose ps
```

Beklenen sıra (`docker compose logs -f` ile izlenebilir):

1. `redis` healthy olur.
2. `backend` başlar, migration'ları uygular, `:4000` dinler (dahili).
3. `frontend`, `admin` build/serve edilir.
4. `nginx` başlar. İlk açılışta `init-certs.sh` 1 günlük self-signed sertifika
   yazar; nginx hemen :443 dinleyebilsin diye.
5. `certbot` nginx'i bekler, sonra `${DOMAIN}` (ve `INCLUDE_WWW=1` ise
   `www.${DOMAIN}`) için `certbot certonly --webroot` çalıştırır. Gerçek
   sertifika `letsencrypt` volume'una iner.
6. 6 saat içinde (ya da `docker compose exec nginx nginx -s reload` ile hemen)
   nginx gerçek sertifikayı alır; self-signed uyarısı biter.

İlk kurulumda tenant + tek OWNER admin kullanıcısını oluşturun:

```bash
docker compose exec -e SEED_ADMIN_PASSWORD='<güçlü-parola>' backend pnpm seed
```

## 6. Sağlık kontrolleri

```bash
curl -I https://toptanbudur.com/          # 200, Next.js storefront
curl -I https://www.toptanbudur.com/      # 301 → apex
curl -I https://toptanbudur.com/api/health
```

Dışarıdan port taraması **yalnızca 22, 80, 443** göstermeli:

```bash
nmap -p- -T4 toptanbudur.com
```

## 7. Sertifika yenileme

- Let's Encrypt sertifikaları **90 gün** geçerlidir.
- `tb-certbot` içindeki certbot **12 saatte bir** `certbot renew` çalıştırır.
- `certbot renew`, sertifikanın son **30 günü** dolmadan hiçbir şey yapmaz;
  gerçek yenileme ~60. günde olur — bol pay bırakır.
- nginx 6 saatte bir config'ini yeniler (`nginx -s reload`) ve yenilenmiş
  sertifikayı dışarıdan sinyal gerekmeden alır.

Elle zorla yenileme (ör. iletişim e-postası değiştikten sonra):

```bash
docker compose exec certbot certbot renew --force-renewal --webroot -w /var/www/certbot
docker compose exec nginx   nginx -s reload
```

## 8. Yerel geliştirme

Yerelde tüm stack container'da koşabilir ya da yalnız veri katmanı container'da
kalıp uygulamalar native çalışabilir. Aynı `docker compose up -d` komutu iki
makinede de çalışır; fark `.env` dosyasındadır.

```bash
# Tek seferlik kurulum — 4 dosya, sıkı izole
cp .env.dev.example .env                          # compose-only
cp apps/backend/.env.dev.example  apps/backend/.env
cp apps/frontend/.env.example     apps/frontend/.env.local
cp apps/admin/.env.example        apps/admin/.env

# Bağımlılıklar (her app bağımsız; kendi klasöründe çalıştırın)
(cd apps/backend  && pnpm install)
(cd apps/frontend && pnpm install)
(cd apps/admin    && pnpm install)

# Yalnız veri katmanı container'da, uygulamalar native:
docker compose up -d postgres redis minio   # 127.0.0.1'e bağlı
(cd apps/backend  && pnpm prisma migrate deploy && pnpm seed && pnpm dev)  # → :4000
(cd apps/frontend && pnpm dev)                                            # → :3001
(cd apps/admin    && pnpm dev)                                            # → :3002/admin/
```

nginx ve SSL bootstrap **yalnızca prod'dadır** — yerelde her uygulamaya kendi
portundan erişilir.

## 9. Yedekleme

- **Postgres** — günlük cron ile `pg_dump`, çıktıyı R2'ye/harici depoya atın.
- **Let's Encrypt** — `letsencrypt` volume'u hesap anahtarlarını + sertifikaları
  tutar. Haftalık yedekleyin ki felaket kurtarmada ACME rate-limit yakmadan geri
  dönebilesiniz.
- **Secret'lar** — `.env` ve `infra/*.env` dosyalarını parola yöneticisinde /
  Vault'ta tutun. Asla commit etmeyin.

## 10. Sık kullanılan işlemler

```bash
# Stack durumu
docker compose ps

# nginx access log
docker compose exec nginx tail -f /var/log/nginx/access.log

# infra/nginx/templates/default.conf.template düzenledikten sonra
docker compose restart nginx

# Yeni image'lar, yeniden build, redeploy
git pull
docker compose pull
docker compose build
docker compose up -d
```

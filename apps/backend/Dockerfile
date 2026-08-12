# syntax=docker/dockerfile:1.7
# Debian (bookworm-slim) tabanı — glibc gereken native modüller (Prisma engine
# vb.) için Alpine'a göre daha güvenli.
FROM node:20-bookworm-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Puppeteer kurulumda Chrome İNDİRMESİN — slim image'da unzip/tar yok, indirme
# extraction'da patlayıp `pnpm install`'u (tüm build'i) düşürüyor. Chromium prod/
# dev runtime'a apt ile ayrı kurulur (aşağıda) ve PUPPETEER_EXECUTABLE_PATH ile
# gösterilir.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --no-frozen-lockfile

# Development target: bind-mount source from host, run `pnpm dev` for hot reload.
# `pnpm install` on every start is defensive — if the anonymous node_modules
# volume is empty/stale (e.g. fresh checkout, host arch mismatch, deleted
# volume) it repopulates; if everything is already in place, pnpm exits
# in seconds. `prisma generate` regenerates the client against the current
# schema; `migrate deploy` applies any pending migrations idempotently.
FROM node:20-bookworm-slim AS dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=development
# Makbuz PDF'i için sistem Chromium (puppeteer kendi indirmesini atlar).
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 4000
CMD ["sh", "-c", "pnpm install --no-frozen-lockfile && pnpm prisma generate && pnpm prisma migrate deploy && pnpm dev"]

FROM node:20-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM node:20-bookworm-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
# Makbuz PDF'i için sistem Chromium — receipt-pdf.service bu path'i kullanır.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY package.json pnpm-lock.yaml prisma.config.ts ./
EXPOSE 4000
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/src/main.js"]

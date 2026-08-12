import { BadRequestException } from '@nestjs/common';
import * as dns from 'node:dns';
import { promisify } from 'node:util';

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// DNS sonuçlarını 5 dakika cache'le — her sync'te tekrar sorgulanmasın.
// Hetzner → Türk tedarikçi DNS gecikmesini tamamen ortadan kaldırır.
const dnsCache = new Map<string, { addrs: string[]; expiresAt: number }>();
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Hostname'i çözümler, sonucu 5dk cache'ler.
 * dns.resolve4/6 kullanır (libc'den bağımsız, Node event loop'u).
 * Her iki protokol de başarısız olursa hata fırlatır.
 */
async function resolveAddresses(host: string): Promise<string[]> {
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > now) return cached.addrs;

  const [v4, v6] = await Promise.allSettled([
    dnsResolve4(host),
    dnsResolve6(host),
  ]);

  const addrs: string[] = [];
  if (v4.status === 'fulfilled') addrs.push(...v4.value);
  if (v6.status === 'fulfilled') addrs.push(...v6.value);

  if (addrs.length === 0) {
    throw new Error('no addresses resolved');
  }

  dnsCache.set(host, { addrs, expiresAt: now + DNS_CACHE_TTL_MS });
  return addrs;
}

/**
 * SSRF guard: feed URL http(s) olmalı, hostname literal private IP olmamalı,
 * DNS lookup sonucu da private adres olmamalı. Aksi halde BadRequestException.
 *
 * NOT: http:// de kabul edilir. Bazı tedarikçiler (ör. ebijuteri) XML feed'i
 * yalnızca HTTP üzerinden sunar, HTTPS bağlantısını reddeder (ECONNREFUSED).
 * Ürün XML'i hassas veri olmadığından http güvenlidir; asıl SSRF koruması
 * aşağıdaki private-IP (literal + DNS) kontrolleridir, protokolden bağımsız çalışır.
 *
 * Bu helper IngestService.runSync ve AdminSuppliersService.triggerCategorySync
 * tarafından paylaşılır — iki yerde de aynı policy uygulanmalı.
 */
export async function assertSafeFeedUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('feedUrl is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('feedUrl must use http:// or https://');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new BadRequestException('feedUrl resolves to a private network');
  }
  try {
    const addrs = await resolveAddresses(host);
    for (const addr of addrs) {
      const isPrivate = addr.includes(':')
        ? isPrivateIPv6(addr)
        : isPrivateIPv4(addr);
      if (isPrivate) {
        throw new BadRequestException('feedUrl resolves to a private network');
      }
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('feedUrl host could not be resolved');
  }
}

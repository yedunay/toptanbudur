import type { Request } from 'express';

export type DeviceType = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'BOT' | 'UNKNOWN';

/**
 * Reverse-proxy / load balancer ardındaki istemci IP'sini güvenilir biçimde
 * çıkarır. `req.ip` Express'in trust-proxy ayarına bağlı olduğu için bunun
 * yerine `x-forwarded-for` zincirinin ilk IP'sine, yoksa socket.remoteAddress'e
 * düşeriz.
 */
export function extractClientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  } else if (Array.isArray(xff) && xff.length > 0) {
    const first = xff[0]?.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real.trim();
  return req.socket?.remoteAddress ?? null;
}

export function extractUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua.length > 0 ? ua : null;
}

/**
 * Lightweight UA -> DeviceType eşleyici. Üçüncü parti kütüphane gerektirmez.
 */
export function detectDeviceType(ua: string | null | undefined): DeviceType {
  if (!ua) return 'UNKNOWN';
  const s = ua.toLowerCase();
  if (/(bot|crawler|spider|slurp|wget|curl|httpclient)/i.test(s)) return 'BOT';
  if (/ipad|tablet|kindle|playbook|silk/.test(s)) return 'TABLET';
  if (/(android(?!.*mobile))|tablet/.test(s) && !/mobile/.test(s)) return 'TABLET';
  if (/(mobi|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini)/.test(s)) {
    return 'MOBILE';
  }
  return 'DESKTOP';
}

export function buildRequestMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
  deviceType: DeviceType;
} {
  const ip = extractClientIp(req);
  const userAgent = extractUserAgent(req);
  return { ip, userAgent, deviceType: detectDeviceType(userAgent) };
}

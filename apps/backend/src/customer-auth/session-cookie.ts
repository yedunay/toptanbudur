import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE_NAME = 'tb_session';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSessionCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';

  // Çerez alanı. Boş string ("") verilirse host-only çerez üretilir — IP
  // üzerinden (domainsiz) yayında ZORUNLUDUR: tarayıcılar IP adresi için
  // Domain nitelikli çerezi tümden reddeder, oturum sessizce açılmaz.
  const rawDomain = process.env.SESSION_COOKIE_DOMAIN;
  const domain =
    rawDomain === undefined
      ? isProd
        ? undefined // domain verilmediyse host-only: her kuruluma uyar
        : 'localhost'
      : rawDomain.trim() === ''
        ? undefined
        : rawDomain.trim();

  // Secure bayrağı. Varsayılan NODE_ENV'e bağlı, ama TLS olmadan (ör. IP
  // üzerinden HTTP ile geliştirme) çalışırken kapatılabilmeli: Secure çerez
  // düz HTTP'de tarayıcı tarafından GÖNDERİLMEZ ve giriş sessizce başarısız olur.
  const secureEnv = process.env.SESSION_COOKIE_SECURE;
  const secure =
    secureEnv === undefined ? isProd : secureEnv.toLowerCase() === 'true';

  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: SEVEN_DAYS_MS,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignore, ...rest } = buildSessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, rest);
}

/**
 * Parse the raw `Cookie` request header without pulling cookie-parser. The
 * format is `name=value; name2=value2`; values may be percent-encoded.
 */
export function readSessionCookie(
  rawHeader: string | undefined,
  name: string,
): string | null {
  if (!rawHeader) return null;
  const parts = rawHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const v = part.slice(eq + 1).trim();
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

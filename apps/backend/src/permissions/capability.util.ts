import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';

/**
 * Yetenek anahtarları — sayfa DEĞİL, sayfa içi yetki. İzin matrisinde ayrı
 * satır olarak görünür, varsayılanı KAPALI'dır ve patron istediği kullanıcıya
 * açabilir (yasak liste yok — 2026-07-31 patron kararı).
 *
 *  - `yetki_maliyet_kar`    → alış maliyeti / kâr türevli alanları görebilir
 *  - `yetki_para_islemleri` → bakiye, iade onayı, ödeme kaydı gibi para yazan
 *                             işlemleri yapabilir
 *
 * OWNER daima yetkilidir (`['*']`). ADMIN rol şablonunda her iki anahtar da
 * varsayılan AÇIK gelir (ADMIN_PAGES = tüm anahtarlar − depo_stogu).
 *
 * `PagePermissionGuard` canlı izin listesini `req.livePermissions`'a yazar;
 * buradaki yardımcılar onu okur — ekstra DB turu yoktur. Guard zincirde yoksa
 * (teorik) JWT claim'ine düşülür, o da yoksa rol OWNER/ADMIN ise izin verilir.
 */
export const CAP_COST_PROFIT = 'yetki_maliyet_kar';
export const CAP_MONEY_OPS = 'yetki_para_islemleri';

type CapabilityRequest = Request & {
  user: RequestUser;
  livePermissions?: readonly string[];
};

function hasCapability(req: CapabilityRequest, key: string): boolean {
  const perms = req.livePermissions ?? req.user?.permissions ?? null;
  if (perms) {
    if (perms.includes('*')) return true;
    return perms.includes(key);
  }
  const role = req.user?.role;
  return role === 'OWNER' || role === 'ADMIN';
}

/** Maliyet/kâr türevli alanlar bu kullanıcıya gösterilebilir mi? */
export function canSeeCostProfit(req: CapabilityRequest): boolean {
  return hasCapability(req, CAP_COST_PROFIT);
}

/** Para yazan işlemleri (bakiye, iade onayı, ödeme kaydı) yapabilir mi? */
export function canDoMoneyOps(req: CapabilityRequest): boolean {
  return hasCapability(req, CAP_MONEY_OPS);
}

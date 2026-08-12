import { Role } from '@prisma/client';
import { PAGE_KEYS, type PageKey } from './permission-keys';

/**
 * Role-based default page permissions.
 *
 * - OWNER:    `*` — sınırsız erişim. Override tablosu bu rol için yok sayılır.
 * - ADMIN:    Tüm sayfalar (Depo HARİÇ — bu sayfa yalnızca OWNER'a
 *             aittir, controller seviyesinde @Roles('OWNER') ile de kapalıdır).
 * - MEMBER:   Çalışan rolü. Default'u YALNIZ "Hesabım"; DİĞER HER ŞEY KAPALI
 *             gelir ama patron izin matrisinden İSTEDİĞİ her sayfayı ve
 *             yetkiyi açabilir — yasak liste YOKTUR (2026-07-31 patron kararı:
 *             "her sayfanın açılma yetkisi benim elimde olmalı").
 * - CUSTOMER: Admin paneline hiç giremez (boş liste).
 */
const ADMIN_PAGES: readonly PageKey[] = PAGE_KEYS.filter(
  (k) => k !== 'depo_stogu',
);

export const ROLE_PAGE_DEFAULTS: Readonly<Record<Role, readonly PageKey[] | '*'>> = {
  OWNER: '*',
  ADMIN: ADMIN_PAGES,
  MEMBER: ['ayarlar_hesap'],
  CUSTOMER: [],
};

export function isUnboundedRole(role: Role): boolean {
  return ROLE_PAGE_DEFAULTS[role] === '*';
}

export function getRoleDefaults(role: Role): readonly PageKey[] {
  const value = ROLE_PAGE_DEFAULTS[role];
  if (value === '*') return PAGE_KEYS;
  return value;
}

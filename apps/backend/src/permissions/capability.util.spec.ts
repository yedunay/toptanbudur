import { canDoMoneyOps, canSeeCostProfit } from './capability.util';

/**
 * Yetenek anahtarları — "⚙ Yetki — Maliyet & Kâr" ve "⚙ Yetki — Para İşlemi".
 * Patron bunları izin matrisinden istediği kullanıcıya açar; varsayılan kapalı.
 */
function req(perms?: string[], role = 'MEMBER') {
  return {
    // perms verilmezse hiçbir izin bilgisi yok → rol yedeğine düşülür.
    user: { id: 'u1', role, permissions: perms, tenantId: 't1', email: 'x@y.z' },
    livePermissions: perms,
  } as never;
}

describe('capability.util', () => {
  it('yetki verilmemişse KAPALI (varsayılan)', () => {
    expect(canSeeCostProfit(req([]))).toBe(false);
    expect(canDoMoneyOps(req([]))).toBe(false);
  });

  it('patron maliyet yetkisini açınca AÇILIR — para yetkisi ayrı kalır', () => {
    expect(canSeeCostProfit(req(['orders', 'yetki_maliyet_kar']))).toBe(true);
    expect(canDoMoneyOps(req(['orders', 'yetki_maliyet_kar']))).toBe(false);
  });

  it('patron para yetkisini açınca AÇILIR — maliyet yetkisi ayrı kalır', () => {
    expect(canDoMoneyOps(req(['customers', 'yetki_para_islemleri']))).toBe(true);
    expect(canSeeCostProfit(req(['customers', 'yetki_para_islemleri']))).toBe(
      false,
    );
  });

  it("OWNER ('*') her iki yetkiye de sahiptir", () => {
    expect(canSeeCostProfit(req(['*'], 'OWNER'))).toBe(true);
    expect(canDoMoneyOps(req(['*'], 'OWNER'))).toBe(true);
  });

  it('izin bilgisi hiç yoksa role düşer (OWNER/ADMIN evet, MEMBER hayır)', () => {
    expect(canSeeCostProfit(req(undefined, 'ADMIN'))).toBe(true);
    expect(canDoMoneyOps(req(undefined, 'OWNER'))).toBe(true);
    expect(canSeeCostProfit(req(undefined, 'MEMBER'))).toBe(false);
  });

  it('BOŞ izin listesi (bozuk/eski token) → fail-closed, rol yedeği YOK', () => {
    // Boş dizi "bilgi yok" değil "hiçbir yetki yok" demektir; ADMIN bile olsa
    // açmıyoruz — canlı izin listesi guard tarafından her istekte tazelenir.
    expect(canSeeCostProfit(req([], 'ADMIN'))).toBe(false);
  });
});

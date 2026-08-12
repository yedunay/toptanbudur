import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminFinanceService } from '../admin/finance/finance.service';
import { trParts } from '../common/utils/tr-time';
import type { PartnerContext } from './partner-finance-api-key.service';

/**
 * Dış Finans API için ortağa özel projeksiyon. Tüm rakamlar mevcut "Aylık Kâr
 * Dağılımı" motorundan (AdminFinanceService) gelir — TEK doğru kaynak. Bu servis
 * yalnızca ilgili ortağın dilimini + şirket toplamlarını sadeleştirir; asla yeni
 * hesap yapmaz. Böylece panel ile API kuruşu kuruşuna aynı olur.
 */

const MIN_MONTH = '2020-01';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class PartnerFinanceDataService {
  constructor(private readonly finance: AdminFinanceService) {}

  /** Şu anki TR takvim ayı ("YYYY-MM"). */
  private currentMonth(): string {
    const { year, month } = trParts(new Date());
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /**
   * Ay parametresini doğrular + makul aralığa sıkıştırır. Dış istek gelecekteki
   * ya da absürt bir ay ile ağır materyalizasyon/tarama tetikleyemesin.
   */
  private normalizeMonth(raw?: string): string {
    const cur = this.currentMonth();
    if (raw == null || raw === '') return cur;
    if (!MONTH_RE.test(raw)) {
      throw new BadRequestException('Geçersiz ay (YYYY-MM bekleniyor).');
    }
    if (raw > cur) {
      throw new BadRequestException('Gelecek bir ay talep edilemez.');
    }
    if (raw < MIN_MONTH) {
      throw new BadRequestException(`En erken ${MIN_MONTH} talep edilebilir.`);
    }
    return raw;
  }

  private clampCount(raw: unknown, fallback: number, max: number): number {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(1, n));
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private mySlices(
    panel: Awaited<ReturnType<AdminFinanceService['getMonthlyPanel']>>,
    partnerId: string,
  ) {
    const dist = panel.partners.find((p) => p.id === partnerId);
    const cap = panel.capital.partners.find((p) => p.id === partnerId);
    if (!dist || !cap) {
      throw new NotFoundException('Ortak bu dönemde bulunamadı.');
    }
    return { dist, cap };
  }

  // ── /me ────────────────────────────────────────────────────────────────────
  identity(partner: PartnerContext) {
    return {
      ortak: {
        id: partner.id,
        ad: partner.name,
        payYuzde: partner.sharePercent,
      },
      erisim: 'GET-only finans verisi',
      olusturulma: this.nowIso(),
    };
  }

  // ── /summary — başlık kartı (seçili ay + kümülatif) ─────────────────────────
  async summary(partner: PartnerContext, monthRaw?: string) {
    const month = this.normalizeMonth(monthRaw);
    const panel = await this.finance.getMonthlyPanel(partner.tenantId, month, 1);
    const { dist, cap } = this.mySlices(panel, partner.id);

    return {
      ay: panel.month,
      ayEtiket: panel.monthLabel,
      olusturulma: this.nowIso(),
      sirket: {
        ay: {
          toplamGelir: panel.toplam.gelen,
          toplamGider: panel.toplam.giden,
          toplamKar: panel.toplam.kar,
          kdvFarki: panel.toplam.kdvFarki,
          dagitilabilirBakiye: panel.distribution.dagitilabilirBakiye,
        },
        kumulatif: {
          toplamKar: panel.capital.karCum,
          kdvFarki: panel.capital.kdvFarkiCum,
          havuzMasraf: panel.capital.poolCum,
          promoGideri: panel.capital.promoCum,
          kartKomisyonFarki: panel.capital.cardSpreadCum,
          netDagitilabilir: panel.capital.netDistCum,
          donerSermaye: panel.capital.netTotal,
        },
      },
      ortak: {
        id: dist.id,
        ad: dist.name,
        payYuzde: dist.sharePercent,
        ay: {
          pay: dist.share,
          dengeleme: dist.dengeleme,
          hakedis: dist.onerilen, // bu ay Toptan Budur'un ortağa borcu (önerilen ödeme)
        },
        kumulatif: {
          netAlacak: cap.netCredit, // sistem başından beri toplam hak ediş
          cekilenAvans: cap.advTotal, // şimdiye kadar çekilen/ödenen
          netBakiye: cap.netBalance, // Toptan Budur'un ortağa NET borcu (+ = AB borçlu)
        },
      },
    };
  }

  // ── /monthly — seçili ayın tam dökümü ────────────────────────────────────────
  async monthly(partner: PartnerContext, monthRaw?: string) {
    const month = this.normalizeMonth(monthRaw);
    const panel = await this.finance.getMonthlyPanel(partner.tenantId, month, 1);
    const { dist, cap } = this.mySlices(panel, partner.id);

    return {
      ay: panel.month,
      ayEtiket: panel.monthLabel,
      olusturulma: this.nowIso(),
      bayi: panel.bayi.current, // { gelen, giden, kar, kdvFarki }
      entegrasyon: panel.entegrasyon.current,
      toplam: panel.toplam,
      masraflar: {
        toplam: panel.expenses.total,
        odenen: panel.expenses.paidTotal,
      },
      dagitim: {
        dagitilabilirBakiye: panel.distribution.dagitilabilirBakiye,
        havuzMasraf: panel.distribution.havuzMasraf,
        kartKomisyonFarki: panel.distribution.cardSpread,
        promoGideri: panel.distribution.promo,
      },
      ortak: {
        id: dist.id,
        ad: dist.name,
        payYuzde: dist.sharePercent,
        pay: dist.share,
        dengeleme: dist.dengeleme,
        hakedis: dist.onerilen,
        kumulatif: {
          netAlacak: cap.netCredit,
          cekilenAvans: cap.advTotal,
          netBakiye: cap.netBalance,
        },
      },
    };
  }

  // ── /series — ay-ay şirket trendi + ortağın o ayki çekimleri ─────────────────
  async series(partner: PartnerContext, monthsRaw?: string, toRaw?: string) {
    const to = this.normalizeMonth(toRaw);
    const count = this.clampCount(monthsRaw, 6, 24);
    // TEK panel çağrısı: trend `count` ay şirket gelen/giden/kar verir (hafif).
    const panel = await this.finance.getMonthlyPanel(partner.tenantId, to, count);

    // Ortağın ay-ay çektiği kâr avansı (net) — tek sorgu, aya göre kovala.
    const advances = await this.finance.listAdvances(partner.tenantId, to);
    const drawByMonth = new Map<string, number>();
    for (const a of advances) {
      if (a.partnerId !== partner.id) continue;
      drawByMonth.set(a.month, (drawByMonth.get(a.month) ?? 0) + a.netAmount);
    }

    return {
      to: panel.month,
      ayAdedi: panel.trend.length,
      olusturulma: this.nowIso(),
      aylar: panel.trend.map((t) => ({
        ay: t.month,
        etiket: t.label,
        toplamGelir: t.gelen,
        toplamGider: t.giden,
        toplamKar: t.kar,
        cektigimAvans: Math.round((drawByMonth.get(t.month) ?? 0) * 100) / 100,
      })),
    };
  }

  // ── /advances — ortağın kâr avansı (çekim) geçmişi ────────────────────────────
  async advances(partner: PartnerContext, fromRaw?: string, toRaw?: string) {
    const to = toRaw ? this.normalizeMonth(toRaw) : undefined;
    let from: string | undefined;
    if (fromRaw) {
      if (!MONTH_RE.test(fromRaw)) {
        throw new BadRequestException('Geçersiz "from" ayı (YYYY-MM).');
      }
      from = fromRaw;
    }
    const rows = await this.finance.listAdvances(partner.tenantId, to);
    const mine = rows
      .filter((a) => a.partnerId === partner.id)
      .filter((a) => (from ? a.month >= from : true));

    const toplamNet = Math.round(mine.reduce((s, a) => s + a.netAmount, 0) * 100) / 100;
    const toplamBrut =
      Math.round(mine.reduce((s, a) => s + a.grossAmount, 0) * 100) / 100;

    return {
      olusturulma: this.nowIso(),
      adet: mine.length,
      toplamNet,
      toplamBrut,
      cekimler: mine.map((a) => ({
        ay: a.month,
        tarih: a.advanceDate,
        brut: a.grossAmount,
        net: a.netAmount,
        aciklama: a.description,
      })),
    };
  }
}

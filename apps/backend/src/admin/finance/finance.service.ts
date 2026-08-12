import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AdminProfitabilityService } from '../profitability/admin-profitability.service';
import { trStartOfMonth, trAddDays, trParts } from '../../common/utils/tr-time';
import type {
  CreateExpenseDto,
  CreateExpenseTemplateDto,
  CreateIntegrationEntryDto,
  CreatePartnerAdvanceDto,
  UpdateExpenseDto,
  UpdateExpenseTemplateDto,
  UpdateIntegrationEntryDto,
  UpdatePartnerAdvanceDto,
  UpdatePartnerDto,
} from './dto/finance.dto';

// ════════════════════════════════════════════════════════════════════════════
// Aylık Finans ve Ortak Dağılım Paneli servisi.
//
// "Toptan Budur" rakamları profitability motorundan OTOMATİK gelir; "Manuel
// Gelir/Gider" elle girilen satırlardan toplanır. Ortak masrafları mahsuplaşır
// ve (kâr − KDV farkı − havuz masrafı) dağıtılabilir bakiye olarak %pay +
// dengeleme ile iki ortağa bölünür. Her sayı, şeffaflık popup'ı için "trace"
// içinde formül + gerçek değer + kaynağıyla birlikte döner.
// ════════════════════════════════════════════════════════════════════════════

const TR_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;

const TR_MONTHS_SHORT = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
] as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Yer tutucu ortak kayıtları — gerçek ad/pay bilgisi Finans ekranından girilir.
const DEFAULT_PARTNERS = [
  { name: 'Ortak 1', initials: 'O1', colorHex: '#1D6FE0', sortOrder: 0 },
  { name: 'Ortak 2', initials: 'O2', colorHex: '#7C3AED', sortOrder: 1 },
] as const;

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v as number);
  if (Number.isFinite(n)) return n;
  const p = parseFloat(String(v));
  return Number.isFinite(p) ? p : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** "YYYY-MM" → ay başı + ay sonu (DAHİL son an) TR takvim sınırları. */
function monthBounds(month: string): { start: Date; endIncl: Date } {
  const [y, m] = month.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  const start = trStartOfMonth(anchor);
  const nextStart = trStartOfMonth(trAddDays(start, 32));
  return { start, endIncl: new Date(nextStart.getTime() - 1) };
}

/** "YYYY-MM" anahtarına delta ay ekler/çıkarır. */
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** [startMonth .. endMonth] arası tüm "YYYY-MM" anahtarları (dahil). */
function monthsBetween(startMonth: string, endMonth: string): string[] {
  if (startMonth > endMonth) return [];
  const out: string[] = [];
  let cur = startMonth;
  // Patolojik döngüye karşı üst sınır (~50 yıl).
  for (let i = 0; i < 600 && cur <= endMonth; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${TR_MONTHS[m - 1]} ${y}`;
}

function monthShortLabel(month: string): string {
  const [, m] = month.split('-').map(Number);
  return TR_MONTHS_SHORT[m - 1];
}

/** KDV-dahil tutardan içeri alınmış KDV payı = tutar × r/(100+r). */
function kdvPortion(amountInclVat: number, kdvRate: number): number {
  if (kdvRate <= 0) return 0;
  return amountInclVat * (kdvRate / (100 + kdvRate));
}

function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export interface FinanceKpi {
  gelen: number;
  giden: number;
  kar: number;
  kdvFarki: number;
}

export interface FinanceKpiBlock {
  current: FinanceKpi;
  previous: FinanceKpi;
  delta: {
    gelen: number | null;
    giden: number | null;
    kar: number | null;
    kdvFarki: number | null;
  };
}

@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly profitability: AdminProfitabilityService,
  ) {}

  private assertMonth(month: string): string {
    if (!MONTH_RE.test(month)) {
      throw new BadRequestException('Geçersiz ay (YYYY-MM bekleniyor).');
    }
    return month;
  }

  private monthOf(dateLike: string): string {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Geçersiz tarih.');
    }
    const { year, month } = trParts(d);
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  // ── Ortaklar ───────────────────────────────────────────────────────────────

  /** İlk kullanımda 2 ortağı tohumlar; her zaman sıralı listeyi döner. */
  async ensurePartners(tenantId: string) {
    const existing = await this.prisma.financePartner.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (existing.length > 0) return existing;
    await this.prisma.financePartner.createMany({
      data: DEFAULT_PARTNERS.map((p) => ({ ...p, tenantId })),
    });
    return this.prisma.financePartner.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listPartners(tenantId: string) {
    const partners = await this.ensurePartners(tenantId);
    return partners.map((p) => ({
      id: p.id,
      name: p.name,
      initials: p.initials,
      colorHex: p.colorHex,
      sharePercent: num(p.sharePercent),
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    }));
  }

  async updatePartner(
    tenantId: string,
    id: string,
    dto: UpdatePartnerDto,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financePartner.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Ortak bulunamadı.');
    const updated = await this.prisma.financePartner.update({
      where: { id },
      data: {
        name: dto.name,
        initials: dto.initials,
        colorHex: dto.colorHex,
        sharePercent: dto.sharePercent,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    await this.audit.record({
      action: 'finance.partner.update',
      summary: `Ortak güncellendi: ${updated.name}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinancePartner', label: updated.name },
      before: { sharePercent: num(existing.sharePercent) },
      after: { sharePercent: num(updated.sharePercent) },
    });
    return updated;
  }

  // ── Manuel gelir/gider satırları ─────────────────────────────────────────────

  async listIntegrationEntries(tenantId: string, month: string) {
    this.assertMonth(month);
    const rows = await this.prisma.financeIntegrationEntry.findMany({
      where: { tenantId, month },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.mapIntegrationRow(r));
  }

  private mapIntegrationRow(r: {
    id: string;
    month: string;
    entryDate: Date;
    type: string;
    description: string;
    amount: unknown;
    kdvRate: number;
    category: string | null;
  }) {
    return {
      id: r.id,
      month: r.month,
      entryDate: r.entryDate.toISOString(),
      type: r.type as 'INCOME' | 'EXPENSE',
      description: r.description,
      amount: num(r.amount),
      kdvRate: r.kdvRate,
      category: r.category,
    };
  }

  async createIntegrationEntry(
    tenantId: string,
    dto: CreateIntegrationEntryDto,
    actor: { id?: string; email?: string | null },
  ) {
    const month = this.monthOf(dto.entryDate);
    const created = await this.prisma.financeIntegrationEntry.create({
      data: {
        tenantId,
        month,
        entryDate: new Date(dto.entryDate),
        type: dto.type,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate ?? 20,
        category: dto.category ?? null,
        createdByUserId: actor.id ?? null,
      },
    });
    await this.audit.record({
      action: 'finance.integration.create',
      summary: `Manuel ${dto.type === 'INCOME' ? 'gelir' : 'gider'} kaydı eklendi: ${dto.description} (${dto.amount}₺)`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id: created.id, type: 'FinanceIntegrationEntry', label: month },
      after: { type: dto.type, amount: dto.amount },
    });
    return this.mapIntegrationRow(created);
  }

  async updateIntegrationEntry(
    tenantId: string,
    id: string,
    dto: UpdateIntegrationEntryDto,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeIntegrationEntry.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Kayıt bulunamadı.');
    const month = dto.entryDate ? this.monthOf(dto.entryDate) : existing.month;
    const updated = await this.prisma.financeIntegrationEntry.update({
      where: { id },
      data: {
        month,
        entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
        type: dto.type,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate,
        category: dto.category,
      },
    });
    await this.audit.record({
      action: 'finance.integration.update',
      summary: `Manuel kayıt güncellendi: ${updated.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceIntegrationEntry', label: month },
    });
    return this.mapIntegrationRow(updated);
  }

  async deleteIntegrationEntry(
    tenantId: string,
    id: string,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeIntegrationEntry.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Kayıt bulunamadı.');
    await this.prisma.financeIntegrationEntry.delete({ where: { id } });
    await this.audit.record({
      action: 'finance.integration.delete',
      summary: `Manuel kayıt silindi: ${existing.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceIntegrationEntry', label: existing.month },
    });
    return { ok: true };
  }

  // ── Sürekli gider tanımları (template) ───────────────────────────────────────

  async listTemplates(tenantId: string) {
    const rows = await this.prisma.financeExpenseTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((t) => ({
      id: t.id,
      category: t.category,
      description: t.description,
      amount: num(t.amount),
      kdvRate: t.kdvRate,
      paidByPartnerId: t.paidByPartnerId,
      isActive: t.isActive,
      startMonth: t.startMonth,
      endMonth: t.endMonth,
    }));
  }

  async createTemplate(
    tenantId: string,
    dto: CreateExpenseTemplateDto,
    actor: { id?: string; email?: string | null },
  ) {
    const created = await this.prisma.financeExpenseTemplate.create({
      data: {
        tenantId,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate ?? 20,
        paidByPartnerId: dto.paidByPartnerId ?? null,
        isActive: dto.isActive ?? true,
        startMonth: dto.startMonth,
        endMonth: dto.endMonth ?? null,
        createdByUserId: actor.id ?? null,
      },
    });
    await this.audit.record({
      action: 'finance.template.create',
      summary: `Sürekli gider tanımlandı: ${dto.description} (${dto.amount}₺/ay)`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id: created.id, type: 'FinanceExpenseTemplate', label: dto.category },
    });
    return created;
  }

  async updateTemplate(
    tenantId: string,
    id: string,
    dto: UpdateExpenseTemplateDto,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeExpenseTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Tanım bulunamadı.');
    const updated = await this.prisma.financeExpenseTemplate.update({
      where: { id },
      data: {
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate,
        paidByPartnerId: dto.paidByPartnerId,
        isActive: dto.isActive,
        startMonth: dto.startMonth,
        endMonth: dto.endMonth,
      },
    });
    await this.audit.record({
      action: 'finance.template.update',
      summary: `Sürekli gider güncellendi: ${updated.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceExpenseTemplate', label: updated.category },
    });
    return updated;
  }

  async deleteTemplate(
    tenantId: string,
    id: string,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeExpenseTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Tanım bulunamadı.');
    // Materyalize edilmiş aylık satırlar templateId=null'a düşer (onDelete:
    // SetNull) → geçmiş aylardaki kayıtlar korunur, sadece otomatik tekrar durur.
    await this.prisma.financeExpenseTemplate.delete({ where: { id } });
    await this.audit.record({
      action: 'finance.template.delete',
      summary: `Sürekli gider tanımı silindi: ${existing.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceExpenseTemplate', label: existing.category },
    });
    return { ok: true };
  }

  // ── Aya düşen gider satırları ────────────────────────────────────────────────

  /** Bu ayı kapsayan aktif template'leri o aya materyalize eder (idempotent). */
  private async materializeRecurring(tenantId: string, month: string) {
    const templates = await this.prisma.financeExpenseTemplate.findMany({
      where: {
        tenantId,
        isActive: true,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
      },
    });
    if (templates.length === 0) return;
    await this.prisma.financeExpense.createMany({
      data: templates.map((t) => ({
        tenantId,
        month,
        kind: 'RECURRING' as const,
        templateId: t.id,
        category: t.category,
        description: t.description,
        amount: t.amount,
        kdvRate: t.kdvRate,
        status: 'PAID' as const,
        paidByPartnerId: t.paidByPartnerId,
        enabled: true,
      })),
      // @@unique([tenantId, month, templateId]) → zaten varsa atla (kullanıcı
      // o ayda yaptığı düzenlemeyi KORUR; tutar/durum geri ezilmez).
      skipDuplicates: true,
    });
  }

  /**
   * Sürekli giderleri her template'in başlangıcından `throughMonth`'a kadar TÜM
   * aylara tek `createMany` ile materyalize eder (idempotent). Kümülatif bakiye
   * hesabı, hiç açılmamış geçmiş ayların sürekli giderlerini de saysın diye
   * gerekli; `materializeRecurring`'in çok-aylık üst kümesidir.
   */
  private async materializeRecurringThrough(tenantId: string, throughMonth: string) {
    const templates = await this.prisma.financeExpenseTemplate.findMany({
      where: { tenantId, isActive: true, startMonth: { lte: throughMonth } },
    });
    if (templates.length === 0) return;
    const data = templates.flatMap((t) => {
      const end =
        t.endMonth && t.endMonth < throughMonth ? t.endMonth : throughMonth;
      return monthsBetween(t.startMonth, end).map((m) => ({
        tenantId,
        month: m,
        kind: 'RECURRING' as const,
        templateId: t.id,
        category: t.category,
        description: t.description,
        amount: t.amount,
        kdvRate: t.kdvRate,
        status: 'PAID' as const,
        paidByPartnerId: t.paidByPartnerId,
        enabled: true,
      }));
    });
    if (data.length > 0) {
      await this.prisma.financeExpense.createMany({ data, skipDuplicates: true });
    }
  }

  async createExpense(
    tenantId: string,
    dto: CreateExpenseDto,
    actor: { id?: string; email?: string | null },
  ) {
    this.assertMonth(dto.month);
    const created = await this.prisma.financeExpense.create({
      data: {
        tenantId,
        month: dto.month,
        kind: 'ONE_TIME',
        templateId: null,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate ?? 20,
        status: dto.status ?? 'PAID',
        paidByPartnerId: dto.paidByPartnerId ?? null,
        enabled: true,
        note: dto.note ?? null,
        createdByUserId: actor.id ?? null,
      },
    });
    await this.audit.record({
      action: 'finance.expense.create',
      summary: `Tek seferlik gider eklendi: ${dto.description} (${dto.amount}₺)`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id: created.id, type: 'FinanceExpense', label: dto.month },
    });
    return created;
  }

  async updateExpense(
    tenantId: string,
    id: string,
    dto: UpdateExpenseDto,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeExpense.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Gider bulunamadı.');
    const updated = await this.prisma.financeExpense.update({
      where: { id },
      data: {
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        kdvRate: dto.kdvRate,
        status: dto.status,
        paidByPartnerId: dto.paidByPartnerId,
        enabled: dto.enabled,
        note: dto.note,
      },
    });
    await this.audit.record({
      action: 'finance.expense.update',
      summary: `Gider güncellendi: ${updated.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceExpense', label: updated.month },
    });
    return updated;
  }

  async deleteExpense(
    tenantId: string,
    id: string,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financeExpense.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Gider bulunamadı.');
    await this.prisma.financeExpense.delete({ where: { id } });
    await this.audit.record({
      action: 'finance.expense.delete',
      summary: `Gider silindi: ${existing.description}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinanceExpense', label: existing.month },
    });
    return { ok: true };
  }

  // ── Kâr Avansı (ortak cari çekimi) ───────────────────────────────────────────

  private mapAdvance(r: {
    id: string;
    partnerId: string;
    month: string;
    advanceDate: Date;
    grossAmount: unknown;
    netAmount: unknown;
    description: string | null;
    partner?: { name: string } | null;
  }) {
    return {
      id: r.id,
      partnerId: r.partnerId,
      partnerName: r.partner?.name ?? null,
      month: r.month,
      advanceDate: r.advanceDate.toISOString(),
      grossAmount: num(r.grossAmount),
      netAmount: num(r.netAmount),
      description: r.description ?? null,
    };
  }

  /** Seçili aya kadarki (month ≤ verilen) tüm kâr avansları, yeniden eskiye. */
  async listAdvances(tenantId: string, month?: string) {
    const where: { tenantId: string; month?: { lte: string } } = { tenantId };
    if (month) {
      this.assertMonth(month);
      where.month = { lte: month };
    }
    const rows = await this.prisma.financePartnerAdvance.findMany({
      where,
      orderBy: [{ advanceDate: 'desc' }, { createdAt: 'desc' }],
      include: { partner: { select: { name: true } } },
    });
    return rows.map((r) => this.mapAdvance(r));
  }

  async createAdvance(
    tenantId: string,
    dto: CreatePartnerAdvanceDto,
    actor: { id?: string; email?: string | null },
  ) {
    const partner = await this.prisma.financePartner.findFirst({
      where: { id: dto.partnerId, tenantId },
    });
    if (!partner) throw new NotFoundException('Ortak bulunamadı.');
    const month = this.monthOf(dto.advanceDate);
    const created = await this.prisma.financePartnerAdvance.create({
      data: {
        tenantId,
        partnerId: dto.partnerId,
        advanceDate: new Date(dto.advanceDate),
        month,
        grossAmount: dto.grossAmount,
        netAmount: dto.netAmount,
        description: dto.description ?? null,
        createdByUserId: actor.id ?? null,
      },
      include: { partner: { select: { name: true } } },
    });
    await this.audit.record({
      action: 'finance.advance.create',
      summary: `Kâr Avansı: ${partner.name} — ${dto.grossAmount}₺ (net ${dto.netAmount}₺)`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id: created.id, type: 'FinancePartnerAdvance', label: month },
      after: { grossAmount: dto.grossAmount, netAmount: dto.netAmount },
    });
    return this.mapAdvance(created);
  }

  async updateAdvance(
    tenantId: string,
    id: string,
    dto: UpdatePartnerAdvanceDto,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financePartnerAdvance.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Kayıt bulunamadı.');
    if (dto.partnerId) {
      const partner = await this.prisma.financePartner.findFirst({
        where: { id: dto.partnerId, tenantId },
      });
      if (!partner) throw new NotFoundException('Ortak bulunamadı.');
    }
    const month = dto.advanceDate ? this.monthOf(dto.advanceDate) : existing.month;
    const updated = await this.prisma.financePartnerAdvance.update({
      where: { id },
      data: {
        partnerId: dto.partnerId,
        advanceDate: dto.advanceDate ? new Date(dto.advanceDate) : undefined,
        month,
        grossAmount: dto.grossAmount,
        netAmount: dto.netAmount,
        description: dto.description,
      },
      include: { partner: { select: { name: true } } },
    });
    await this.audit.record({
      action: 'finance.advance.update',
      summary: `Kâr Avansı güncellendi: ${updated.partner?.name ?? ''}`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinancePartnerAdvance', label: month },
    });
    return this.mapAdvance(updated);
  }

  async deleteAdvance(
    tenantId: string,
    id: string,
    actor: { id?: string; email?: string | null },
  ) {
    const existing = await this.prisma.financePartnerAdvance.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Kayıt bulunamadı.');
    await this.prisma.financePartnerAdvance.delete({ where: { id } });
    await this.audit.record({
      action: 'finance.advance.delete',
      summary: `Kâr Avansı silindi (${existing.month}, ${num(existing.grossAmount)}₺)`,
      actor: { type: 'admin', id: actor.id, email: actor.email, tenantId },
      target: { id, type: 'FinancePartnerAdvance', label: existing.month },
    });
    return { ok: true };
  }

  // ── Aylık panel (ana hesap) ──────────────────────────────────────────────────

  /** Bir ay için Toptan Budur figürlerini (otomatik) hesaplar. */
  private async bayiKpiForMonth(
    tenantId: string,
    month: string,
    includeCardSpread = false,
  ): Promise<FinanceKpi & { cardSpread: number }> {
    const { start, endIncl } = monthBounds(month);
    const t = await this.profitability.getRangeTotals(
      tenantId,
      start,
      endIncl,
      includeCardSpread,
    );
    return {
      gelen: round2(t.revenue),
      giden: round2(t.cost),
      kar: round2(t.revenue - t.cost),
      kdvFarki: round2(t.netKdv),
      cardSpread: round2(t.cardCommissionSpread),
    };
  }

  /** Bir ayın manuel gelir/gider satırlarından figür hesaplar. */
  private integrationKpi(
    entries: Array<{ type: string; amount: unknown; kdvRate: number }>,
  ): FinanceKpi & { incomeCount: number; expenseCount: number } {
    let gelen = 0;
    let giden = 0;
    let collectedKdv = 0;
    let paidKdv = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const e of entries) {
      const amt = num(e.amount);
      const portion = kdvPortion(amt, e.kdvRate);
      if (e.type === 'INCOME') {
        gelen += amt;
        collectedKdv += portion;
        incomeCount += 1;
      } else {
        giden += amt;
        paidKdv += portion;
        expenseCount += 1;
      }
    }
    return {
      gelen: round2(gelen),
      giden: round2(giden),
      kar: round2(gelen - giden),
      kdvFarki: round2(collectedKdv - paidKdv),
      incomeCount,
      expenseCount,
    };
  }

  private kpiBlock(current: FinanceKpi, previous: FinanceKpi): FinanceKpiBlock {
    return {
      current,
      previous,
      delta: {
        gelen: deltaPct(current.gelen, previous.gelen),
        giden: deltaPct(current.giden, previous.giden),
        kar: deltaPct(current.kar, previous.kar),
        kdvFarki: deltaPct(current.kdvFarki, previous.kdvFarki),
      },
    };
  }

  /**
   * Aylık panelin tüm verisi (KPI'lar, masraflar, dağılım, trend, son işlemler)
   * + şeffaflık "trace". Excel/PDF export aynı çekirdeği kullanır.
   */
  async getMonthlyPanel(tenantId: string, monthRaw: string, trendMonths = 12) {
    const month = this.assertMonth(monthRaw);
    const prevMonth = addMonths(month, -1);

    // Kümülatif bakiye geçmiş ayların sürekli giderlerini de saysın diye
    // seçili aya kadar TÜM ayları materyalize et (idempotent, tek yazım).
    await this.materializeRecurringThrough(tenantId, month);

    const monthWin = monthBounds(month);
    const [
      partnersRaw,
      monthEntries,
      prevEntries,
      expenseRows,
      bayiCur,
      bayiPrev,
      promoMonthAgg,
    ] = await Promise.all([
      this.ensurePartners(tenantId),
      this.prisma.financeIntegrationEntry.findMany({ where: { tenantId, month } }),
      this.prisma.financeIntegrationEntry.findMany({
        where: { tenantId, month: prevMonth },
      }),
      this.prisma.financeExpense.findMany({
        where: { tenantId, month },
        include: { paidByPartner: { select: { id: true, name: true } } },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      }),
      this.bayiKpiForMonth(tenantId, month, true), // cur: kart spread'i lazım
      this.bayiKpiForMonth(tenantId, prevMonth), // prev: yalnız delta% için
      // Bu ayın promo/hediye bakiye tüketimi (KDV-dahil) — ortak gideri.
      // İç hesaplar (promoExpenseExempt) gider sayılmaz.
      this.prisma.order.aggregate({
        where: {
          tenantId,
          status: { in: ['paid', 'preparing', 'shipped'] },
          createdAt: { gte: monthWin.start, lte: monthWin.endIncl },
          promoBalanceApplied: { gt: 0 },
          customer: { isNot: { promoExpenseExempt: true } },
        },
        _sum: { promoBalanceApplied: true },
      }),
    ]);

    const entCur = this.integrationKpi(monthEntries);
    const entPrev = this.integrationKpi(prevEntries);

    const bayi = this.kpiBlock(bayiCur, bayiPrev);
    const entegrasyon = this.kpiBlock(
      { gelen: entCur.gelen, giden: entCur.giden, kar: entCur.kar, kdvFarki: entCur.kdvFarki },
      { gelen: entPrev.gelen, giden: entPrev.giden, kar: entPrev.kar, kdvFarki: entPrev.kdvFarki },
    );

    const toplam: FinanceKpi = {
      gelen: round2(bayiCur.gelen + entCur.gelen),
      giden: round2(bayiCur.giden + entCur.giden),
      kar: round2(bayiCur.kar + entCur.kar),
      kdvFarki: round2(bayiCur.kdvFarki + entCur.kdvFarki),
    };

    // ── Masraflar ──────────────────────────────────────────────────────────────
    const expenses = expenseRows.map((e) => ({
      id: e.id,
      kind: e.kind as 'RECURRING' | 'ONE_TIME',
      templateId: e.templateId,
      category: e.category,
      description: e.description,
      amount: num(e.amount),
      kdvRate: e.kdvRate,
      status: e.status as 'PAID' | 'UNPAID',
      paidByPartnerId: e.paidByPartnerId,
      paidByPartnerName: e.paidByPartner?.name ?? null,
      enabled: e.enabled,
      note: e.note,
    }));
    const recurring = expenses.filter((e) => e.kind === 'RECURRING');
    const oneTime = expenses.filter((e) => e.kind === 'ONE_TIME');
    const expenseTotal = round2(
      expenses.filter((e) => e.enabled).reduce((s, e) => s + e.amount, 0),
    );
    const paidExpenses = expenses.filter((e) => e.enabled && e.status === 'PAID');
    const expensePaidTotal = round2(paidExpenses.reduce((s, e) => s + e.amount, 0));

    // ── Ortak dağılımı (50/50 + masraf ödeyene iade) ────────────────────────────
    const paidByPartner = new Map<string, { total: number; count: number }>();
    let ePool = 0; // ödeyeni atanmamış (havuz) masraflar → bakiyeyi düşürür
    let eAssigned = 0; // ortağa atanmış masraflar → dengeleme ile mahsuplaşır
    for (const e of paidExpenses) {
      if (e.paidByPartnerId) {
        const acc = paidByPartner.get(e.paidByPartnerId) ?? { total: 0, count: 0 };
        acc.total += e.amount;
        acc.count += 1;
        paidByPartner.set(e.paidByPartnerId, acc);
        eAssigned += e.amount;
      } else {
        ePool += e.amount;
      }
    }

    // Kart komisyon farkı (+, kâr) ve hoşgeldin promo gideri (−) dağıtılabilir
    // bakiyeye girer → önerilen ödemeye birebir yansır.
    const cardSpreadMonth = round2(bayiCur.cardSpread);
    const promoMonth = round2(num(promoMonthAgg._sum.promoBalanceApplied));
    const dagitilabilirBakiye = round2(
      toplam.kar - toplam.kdvFarki - ePool - promoMonth + cardSpreadMonth,
    );

    const partners = partnersRaw.map((p) => {
      const sharePercent = num(p.sharePercent);
      const paid = round2(paidByPartner.get(p.id)?.total ?? 0);
      const count = paidByPartner.get(p.id)?.count ?? 0;
      const share = round2(dagitilabilirBakiye * (sharePercent / 100));
      const burden = eAssigned * (sharePercent / 100);
      const dengeleme = round2(paid - burden);
      const onerilen = round2(share + dengeleme);
      return {
        id: p.id,
        name: p.name,
        initials: p.initials,
        colorHex: p.colorHex,
        sharePercent,
        paidTotal: paid,
        expenseCount: count,
        share,
        dengeleme,
        onerilen,
      };
    });

    // Ortaklar-arası dengeleme: alacaklı (dengeleme>0) ile borçlu (<0) eşleşir.
    let settlement: {
      fromPartnerId: string;
      fromName: string;
      toPartnerId: string;
      toName: string;
      amount: number;
    } | null = null;
    if (partners.length >= 2) {
      const sorted = [...partners].sort((a, b) => b.dengeleme - a.dengeleme);
      const creditor = sorted[0];
      const debtor = sorted[sorted.length - 1];
      const amount = round2(Math.min(creditor.dengeleme, -debtor.dengeleme));
      if (amount > 0.005) {
        settlement = {
          fromPartnerId: debtor.id,
          fromName: debtor.name,
          toPartnerId: creditor.id,
          toName: creditor.name,
          amount,
        };
      }
    }

    // ── Aylık nakit akışı trendi + kümülatif ortak bakiyeleri ───────────────────
    const [trend, capital] = await Promise.all([
      this.buildTrend(tenantId, month, trendMonths),
      this.buildCapital(tenantId, month, partnersRaw),
    ]);

    // ── Son işlemler (manuel kayıt + masraf birleşik) ───────────────────────────
    const recentTransactions = this.buildRecentTransactions(
      monthEntries.map((e) => this.mapIntegrationRow(e)),
      expenses,
    );

    // ── Şeffaflık trace ──────────────────────────────────────────────────────────
    const trace = this.buildTrace({
      month,
      bayiCur,
      entCur,
      toplam,
      expenses,
      expenseTotal,
      expensePaidTotal,
      ePool,
      eAssigned,
      cardSpreadMonth,
      promoMonth,
      dagitilabilirBakiye,
      partners,
      settlement,
      capital,
    });

    return {
      month,
      monthLabel: monthLabel(month),
      prevMonth,
      prevMonthLabel: monthLabel(prevMonth),
      bayi,
      entegrasyon,
      toplam,
      expenses: {
        recurring,
        oneTime,
        total: expenseTotal,
        paidTotal: expensePaidTotal,
      },
      distribution: {
        toplamGelen: toplam.gelen,
        toplamGiden: toplam.giden,
        toplamKar: toplam.kar,
        toplamKdvFarki: toplam.kdvFarki,
        havuzMasraf: round2(ePool),
        cardSpread: cardSpreadMonth,
        promo: promoMonth,
        dagitilabilirBakiye,
        partners,
        settlement,
      },
      capital,
      partners,
      trend,
      recentTransactions,
      trace,
    };
  }

  /**
   * Ortak Bakiyeleri + Döner Sermaye — sistem başından SEÇİLİ AYIN SONUNA kadar
   * KÜMÜLATİF. TEK bakiye (Net). Ortakların bakiye toplamı = Döner Sermaye (Net).
   *
   *   Net Dağıtılabilir = Biriken Kâr − Biriken KDV Farkı − Havuz Masraf − Promo + Kart Farkı
   *   Ortak payı = Dağıtılabilir × %pay + dengeleme (masraf ödeyene iade)
   *   Bakiye     = pay − Σ (o ortağın çektiği Kâr Avansı)   [eksi = payından fazla çekmiş]
   */
  private async buildCapital(
    tenantId: string,
    month: string,
    partnersRaw: Array<{
      id: string;
      name: string;
      initials: string | null;
      colorHex: string | null;
      sharePercent: unknown;
    }>,
  ) {
    const { endIncl } = monthBounds(month);
    // Kârlılık motoru tüm geçmiş siparişleri bilir; ay sonuna kadarki her şeyi
    // tek geniş aralık sorgusuyla topla (toplamlar zaten additive).
    const EPOCH = new Date(Date.UTC(2000, 0, 1));

    const [bayiCum, entRows, expRows, advRows, promoAgg] = await Promise.all([
      this.profitability.getRangeTotals(tenantId, EPOCH, endIncl, true),
      this.prisma.financeIntegrationEntry.findMany({
        where: { tenantId, month: { lte: month } },
        select: { type: true, amount: true, kdvRate: true },
      }),
      this.prisma.financeExpense.findMany({
        where: { tenantId, month: { lte: month }, enabled: true, status: 'PAID' },
        select: { amount: true, paidByPartnerId: true },
      }),
      this.prisma.financePartnerAdvance.findMany({
        where: { tenantId, month: { lte: month } },
        orderBy: [{ advanceDate: 'desc' }, { createdAt: 'desc' }],
        include: { partner: { select: { name: true } } },
      }),
      // Promo/hediye bakiye tüketimi (KDV-dahil) — geliri sayılan siparişlerle
      // aynı statü/tarih tabanı. Ortak GİDERİ olarak dağıtılabilir bakiyeden
      // düşülür. İç hesaplar (promoExpenseExempt) gider sayılmaz.
      this.prisma.order.aggregate({
        where: {
          tenantId,
          status: { in: ['paid', 'preparing', 'shipped'] },
          createdAt: { lte: endIncl },
          promoBalanceApplied: { gt: 0 },
          customer: { isNot: { promoExpenseExempt: true } },
        },
        _sum: { promoBalanceApplied: true },
      }),
    ]);

    const entCum = this.integrationKpi(entRows);
    const karCum = round2(bayiCum.revenue - bayiCum.cost + entCum.kar);
    const kdvFarkiCum = round2(bayiCum.netKdv + entCum.kdvFarki);
    // Kart komisyon farkı (spread) = platform kârı (+); promo harcaması = ortak gideri (−).
    const cardSpreadCum = round2(num(bayiCum.cardCommissionSpread));
    const promoCum = round2(num(promoAgg._sum.promoBalanceApplied));

    // Masraflar: ortağa atanmış (dengeleme) vs havuz (bakiyeyi düşürür).
    const paidByPartner = new Map<string, number>();
    let poolCum = 0;
    let assignedCum = 0;
    for (const e of expRows) {
      const amt = num(e.amount);
      if (e.paidByPartnerId) {
        paidByPartner.set(
          e.paidByPartnerId,
          (paidByPartner.get(e.paidByPartnerId) ?? 0) + amt,
        );
        assignedCum += amt;
      } else {
        poolCum += amt;
      }
    }

    const netDistCum = round2(
      karCum - kdvFarkiCum - poolCum - promoCum + cardSpreadCum,
    );

    // Kâr Avansı = çekilen NET tutar; ortağa göre topla (tek bakiye modeli).
    const advBy = new Map<string, number>();
    for (const a of advRows) {
      advBy.set(a.partnerId, (advBy.get(a.partnerId) ?? 0) + num(a.netAmount));
    }

    const partners = partnersRaw.map((p) => {
      const s = num(p.sharePercent) / 100;
      const dengeleme = round2((paidByPartner.get(p.id) ?? 0) - assignedCum * s);
      const netCredit = round2(netDistCum * s + dengeleme);
      const advTotal = round2(advBy.get(p.id) ?? 0);
      return {
        id: p.id,
        name: p.name,
        initials: p.initials,
        colorHex: p.colorHex,
        sharePercent: num(p.sharePercent),
        netCredit,
        advTotal,
        netBalance: round2(netCredit - advTotal),
      };
    });

    // Döner Sermaye (Net) = dağıtılabilir taban − avanslar (kesin, kuruş-tutarlı).
    // Σ dengeleme algebraik olarak 0; round2 negatifte asimetrik olduğundan
    // ortak-başı yuvarlama artığı son ortağa yüklenip kartların toplamı = döner sermaye.
    const advTotalAll = round2(partners.reduce((s, p) => s + p.advTotal, 0));
    const netTotal = round2(netDistCum - advTotalAll);
    if (partners.length > 0) {
      const sumNet = round2(partners.reduce((s, p) => s + p.netBalance, 0));
      const last = partners[partners.length - 1];
      last.netBalance = round2(last.netBalance + (netTotal - sumNet));
    }

    return {
      monthLabel: monthLabel(month),
      karCum,
      kdvFarkiCum,
      poolCum: round2(poolCum),
      promoCum,
      cardSpreadCum,
      netDistCum,
      partners,
      netTotal,
      advances: advRows.map((a) => this.mapAdvance(a)),
    };
  }

  private async buildTrend(tenantId: string, month: string, count: number) {
    const months: string[] = [];
    for (let k = count - 1; k >= 0; k--) months.push(addMonths(month, -k));

    const allEntries = await this.prisma.financeIntegrationEntry.findMany({
      where: { tenantId, month: { in: months } },
      select: { month: true, type: true, amount: true, kdvRate: true },
    });
    const entriesByMonth = new Map<string, typeof allEntries>();
    for (const e of allEntries) {
      const arr = entriesByMonth.get(e.month) ?? [];
      arr.push(e);
      entriesByMonth.set(e.month, arr);
    }

    const bayiTotals = await Promise.all(
      months.map((m) => {
        const { start, endIncl } = monthBounds(m);
        return this.profitability.getRangeTotals(tenantId, start, endIncl);
      }),
    );

    return months.map((m, i) => {
      const b = bayiTotals[i];
      const ent = this.integrationKpi(entriesByMonth.get(m) ?? []);
      const gelen = round2(b.revenue + ent.gelen);
      const giden = round2(b.cost + ent.giden);
      return {
        month: m,
        label: monthShortLabel(m),
        gelen,
        giden,
        kar: round2(gelen - giden),
      };
    });
  }

  private buildRecentTransactions(
    entries: Array<{
      entryDate: string;
      type: 'INCOME' | 'EXPENSE';
      description: string;
      category: string | null;
      amount: number;
    }>,
    expenses: Array<{
      description: string;
      category: string;
      amount: number;
      paidByPartnerName: string | null;
    }>,
  ) {
    const fromEntries = entries.map((e) => ({
      date: e.entryDate,
      company: 'Manuel Kayıt' as const,
      description: e.description,
      category: e.category,
      paidByName: null as string | null,
      amount: e.amount,
      sign: (e.type === 'INCOME' ? 'positive' : 'negative') as 'positive' | 'negative',
    }));
    const fromExpenses = expenses.map((e) => ({
      date: null as string | null,
      company: 'Toptan Budur' as const,
      description: e.description,
      category: e.category,
      paidByName: e.paidByPartnerName,
      amount: e.amount,
      sign: 'negative' as const,
    }));
    return [...fromEntries, ...fromExpenses]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 12);
  }

  // ── Şeffaflık trace üretimi (gerçek değerlerle adım adım) ────────────────────
  private buildTrace(p: {
    month: string;
    bayiCur: FinanceKpi;
    entCur: FinanceKpi & { incomeCount: number; expenseCount: number };
    toplam: FinanceKpi;
    expenses: Array<{
      description: string;
      amount: number;
      status: 'PAID' | 'UNPAID';
      paidByPartnerName: string | null;
      enabled: boolean;
    }>;
    expenseTotal: number;
    expensePaidTotal: number;
    ePool: number;
    eAssigned: number;
    cardSpreadMonth: number;
    promoMonth: number;
    dagitilabilirBakiye: number;
    partners: Array<{
      name: string;
      sharePercent: number;
      paidTotal: number;
      share: number;
      dengeleme: number;
      onerilen: number;
    }>;
    settlement: { fromName: string; toName: string; amount: number } | null;
    capital: {
      monthLabel: string;
      karCum: number;
      kdvFarkiCum: number;
      poolCum: number;
      promoCum: number;
      cardSpreadCum: number;
      netDistCum: number;
      netTotal: number;
      partners: Array<{
        name: string;
        sharePercent: number;
        netCredit: number;
        advTotal: number;
        netBalance: number;
      }>;
    };
  }) {
    const f = (n: number) =>
      new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    const sections: Array<{
      key: string;
      title: string;
      description?: string;
      steps: Array<{
        label: string;
        formula: string;
        inputs?: Array<{ label: string; value: string }>;
        result: number;
        source: string;
        note?: string;
      }>;
    }> = [];

    sections.push({
      key: 'bayi',
      title: 'Toptan Budur (Otomatik)',
      description:
        'Tüm platform siparişlerinden (tüm satış kanalları) kârlılık motoru hesaplar. Statü kümesi: paid/preparing/shipped — iptal/iade hariç.',
      steps: [
        {
          label: 'Gelen Tutar',
          formula: 'Σ sipariş cirosu (Order.total, KDV dahil)',
          result: p.bayiCur.gelen,
          source: 'profitability.getRangeTotals() → revenue',
        },
        {
          label: 'Giden Tutar',
          formula: 'Σ mal maliyeti = alış × (1 + alış KDV) × adet',
          result: p.bayiCur.giden,
          source: 'profitability.getRangeTotals() → cost (Supplier.purchaseVatRate)',
        },
        {
          label: 'Kâr',
          formula: 'Gelen − Giden',
          inputs: [
            { label: 'Gelen', value: f(p.bayiCur.gelen) },
            { label: 'Giden', value: f(p.bayiCur.giden) },
          ],
          result: p.bayiCur.kar,
          source: 'revenue − cost',
        },
        {
          label: 'KDV Farkı',
          formula: 'Tahsil edilen satış KDV − ödenen alış KDV',
          result: p.bayiCur.kdvFarki,
          source: 'profitability.getRangeTotals() → netKdv',
          note: 'Devlete ödenecek tutar; dağıtılabilir bakiyeden düşülür.',
        },
      ],
    });

    sections.push({
      key: 'entegrasyon',
      title: 'Manuel Gelir/Gider (Elle)',
      description: `Bu ay girilen ${p.entCur.incomeCount} gelir + ${p.entCur.expenseCount} gider satırından toplanır. Tutarlar KDV-dahil; KDV payı = tutar × oran/(100+oran).`,
      steps: [
        {
          label: 'Gelen Tutar',
          formula: 'Σ (Tür = Gelir) tutarları',
          result: p.entCur.gelen,
          source: `${p.entCur.incomeCount} gelir satırı`,
        },
        {
          label: 'Giden Tutar',
          formula: 'Σ (Tür = Gider) tutarları',
          result: p.entCur.giden,
          source: `${p.entCur.expenseCount} gider satırı`,
        },
        {
          label: 'Kâr',
          formula: 'Gelen − Giden',
          inputs: [
            { label: 'Gelen', value: f(p.entCur.gelen) },
            { label: 'Giden', value: f(p.entCur.giden) },
          ],
          result: p.entCur.kar,
          source: 'elle girilen satırlar',
        },
        {
          label: 'KDV Farkı',
          formula: 'Σ gelir KDV payı − Σ gider KDV payı',
          result: p.entCur.kdvFarki,
          source: 'her satır: tutar × oran/(100+oran)',
        },
      ],
    });

    sections.push({
      key: 'toplam',
      title: 'Toplam Finans Özeti',
      description: 'Her kalem = Toptan Budur + Manuel Gelir/Gider.',
      steps: (['gelen', 'giden', 'kar', 'kdvFarki'] as const).map((key) => ({
        label:
          key === 'gelen'
            ? 'Toplam Gelen'
            : key === 'giden'
              ? 'Toplam Giden'
              : key === 'kar'
                ? 'Toplam Kâr'
                : 'Toplam KDV Farkı',
        formula: 'Toptan Budur + Manuel Gelir/Gider',
        inputs: [
          { label: 'Toptan Budur', value: f(p.bayiCur[key]) },
          { label: 'Manuel Gelir/Gider', value: f(p.entCur[key]) },
        ],
        result: p.toplam[key],
        source: 'iki kolun toplamı',
      })),
    });

    sections.push({
      key: 'masraf',
      title: 'Masraflar ve Harcamalar',
      description:
        'Ortakların ödediği işletme giderleri. Yalnız "Ödendi" satırlar dağıtıma girer.',
      steps: [
        {
          label: 'Toplam Masraf (aktif)',
          formula: 'Σ aktif gider satırları',
          result: p.expenseTotal,
          source: `${p.expenses.filter((e) => e.enabled).length} satır`,
        },
        {
          label: 'Ödenen Masraf',
          formula: 'Σ Durum = Ödendi satırları',
          result: p.expensePaidTotal,
          source: 'cari mahsuplaşmaya yalnız ödenenler girer',
        },
        {
          label: 'Havuz (ortağa atanmamış) masraf',
          formula: 'Σ ödeyeni boş ödenen masraflar',
          result: round2(p.ePool),
          source: 'dağıtılabilir bakiyeden DÜŞÜLÜR',
        },
        {
          label: 'Ortağa atanmış masraf',
          formula: 'Σ ödeyeni belli ödenen masraflar',
          result: round2(p.eAssigned),
          source: 'dengeleme ile ortaklar arasında eşitlenir',
        },
      ],
    });

    sections.push({
      key: 'dagitilabilir',
      title: 'Dağıtılabilir Bakiye',
      steps: [
        {
          label: 'Dağıtılabilir Bakiye',
          formula:
            'Toplam Kâr − KDV Farkı − Havuz Masraf − Promo/Hediye Bakiye + Kart Komisyon Farkı',
          inputs: [
            { label: 'Toplam Kâr', value: f(p.toplam.kar) },
            { label: 'Toplam KDV Farkı', value: f(p.toplam.kdvFarki) },
            { label: 'Havuz Masraf', value: f(round2(p.ePool)) },
            { label: 'Promo/Hediye Bakiye', value: f(p.promoMonth) },
            { label: 'Kart Komisyon Farkı', value: f(p.cardSpreadMonth) },
          ],
          result: p.dagitilabilirBakiye,
          source: 'ortaklara bölünecek net tutar',
        },
      ],
    });

    sections.push({
      key: 'dagitim',
      title: 'Ortak Dağılımı (50/50 + masraf ödeyene iade)',
      description:
        'Pay = Dağıtılabilir Bakiye × ortak yüzdesi. Dengeleme = ortağın ödediği masraf − (atanmış masraf × ortak yüzdesi). Önerilen ödeme = Pay + Dengeleme.',
      steps: p.partners.flatMap((pt) => [
        {
          label: `${pt.name} — Pay (%${pt.sharePercent})`,
          formula: 'Dağıtılabilir Bakiye × %pay',
          inputs: [
            { label: 'Dağıtılabilir', value: f(p.dagitilabilirBakiye) },
            { label: '%pay', value: `%${pt.sharePercent}` },
          ],
          result: pt.share,
          source: 'eşit kâr payı',
        },
        {
          label: `${pt.name} — Dengeleme`,
          formula: 'Ödediği masraf − (atanmış masraf × %pay)',
          inputs: [
            { label: 'Ödediği', value: f(pt.paidTotal) },
            { label: 'Atanmış masraf', value: f(round2(p.eAssigned)) },
            { label: '%pay', value: `%${pt.sharePercent}` },
          ],
          result: pt.dengeleme,
          source: pt.dengeleme >= 0 ? 'alacaklı (+)' : 'borçlu (−)',
        },
        {
          label: `${pt.name} — Önerilen Ödeme`,
          formula: 'Pay + Dengeleme',
          inputs: [
            { label: 'Pay', value: f(pt.share) },
            { label: 'Dengeleme', value: f(pt.dengeleme) },
          ],
          result: pt.onerilen,
          source: 'ortağa ödenecek nihai tutar',
        },
      ]),
    });

    if (p.settlement) {
      sections.push({
        key: 'settlement',
        title: 'Ortaklar Arası Dengeleme',
        steps: [
          {
            label: `${p.settlement.fromName} → ${p.settlement.toName}`,
            formula: 'Borçlu ortak, alacaklı ortağa öder',
            result: p.settlement.amount,
            source: 'masraf mahsuplaşması nakit transferi',
          },
        ],
      });
    }

    const cap = p.capital;
    sections.push({
      key: 'capital',
      title: `Ortak Bakiyeleri ve Döner Sermaye — ${cap.monthLabel} sonu (kümülatif)`,
      description:
        'Sistem başından seçili ayın sonuna kadar biriken NET kâr payı eksi çekilen Kâr Avansları. Tek bakiye (KDV sonrası gerçek). Avans = çekilen tutar, direkt net bakiyeden düşer.',
      steps: [
        {
          label: 'Biriken Kâr (kümülatif)',
          formula: 'Σ tüm aylar: (KDV-dahil ciro − maliyet) + manuel kayıt kârı',
          result: cap.karCum,
          source: 'kârlılık motoru + manuel kayıtlar (tüm geçmiş, ay sonuna kadar)',
        },
        {
          label: 'Biriken KDV Farkı (kümülatif)',
          formula: 'Σ net KDV (tüm aylar)',
          result: cap.kdvFarkiCum,
          source: 'devlete ayrılan; net bakiyeden düşülür',
        },
        {
          label: 'Havuz Masraf (kümülatif)',
          formula: 'Σ ortağa atanmamış ödenen masraflar',
          result: cap.poolCum,
          source: 'net bakiyeden düşülür',
        },
        {
          label: 'Kart Komisyon Farkı (+, kümülatif)',
          formula: 'Σ (müşteriden alınan %3 − POS gerçek %2,79) kart siparişleri',
          result: cap.cardSpreadCum,
          source: 'müşteriye yansıtılan komisyonun platform kârı; dağıtıma EKLENİR',
        },
        {
          label: 'Promo/Hediye Bakiye Gideri (−, kümülatif)',
          formula:
            'Σ siparişlerin promo (hoşgeldin) + hediye bakiyeden ödenen kısmı (iç hesaplar hariç)',
          result: cap.promoCum,
          source:
            'ortak pazarlama gideri (hoşgeldin promosu + hediye bakiye); net bakiyeden düşülür. Şirketin iç hesaplarının harcaması gider sayılmaz',
        },
        {
          label: 'Net Dağıtılabilir (kümülatif)',
          formula:
            'Biriken Kâr − KDV Farkı − Havuz Masraf − Promo + Kart Farkı',
          inputs: [
            { label: 'Biriken Kâr', value: f(cap.karCum) },
            { label: 'KDV Farkı', value: f(cap.kdvFarkiCum) },
            { label: 'Havuz Masraf', value: f(cap.poolCum) },
            { label: 'Promo Gideri', value: f(cap.promoCum) },
            { label: 'Kart Farkı', value: f(cap.cardSpreadCum) },
          ],
          result: cap.netDistCum,
          source: 'ortaklara %pay ile bölünecek net taban',
        },
        ...cap.partners.map((pt) => ({
          label: `${pt.name} — Net Bakiye`,
          formula: 'Net Dağıtılabilir × %pay + dengeleme − Σ Kâr Avansı',
          inputs: [
            { label: 'Net pay', value: f(pt.netCredit) },
            { label: 'Çekilen Avans', value: f(pt.advTotal) },
          ],
          result: pt.netBalance,
          source: pt.netBalance < 0 ? 'EKSİ = payından fazla çekmiş' : 'kasanın ortağa borcu',
        })),
        {
          label: 'Toptan Budur Döner Sermaye (Net)',
          formula: 'Σ ortakların Net bakiyesi',
          result: cap.netTotal,
          source: 'işi fonlayan gerçek ortak sermayesi',
        },
      ],
    });

    return {
      month: p.month,
      monthLabel: monthLabel(p.month),
      sections,
    };
  }
}

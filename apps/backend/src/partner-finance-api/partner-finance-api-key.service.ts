import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { AdminFinanceService } from '../admin/finance/finance.service';

/**
 * Ortak Finans API anahtarı yönetimi.
 *
 * İki taraf:
 *  • Admin tarafı ("Hesabım" sayfası): ortak KENDİ anahtarını üretir / görür /
 *    iptal eder. Yalnız bir finans ortağına bağlı admin kullanıcı erişebilir.
 *  • Dış taraf (PartnerFinanceApiGuard): gelen token doğrulanır → ortak çözülür.
 *
 * Token biçimi: `tbpf_` + 48 hex. Saklama:
 *  • tokenHash  = sha256(token) → auth için O(1) tekil lookup.
 *  • tokenSealed = VaultService.seal(token) (AES-256-GCM) → sahibine yeniden
 *    gösterebilmek için (dış siteye kopyalar). CLAUDE.md şifreli saklama kuralı.
 *
 * Her ortak için TEK aktif anahtar modeli: yeniden üretim eskiyi iptal eder.
 */

/**
 * Ortak ↔ admin kullanıcı e-posta eşlemesi. `PARTNER_FINANCE_EMAIL_MAP` env'inden
 * okunur; biçim: `eposta=FinancePartner.name` çiftleri, `;` ile ayrılır. Örn:
 *   PARTNER_FINANCE_EMAIL_MAP="ortak1@ornek.com=Ortak 1;ortak2@ornek.com=Ortak 2"
 * Haritada OLMAYAN bir admin kullanıcı finans API erişimi ALMAZ (env boşsa
 * hiç kimse alamaz — güvenli varsayılan).
 */
function parsePartnerEmailMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of (raw ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const email = pair.slice(0, eq).trim().toLowerCase();
    const name = pair.slice(eq + 1).trim();
    if (email && name) map[email] = name;
  }
  return map;
}

const PARTNER_EMAIL_MAP: Record<string, string> = parsePartnerEmailMap(
  process.env.PARTNER_FINANCE_EMAIL_MAP,
);

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v as number);
  if (Number.isFinite(n)) return n;
  const p = parseFloat(String(v));
  return Number.isFinite(p) ? p : 0;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface PartnerContext {
  id: string;
  name: string;
  initials: string | null;
  sharePercent: number;
  tenantId: string;
  isActive: boolean;
}

export interface MaskedKey {
  id: string;
  prefix: string;
  masked: string;
  label: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
}

@Injectable()
export class PartnerFinanceApiKeyService {
  private readonly logger = new Logger(PartnerFinanceApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly finance: AdminFinanceService,
  ) {}

  // ── Ortak çözümleme (admin kullanıcı → FinancePartner) ─────────────────────

  /**
   * Verilen admin kullanıcının bağlı olduğu finans ortağını döner (yoksa null).
   * İlk kez erişen bilinen bir e-posta ise ortağa userId bağlanır (idempotent).
   */
  async resolvePartnerForUser(
    tenantId: string,
    user: { id: string; email: string },
  ) {
    // Ortaklar mevcut değilse tohumla (fresh tenant güvenliği).
    await this.finance.ensurePartners(tenantId);

    // 1) Zaten bağlıysa doğrudan onu döner.
    const linked = await this.prisma.financePartner.findFirst({
      where: { tenantId, userId: user.id },
    });
    if (linked) return linked;

    // 2) Bilinen e-posta ise ilgili ortağa bağla.
    const targetName = PARTNER_EMAIL_MAP[user.email.trim().toLowerCase()];
    if (!targetName) return null;

    const candidate = await this.prisma.financePartner.findFirst({
      where: { tenantId, name: targetName, userId: null },
    });
    if (!candidate) {
      // Ortak zaten başka kullanıcıya bağlı ya da adı değişmiş — sessizce yok say.
      return null;
    }
    try {
      return await this.prisma.financePartner.update({
        where: { id: candidate.id },
        data: { userId: user.id },
      });
    } catch {
      // userId tekil kısıtı yarıştı — güncel bağlıyı yeniden getir.
      return this.prisma.financePartner.findFirst({
        where: { tenantId, userId: user.id },
      });
    }
  }

  private toContext(p: {
    id: string;
    name: string;
    initials: string | null;
    sharePercent: unknown;
    tenantId: string;
    isActive: boolean;
  }): PartnerContext {
    return {
      id: p.id,
      name: p.name,
      initials: p.initials,
      sharePercent: num(p.sharePercent),
      tenantId: p.tenantId,
      isActive: p.isActive,
    };
  }

  // ── Admin tarafı ───────────────────────────────────────────────────────────

  private mapKey(k: {
    id: string;
    tokenPrefix: string;
    label: string | null;
    lastUsedAt: Date | null;
    requestCount: number;
    createdAt: Date;
  }): MaskedKey {
    return {
      id: k.id,
      prefix: k.tokenPrefix,
      masked: `${k.tokenPrefix}${'•'.repeat(20)}`,
      label: k.label,
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      requestCount: k.requestCount,
      createdAt: k.createdAt.toISOString(),
    };
  }

  /** "Hesabım" için: bu kullanıcı ortak mı + aktif anahtarın maskeli durumu. */
  async getState(tenantId: string, user: { id: string; email: string }) {
    const partner = await this.resolvePartnerForUser(tenantId, user);
    if (!partner) {
      return { isPartner: false as const, partner: null, key: null };
    }
    const key = await this.prisma.financePartnerApiKey.findFirst({
      where: { tenantId, partnerId: partner.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      isPartner: true as const,
      partner: {
        id: partner.id,
        name: partner.name,
        initials: partner.initials,
        sharePercent: num(partner.sharePercent),
      },
      key: key ? this.mapKey(key) : null,
    };
  }

  private newToken(): string {
    return `tbpf_${crypto.randomBytes(24).toString('hex')}`;
  }

  /** (Yeniden) üret — eski aktif anahtarları iptal eder, düz metni BİR kez döner. */
  async generateKey(
    tenantId: string,
    user: { id: string; email: string },
    label?: string | null,
  ): Promise<{ token: string; key: MaskedKey }> {
    const partner = await this.resolvePartnerForUser(tenantId, user);
    if (!partner) {
      throw new ForbiddenException('Bu hesap bir finans ortağına bağlı değil.');
    }
    await this.prisma.financePartnerApiKey.updateMany({
      where: { tenantId, partnerId: partner.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = this.newToken();
    const created = await this.prisma.financePartnerApiKey.create({
      data: {
        tenantId,
        partnerId: partner.id,
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 14),
        tokenSealed: this.vault.seal(token),
        label: label?.trim() ? label.trim().slice(0, 80) : null,
        createdByUserId: user.id,
      },
    });
    this.logger.log(
      `Finans API anahtarı üretildi: ${partner.name} (key=${created.id})`,
    );
    return { token, key: this.mapKey(created) };
  }

  /** Aktif anahtarın düz metnini çözer (yalnız sahibine). */
  async revealKey(
    tenantId: string,
    user: { id: string; email: string },
  ): Promise<{ token: string; key: MaskedKey }> {
    const partner = await this.resolvePartnerForUser(tenantId, user);
    if (!partner) {
      throw new ForbiddenException('Bu hesap bir finans ortağına bağlı değil.');
    }
    const key = await this.prisma.financePartnerApiKey.findFirst({
      where: { tenantId, partnerId: partner.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!key) throw new NotFoundException('Aktif API anahtarı yok.');
    return { token: this.vault.open(key.tokenSealed), key: this.mapKey(key) };
  }

  /** Aktif anahtar(lar)ı iptal eder. */
  async revokeKey(
    tenantId: string,
    user: { id: string; email: string },
  ): Promise<{ revoked: number }> {
    const partner = await this.resolvePartnerForUser(tenantId, user);
    if (!partner) {
      throw new ForbiddenException('Bu hesap bir finans ortağına bağlı değil.');
    }
    const res = await this.prisma.financePartnerApiKey.updateMany({
      where: { tenantId, partnerId: partner.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: res.count };
  }

  // ── Dış taraf (guard) ────────────────────────────────────────────────────────

  /**
   * Gelen token'ı doğrular; geçerliyse ortak + tenant döner. Kullanım metriği
   * (lastUsedAt / requestCount) fire-and-forget güncellenir.
   */
  async authenticateToken(
    token: string,
    ip?: string | null,
  ): Promise<PartnerContext | null> {
    if (!token || !token.startsWith('tbpf_')) return null;
    const hash = sha256(token);
    const key = await this.prisma.financePartnerApiKey.findUnique({
      where: { tokenHash: hash },
      include: { partner: true },
    });
    if (!key || key.revokedAt) return null;
    if (!key.partner || !key.partner.isActive) return null;

    // Kullanım metriği — istek yolunu bloklamaz, hata yutulur.
    void this.prisma.financePartnerApiKey
      .update({
        where: { id: key.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: ip ? String(ip).slice(0, 64) : null,
          requestCount: { increment: 1 },
        },
      })
      .catch(() => undefined);

    return this.toContext(key.partner);
  }
}

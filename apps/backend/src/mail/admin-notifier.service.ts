import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService, type MailAccount } from './mail.service';

/**
 * Müşteri-kaynaklı talepler (destek, başvuru, iade, cari yükleme, sohbet
 * mesajı) ve operasyonel aksiyon gerektiren olaylar (bot alamadı) için alıcı
 * rolleri: patronlar + çalışanlar. Patron kararı (2026-08-01): müşteriden
 * gelen her türlü iletişim MEMBER rollü çalışanlara da mail olarak gider.
 * Para/rapor yüzeyleri (Z raporu, büyük topup onayı, Excel dökümü) bu
 * listeyi KULLANMAZ — onlar default OWNER+ADMIN'de kalır.
 */
export const OPS_NOTIFY_ROLES = ['OWNER', 'ADMIN', 'MEMBER'];

export interface AdminNotifyHtmlPayload {
  tenantId: string;
  subject: string;
  html: string;
  /** Default: 'info' (admin-facing account). */
  account?: MailAccount;
  /** Operasyonel log context: 'new-order', 'topup-request' vs. */
  context?: string;
  /**
   * Bildirimin gideceği roller. Default: OWNER + ADMIN. Yalnızca OWNER'lara
   * gitmesi gereken hassas bildirimler için ['OWNER'] geçilir.
   */
  roles?: string[];
}

/**
 * Tüm admin bildirimleri için tek giriş noktası.
 *
 * Sebep: Daha önce her servis kendi `prisma.user.findMany({ role: OWNER|ADMIN })`
 * + `mail.sendHtml(...)` pattern'ini kopyalıyordu. Sessiz başarısızlık (admin
 * user yok / email boş) ve eksik bildirim noktaları bu copy-paste yüzünden
 * gözden kaçıyordu. Tek helper:
 *   - admin alıcı listesini tek noktadan toplar,
 *   - boş liste durumunu açık log'lar (sessizce yutmaz),
 *   - SMTP/transporter hatalarını yakalar ama ana akışı kırmaz (fire-and-forget
 *     gibi davranır — caller `void` ile çağırabilir).
 */
@Injectable()
export class AdminNotifierService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Boot-time sanity check: admin bildirim hattının fiilen çalışıp
   * çalışamayacağını başlangıçta görünür yap. Sessiz kayıp yerine prod log'da
   * tek satırlık bir uyarı bırakırız:
   *   - Hiç OWNER/ADMIN kullanıcı (email'li) yoksa → ERROR (bildirim hattı kapalı)
   *   - Varsayılan tenant çözülemiyorsa → WARN (cross-tenant formlar kayıp olabilir)
   *
   * Test ortamında (NODE_ENV=test) sessiz; spec'leri kirletmez.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const adminCount = await this.prisma.user.count({
        where: {
          role: { in: ['OWNER', 'ADMIN'] },
          email: { not: '' },
        },
      });
      if (adminCount === 0) {
        this.logger.error(
          '[BOOT] No OWNER/ADMIN user with email configured — admin notifications will be silently dropped. Create at least one OWNER user with a valid email.',
        );
      } else {
        this.logger.log(
          `[BOOT] admin notification recipients ready (count=${adminCount} across tenants)`,
        );
      }

      const defaultTenantId = await this.resolveDefaultTenantId();
      if (!defaultTenantId) {
        this.logger.warn(
          `[BOOT] DEFAULT_TENANT_SLUG="${process.env.DEFAULT_TENANT_SLUG ?? 'acme'}" resolved to no tenant — cross-tenant admin notifications (landing forms, dealer applications) will be skipped.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[BOOT] admin notification health check failed: ${(err as Error).message}`,
      );
    }
  }

  async notifyAdmins(payload: AdminNotifyHtmlPayload): Promise<void> {
    const ctx = payload.context ?? 'admin-notify';
    try {
      const emails = await this.resolveAdminEmails(
        payload.tenantId,
        payload.roles,
      );
      if (emails.length === 0) {
        this.logger.warn(
          `[${ctx}] admin notification skipped — tenant=${payload.tenantId} ${(payload.roles ?? ['OWNER', 'ADMIN']).join('/')} with email bulunamadı`,
        );
        return;
      }
      await this.mail.sendHtml({
        account: payload.account ?? 'info',
        to: emails,
        subject: payload.subject,
        html: payload.html,
      });
    } catch (err) {
      this.logger.warn(
        `[${ctx}] admin notification failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Bir tenant'taki istenen rollerdeki kullanıcıların email listesini döner.
   * Default roller OWNER + ADMIN'dir. Boş/null email'ler süzülür,
   * tekrarlananlar deduplike edilir.
   */
  async resolveAdminEmails(
    tenantId: string,
    roles: string[] = ['OWNER', 'ADMIN'],
  ): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: roles as Role[] },
      },
      select: { email: true },
    });
    const seen = new Set<string>();
    for (const a of admins) {
      if (typeof a.email === 'string' && a.email.length > 0) {
        seen.add(a.email);
      }
    }
    return Array.from(seen);
  }

  /**
   * Cross-tenant kaynaklı bildirimler (landing form, dealer application gibi)
   * için varsayılan tenant'ı döner. Önce DEFAULT_TENANT_SLUG (env) aranır,
   * yoksa ilk tenant. Hiç tenant yoksa null — caller log uyarısı ile sessizce
   * geçer (ana akışı bloklamaz).
   */
  async resolveDefaultTenantId(): Promise<string | null> {
    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'acme';
    const bySlug = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (bySlug) return bySlug.id;
    const first = await this.prisma.tenant.findFirst({ select: { id: true } });
    return first?.id ?? null;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, FormStatus, FormType } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFormDto } from './dto/create-form.dto';
import type { UpdateFormDto } from './dto/update-form.dto';
import type { ListFormsDto } from './dto/list-forms.dto';
import { normalizeTrPhone } from '../common/utils/phone';
import { extractClientIp } from '../common/utils/request-meta';
import { DealerService } from '../dealer/dealer.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const FORM_TYPE_LABEL: Record<FormType, string> = {
  CONTACT: 'iletişim formu',
  APPLICATION: 'bayilik başvurusu',
  CALLBACK: 'geri arama talebi',
  INTEGRATION: 'entegrasyon başvurusu',
};

const DEFAULT_MESSAGE_BY_TYPE: Record<FormType, string> = {
  CONTACT: '(Mesaj boş bırakıldı)',
  APPLICATION: '(Bayilik başvurusu — ek mesaj yok)',
  CALLBACK: 'Geri arama talebi.',
  INTEGRATION: '(Entegrasyon başvurusu — ek mesaj yok)',
};

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly dealer: DealerService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Public POST /api/forms.
   *
   * IMPORTANT: Eski sürüm hata olsa bile `{ ok: true, id: '' }` dönüyordu;
   * bu yüzden frontend tarafında başarı görünmesine rağmen DB'ye hiçbir kayıt
   * düşmüyordu (admin paneli boş). Artık DB hatasında 500 döner, böylece kök
   * neden hem log'da hem caller tarafında görünür.
   */
  async create(
    dto: CreateFormDto,
    req?: Request | null,
  ): Promise<{ ok: true; id: string }> {
    const phone = normalizeTrPhone(dto.phone) ?? dto.phone;
    // Artık vergiDairesi/vergiNo/firma message'a BİRLEŞTİRİLMEZ — her biri kendi
    // Form kolonuna yapısal yazılır (aşağıda). message yalnız serbest nottur.
    const message =
      dto.message && dto.message.trim().length > 0
        ? dto.message
        : DEFAULT_MESSAGE_BY_TYPE[dto.type];

    // Schema'da email zorunlu (NOT NULL). DTO opsiyonel olduğu için boş gelirse
    // placeholder yaz: kötü veri yerine eksik alan açıkça anlaşılsın.
    const email =
      dto.email && dto.email.trim().length > 0
        ? dto.email.trim().toLowerCase()
        : 'eposta-yok@toptanbudur.local';

    // APPLICATION'da 3 sözleşmenin de onaylı olduğunu server-side doğrula —
    // istemci tikleri DTO @IsBoolean ile sadece şekli geçer; hukuki delil için
    // üçünün de TRUE olması gerekir. Kabul anı + consentIp aşağıda yazılır.
    let contractTimestamps: {
      dealership: Date | null;
      privacy: Date | null;
      distance: Date | null;
    } = { dealership: null, privacy: null, distance: null };
    let consentIp: string | null = null;
    if (dto.type === FormType.APPLICATION) {
      const c = dto.contractsAccepted;
      if (!c || !c.dealership || !c.privacy || !c.distance) {
        throw new BadRequestException(
          'Devam etmek için üç sözleşmeyi de onaylamanız gerekir.',
        );
      }
      const now = new Date();
      contractTimestamps = { dealership: now, privacy: now, distance: now };
      consentIp = req ? extractClientIp(req) : null;

      // MÜKERRER BAŞVURU ENGELİ: aynı e-posta veya telefonla daha önce başvuru
      // ya da kayıt varsa formu HİÇ oluşturma (Form tablosunda unique yok; bu
      // yüzden eskiden aynı kişi 2 kez başvurabiliyordu). email zaten lowercase,
      // phone normalize edilmiş durumda. Placeholder e-posta dedup'a girmez.
      const isRealEmail = email !== 'eposta-yok@toptanbudur.local';
      const custOr: Prisma.CustomerWhereInput[] = [];
      const appOr: Prisma.DealerApplicationWhereInput[] = [];
      if (isRealEmail) {
        custOr.push({ email });
        appOr.push({ email });
      }
      if (phone) {
        custOr.push({ phone });
        appOr.push({ phone });
      }
      if (custOr.length > 0) {
        const [existingCustomer, existingApp] = await Promise.all([
          this.prisma.customer.findFirst({
            where: { OR: custOr },
            select: { isActive: true },
          }),
          this.prisma.dealerApplication.findFirst({
            where: { OR: appOr },
            select: { id: true },
          }),
        ]);
        // Aktif (onaylı) kullanıcı → "zaten kayıtlısınız" + şifre/WhatsApp.
        if (existingCustomer?.isActive) {
          throw new ConflictException({
            code: 'ALREADY_REGISTERED',
            message:
              'Bu e-posta veya telefon numarası zaten kayıtlı bir kullanıcıya ait. Şifrenizi unuttuysanız WhatsApp üzerinden iletişime geçebilirsiniz.',
          });
        }
        // Pasif kullanıcı (onay bekleyen) veya mevcut başvuru → "daha önce başvuruldu".
        if (existingCustomer || existingApp) {
          throw new ConflictException({
            code: 'ALREADY_APPLIED',
            message:
              'Bu e-posta veya telefon numarası ile daha önce bayilik başvurusu yapılmış. Başvurunuz değerlendirme aşamasındadır; sorunuz varsa WhatsApp üzerinden iletişime geçebilirsiniz.',
          });
        }
      }
    }

    try {
      const form = await this.prisma.form.create({
        data: {
          type: dto.type,
          name: dto.name,
          email,
          phone,
          subject: dto.subject ?? null,
          message,
          company: dto.company?.trim() || null,
          vergiNo: dto.vergiNo?.trim() || null,
          vergiDairesi: dto.vergiDairesi?.trim() || null,
          integrationSoftware: dto.integrationSoftware ?? null,
          hasIntegration: dto.hasIntegration ?? null,
          package: dto.package ?? null,
          contractDealershipAt: contractTimestamps.dealership,
          contractPrivacyAt: contractTimestamps.privacy,
          contractDistanceAt: contractTimestamps.distance,
          consentIp,
          // Reklam atıfı — boş/whitespace ise null (exception fırlatmaz;
          // bu blok catch'te 500'e çevrildiğinden burada parse mantığı yok).
          utmSource: dto.utmSource?.trim() || null,
          utmMedium: dto.utmMedium?.trim() || null,
          utmCampaign: dto.utmCampaign?.trim() || null,
          utmTerm: dto.utmTerm?.trim() || null,
          utmContent: dto.utmContent?.trim() || null,
          gclid: dto.gclid?.trim() || null,
          referrer: dto.referrer?.trim() || null,
          landingPage: dto.landingPage?.trim() || null,
        },
        select: { id: true, type: true },
      });

      this.logger.log(
        JSON.stringify({
          event: 'form.received',
          id: form.id,
          type: form.type,
          email,
        }),
      );

      // Admin bildirimi (fire-and-forget). APPLICATION tipi formlar
      // dealer.service.applyFromForm üzerinden ayrıca admin maili tetikler;
      // burada ikinci kez gönderme — CONTACT/CALLBACK/INTEGRATION gönderilir.
      // (INTEGRATION önceden hiç mail atmıyordu — yalnız panel bildirimi;
      // başvuru maillerinin tamamı gitsin kararıyla kapsama alındı.)
      if (
        dto.type === FormType.CONTACT ||
        dto.type === FormType.CALLBACK ||
        dto.type === FormType.INTEGRATION
      ) {
        void (async () => {
          const tenantId = await this.adminNotifier.resolveDefaultTenantId();
          if (!tenantId) {
            this.logger.warn(
              `[form.contact] admin notification skipped — tenant bulunamadı formId=${form.id}`,
            );
            return;
          }
          const emails = await this.adminNotifier.resolveAdminEmails(
            tenantId,
            OPS_NOTIFY_ROLES,
          );
          if (emails.length === 0) {
            this.logger.warn(
              `[form.contact] admin notification skipped — tenant=${tenantId} mail alıcısı yok formId=${form.id}`,
            );
            return;
          }
          await this.mail.sendAdminNewContactForm({
            to: emails,
            formType: dto.type as 'CONTACT' | 'CALLBACK' | 'INTEGRATION',
            name: dto.name,
            email,
            phone,
            // INTEGRATION formu firma adını zorunlu toplar; mailde de görünsün.
            company: dto.company?.trim() || null,
            subject: dto.subject ?? null,
            message,
            adminUrl: null,
          });
        })().catch((e) =>
          this.logger.warn(
            `[form.contact] admin mail failed formId=${form.id} err=${(e as Error).message}`,
          ),
        );
      }

      // In-app + push bildirimi — bildirim merkezi & push.
      void this.notifications
        .emit({
          type: 'lead.new',
          severity: 'info',
          title:
            dto.type === FormType.APPLICATION
              ? 'Yeni bayilik başvurusu'
              : dto.type === FormType.INTEGRATION
                ? 'Yeni entegrasyon başvurusu'
                : dto.type === FormType.CALLBACK
                  ? 'Yeni geri arama talebi'
                  : 'Yeni iletişim formu',
          body: `${dto.name}${dto.subject ? ' — ' + dto.subject : ''}`,
          link:
            dto.type === FormType.APPLICATION
              ? '/mesajlar?source=APPLICATION'
              : dto.type === FormType.INTEGRATION
                ? '/mesajlar?source=INTEGRATION'
                : '/mesajlar?source=CONTACT',
          data: {
            formId: form.id,
            formType: dto.type,
            email,
            phone,
          },
          audience: { role: 'ADMIN' },
        })
        .catch((e) =>
          this.logger.warn(
            `[form.create] notification emit failed: ${(e as Error).message}`,
          ),
        );

      // Bayilik başvurusuysa otomatik DealerApplication + pasif Customer üret.
      // Admin "Müşteriler" sayfasında "Onay Bekliyor" tag'iyle anında görür;
      // isActive=false olduğu için müşteri admin onayına kadar giriş yapamaz.
      if (dto.type === FormType.APPLICATION) {
        await this.dealer.applyFromForm(form.id);
      }

      void (async () => {
        try {
          const typeLabel = FORM_TYPE_LABEL[dto.type];
          const subjectSuffix = dto.subject ? ` — ${dto.subject}` : '';
          await this.audit.record({
            action: 'PUBLIC_FORM_SUBMIT',
            summary: `${dto.name} (${email}) ${typeLabel} gönderdi${subjectSuffix}`,
            actor: {
              type: 'public',
              name: dto.name,
              email,
            },
            target: {
              id: form.id,
              type: 'form',
              label: dto.name,
            },
            extra: {
              formType: dto.type,
              phone,
              subject: dto.subject ?? null,
              message,
              package: dto.package ?? null,
              hasIntegration: dto.hasIntegration ?? null,
              integrationSoftware: dto.integrationSoftware ?? null,
            },
            req: req ?? null,
          });
        } catch (e) {
          this.logger.warn(
            `Failed to record PUBLIC_FORM_SUBMIT audit: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      })();

      return { ok: true, id: form.id };
    } catch (err) {
      this.logger.error(
        `form.create failed type=${dto.type} email=${email}`,
        err as Error,
      );
      throw new InternalServerErrorException('form_create_failed');
    }
  }

  async list(query: ListFormsDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    const where: Prisma.FormWhereInput = {};
    if (query.status) where.status = query.status as FormStatus;
    if (query.type) where.type = query.type as FormType;

    const [items, total] = await Promise.all([
      this.prisma.form.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.form.count({ where }),
    ]);

    // APPLICATION tipi formları ilişkili DealerApplication.status ile
    // zenginleştir. Form.status sadece NEW/HANDLED/ARCHIVED ayrımı yapabilir;
    // onaylandı/reddedildi farkını gösteremez. Mesajlar sayfası bu alanla
    // başvuru işlem panelini koşullu render eder (onaylıysa "Onayla" + sarı
    // uyarı kutusu gizlenir).
    const applicationForms = items.filter(
      (f) => f.type === FormType.APPLICATION,
    );
    let statusByEmail = new Map<string, string>();
    if (applicationForms.length > 0) {
      const emails = [
        ...new Set(applicationForms.map((f) => f.email.trim().toLowerCase())),
      ];
      const apps = await this.prisma.dealerApplication.findMany({
        where: { email: { in: emails } },
        select: { email: true, status: true },
      });
      statusByEmail = new Map(
        apps.map((a) => [a.email.trim().toLowerCase(), a.status]),
      );
    }

    const data = items.map((f) =>
      f.type === FormType.APPLICATION
        ? {
            ...f,
            dealerApplicationStatus:
              statusByEmail.get(f.email.trim().toLowerCase()) ?? null,
          }
        : f,
    );

    return {
      success: true,
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async update(
    id: string,
    dto: UpdateFormDto,
    actor?: { id: string; tenantId: string; name?: string | null; email?: string | null } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.form.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        name: true,
        email: true,
        phone: true,
        type: true,
        notes: true,
      },
    });
    if (!existing) throw new NotFoundException('form not found');

    const data: Prisma.FormUpdateInput = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'HANDLED' && existing.status !== 'HANDLED') {
        data.handledAt = new Date();
      }
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    // Admin bir NOT kaydettiğinde (not değişti & boş değil) ve talep hâlâ NEW
    // kalacaksa otomatik HANDLED'a al → "Yeni" badge/bildiriminden düşer. Böylece
    // entegrasyon başvurusu / "beni ara" (CALLBACK) / iletişim (CONTACT) talepleri
    // not kaydedince çözülmüş sayılır (kullanıcı isteği). APPLICATION HARİÇ —
    // bayilik başvurusunun kendi onay/kapatma akışı var; not yazmak onu otomatik
    // kapatmamalı (onay/dealer hesabı oluşturma unutulmasın).
    const savingNote = dto.notes !== undefined && dto.notes.trim().length > 0;
    const effectiveStatus = dto.status ?? existing.status;
    if (savingNote && effectiveStatus === 'NEW' && existing.type !== 'APPLICATION') {
      data.status = 'HANDLED';
      if (existing.status !== 'HANDLED') data.handledAt = new Date();
    }

    // #34: Admin mesaj detayında iletişim alanlarını düzeltebilir. FE bu üç
    // alanı gönderiyordu ama eskiden DTO/servis yok sayıyordu (sessiz veri
    // kaybı). Artık yalnız gönderilen alanlar kaydedilir; email lowercase'e,
    // phone normalize edilir (create ile aynı kural).
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) {
      data.phone = normalizeTrPhone(dto.phone) ?? dto.phone;
    }

    const updated = await this.prisma.form.update({
      where: { id },
      data,
    });

    if (actor) {
      void (async () => {
        try {
          const adminLabel = actor.name?.trim() || actor.email || 'Admin';
          const typeLabel = FORM_TYPE_LABEL[existing.type];
          const changeBits: string[] = [];
          if (dto.status !== undefined && dto.status !== existing.status) {
            changeBits.push(`durum ${existing.status} → ${dto.status}`);
          }
          if (dto.notes !== undefined && dto.notes !== existing.notes) {
            changeBits.push('notlar güncellendi');
          }
          if (dto.name !== undefined && updated.name !== existing.name) {
            changeBits.push('ad güncellendi');
          }
          if (dto.email !== undefined && updated.email !== existing.email) {
            changeBits.push('e-posta güncellendi');
          }
          if (dto.phone !== undefined && updated.phone !== existing.phone) {
            changeBits.push('telefon güncellendi');
          }
          const changeText = changeBits.length ? ` (${changeBits.join(', ')})` : '';
          await this.audit.record({
            action: 'ADMIN_FORM_UPDATE',
            summary: `${adminLabel} ${existing.name} ${typeLabel} kaydını güncelledi${changeText}`,
            actor: {
              type: 'admin',
              id: actor.id,
              name: actor.name ?? null,
              email: actor.email ?? null,
              tenantId: actor.tenantId,
            },
            target: { id: existing.id, type: 'form', label: existing.name },
            before: {
              status: existing.status,
              notes: existing.notes,
              name: existing.name,
              email: existing.email,
              phone: existing.phone,
            },
            after: {
              status: updated.status,
              notes: updated.notes,
              name: updated.name,
              email: updated.email,
              phone: updated.phone,
            },
            req: req ?? null,
          });
        } catch (e) {
          this.logger.warn(
            `Failed to record ADMIN_FORM_UPDATE audit: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      })();
    }

    return { success: true, data: updated };
  }

  async remove(
    id: string,
    actor?: { id: string; tenantId: string; name?: string | null; email?: string | null } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.form.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, type: true },
    });
    if (!existing) throw new NotFoundException('form not found');
    await this.prisma.form.delete({ where: { id } });

    if (actor) {
      void (async () => {
        try {
          const adminLabel = actor.name?.trim() || actor.email || 'Admin';
          const typeLabel = FORM_TYPE_LABEL[existing.type];
          await this.audit.record({
            action: 'ADMIN_FORM_DELETE',
            summary: `${adminLabel} ${existing.name} ${typeLabel} kaydını sildi`,
            actor: {
              type: 'admin',
              id: actor.id,
              name: actor.name ?? null,
              email: actor.email ?? null,
              tenantId: actor.tenantId,
            },
            target: { id: existing.id, type: 'form', label: existing.name },
            extra: { email: existing.email, formType: existing.type },
            req: req ?? null,
          });
        } catch (e) {
          this.logger.warn(
            `Failed to record ADMIN_FORM_DELETE audit: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      })();
    }

    return { success: true, data: { deleted: true } };
  }
}

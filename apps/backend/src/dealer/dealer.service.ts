import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import type { DealerApplication } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { BayiNumberService } from '../receipts/bayi-number.service';
import { DealerApplyDto } from './dto/dealer-apply.dto';
import { normalizeTrPhone } from '../common/utils/phone';

const BCRYPT_ROUNDS = 12;

/**
 * 12 karakterli rastgele tek kullanımlık parola üretir (harf + rakam karışımı).
 * `crypto.randomBytes` işletim sistemi CSPRNG'sini kullanır — `Math.random`
 * KESİNLİKLE kullanılmamalı (predictable seed).
 *
 * Karakter setinden ambigous karakterler (0/O, 1/l/I) çıkarıldı; "yazılışı
 * net" parola.  En az bir harf + bir rakam içerdiği garanti edilir (UI'daki
 * minimum kompleksite şartını karşılamak için).
 */
function generateTempPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const charset = letters + digits;
  const length = 12;

  while (true) {
    const bytes = randomBytes(length);
    const chars: string[] = new Array(length);
    for (let i = 0; i < length; i++) {
      chars[i] = charset[bytes[i] % charset.length];
    }
    const candidate = chars.join('');
    // Garanti: en az bir harf + bir rakam; aksi halde tekrar üret.
    if (/[A-Za-z]/.test(candidate) && /[0-9]/.test(candidate)) {
      return candidate;
    }
  }
}

/**
 * Landing başvurusundaki tek "Vergi No / TC Kimlik No" alanını uzunluğa göre ayırır:
 * 11 hane → tcKimlik, 10 hane → vergiNo. Geçersiz/kısa değer vergiNo'ya düşer (eski davranış).
 */
function routeTaxId(v?: string | null): { vergiNo: string | null; tcKimlik: string | null } {
  const t = (v ?? '').trim();
  if (/^\d{11}$/.test(t)) return { vergiNo: null, tcKimlik: t };
  if (/^\d{10}$/.test(t)) return { vergiNo: t, tcKimlik: null };
  return { vergiNo: t || null, tcKimlik: null };
}

@Injectable()
export class DealerService {
  private readonly logger = new Logger(DealerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly bayiNumbers: BayiNumberService,
  ) {}

  /**
   * Müşteri oluşturulduktan/güncellendikten sonra `bayiNo` yoksa atar. Hata ana
   * akışı (bayilik onayı/ön-kayıt) KIRMAZ — `bayiNo` ikincil bir alandır; geçici
   * bir sequence hatası bir bayinin kaydını engellememeli. Kaçan kayıtlar
   * `scripts/backfill-bayi-no.ts` ile veya bir sonraki dokunuşta tamamlanır.
   */
  private async assignBayiNoSafe(customerId: string): Promise<void> {
    try {
      await this.bayiNumbers.ensureForCustomer(customerId);
    } catch (err) {
      this.logger.warn(
        `bayiNo atanamadı customerId=${customerId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Yeni bayilik başvurusunda admin OWNER/ADMIN'lere bildirim atar.
   * Fire-and-forget: hata ana akışı kırmaz, log'a düşer.
   * apply() + applyFromForm() ortak çağırır — tek noktada.
   */
  private notifyAdminsOfApplication(input: {
    applicantName: string;
    email: string;
    phone: string;
    company: string | null;
    message: string | null;
  }): void {
    void (async () => {
      const tenantId = await this.adminNotifier.resolveDefaultTenantId();
      if (!tenantId) {
        this.logger.warn(
          `[dealer.apply] admin notification skipped — tenant bulunamadı email=${input.email}`,
        );
        return;
      }
      const emails = await this.adminNotifier.resolveAdminEmails(
        tenantId,
        OPS_NOTIFY_ROLES,
      );
      if (emails.length === 0) {
        this.logger.warn(
          `[dealer.apply] admin notification skipped — tenant=${tenantId} mail alıcısı yok email=${input.email}`,
        );
        return;
      }
      await this.mail.sendAdminNewDealerApplication({
        to: emails,
        applicantName: input.applicantName,
        email: input.email,
        phone: input.phone,
        company: input.company,
        message: input.message,
        adminUrl: null,
      });
    })().catch((e) =>
      this.logger.warn(
        `[dealer.apply] admin mail failed email=${input.email} err=${(e as Error).message}`,
      ),
    );
  }

  async apply(
    dto: DealerApplyDto,
    req?: Request | null,
  ): Promise<{ ok: true; applicationId: string }> {
    const phone = normalizeTrPhone(dto.phone) ?? dto.phone;
    // Bug #9 — auth flow expects normalized e-mails (lowercase + trim).
    // Storing the canonical form here ensures dealer→customer→login lookups
    // all key off the same string (Postgres unique index is case-sensitive).
    const email = dto.email.trim().toLowerCase();
    let application: DealerApplication;
    try {
      application = await this.prisma.dealerApplication.create({
        data: {
          name: dto.name.trim(),
          email,
          phone,
          company: dto.company,
          message: dto.message,
          vergiNo: dto.vergiNo?.trim() || null,
          vergiDairesi: dto.vergiDairesi?.trim() || null,
          package: dto.package ?? null,
          hasIntegration: dto.hasIntegration ?? null,
          integrationSoftware: dto.integrationSoftware ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Bu e-posta adresiyle zaten bir başvuru mevcut.');
      }
      throw err;
    }

    // Otomatik ön kayıt — başvuru anında Customer (isActive=false) yaratılır.
    // Admin onay verene kadar müşteri giriş yapamaz; ancak admin paneli
    // "Müşteriler" sayfasında "Onay Bekliyor" tag'i ile görünür ve ayarları
    // (iskonto vs.) önceden yapılabilir. Onay = activateCustomer çağrısıdır.
    // Hata olursa başvuru yine geçerli kalır (non-fatal); admin manuel
    // ön-kayıt yapabilir.
    await this.autoPreRegisterCustomer(application).catch((e) =>
      this.logger.warn(
        `auto pre-register failed (non-fatal) email=${email} err=${(e as Error).message}`,
      ),
    );

    void this.mail
      .sendDealerApplicationReceived({
        to: email,
        name: dto.name.trim(),
        email,
        phone: dto.phone,
        company: dto.company ?? null,
        message: dto.message ?? null,
      })
      .catch((e) =>
        this.logger.warn(
          `dealer application received mail failed email=${email} err=${(e as Error).message}`,
        ),
      );

    this.notifyAdminsOfApplication({
      applicantName: dto.name.trim(),
      email,
      phone: dto.phone,
      company: dto.company ?? null,
      message: dto.message ?? null,
    });

    void (async () => {
      try {
        const companySuffix = dto.company ? ` — ${dto.company}` : '';
        await this.audit.record({
          action: 'DEALER_APPLY',
          summary: `${dto.name.trim()} (${email}) bayilik başvurusu gönderdi${companySuffix}`,
          actor: {
            type: 'public',
            name: dto.name.trim(),
            email,
          },
          target: {
            id: application.id,
            type: 'dealer_application',
            label: dto.name.trim(),
          },
          extra: {
            phone,
            company: dto.company ?? null,
            message: dto.message ?? null,
            vergiDairesi: dto.vergiDairesi ?? null,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record DEALER_APPLY audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    return { ok: true, applicationId: application.id };
  }

  /**
   * Form (type=APPLICATION) ile gelen başvuruyu DealerApplication'a dönüştürür
   * ve Customer(isActive=false) yaratır. Idempotent — aynı Form için tekrar
   * çağrılırsa mevcut DealerApplication kullanılır.
   *
   * forms.service.ts içinden çağrılır (landing'deki form gönderildiğinde).
   * Hata fırlatmaz; başarısızlık log'a düşer ve Form kaydı yine geçerli kalır.
   */
  async applyFromForm(formId: string): Promise<void> {
    try {
      const { application } = await this.resolveApplicationOrFromForm(formId);
      if (!application) return;
      await this.autoPreRegisterCustomer(application);
      this.notifyAdminsOfApplication({
        applicantName: application.name,
        email: application.email,
        phone: application.phone,
        company: application.company ?? null,
        message: application.message ?? null,
      });
    } catch (err) {
      const e = err as Error & { code?: string; meta?: unknown };
      this.logger.error(
        `[applyFromForm] FAILED formId=${formId} code=${e.code ?? '-'} msg=${e.message || String(err)} meta=${JSON.stringify(e.meta ?? null)}`,
        e.stack,
      );
    }
  }

  /**
   * Ortak ön-kayıt çekirdek mantığı. `apply()` ve `applyFromForm()` ile
   * `preRegisterApplication()` admin endpoint'i bu helper'ı kullanır.
   *
   * Davranış:
   *   - Aynı email'de aktif Customer (mustChangePassword=false) varsa NO-OP
   *     (mevcut hesabı override etmez; güvenlik).
   *   - Aynı email'de yönetici (User) varsa NO-OP (yönetici hesabıyla çakışma).
   *   - Aksi halde Customer upsert: isActive=false, mustChangePassword=true,
   *     yeni geçici şifre hash'i yazılır (şifre dışarı VERILMEZ — aktivasyon
   *     anında taze şifre üretilip mail ile gider).
   *   - DealerApplication.status -> 'PRE_REGISTERED' (zaten APPROVED ise no-op).
   */
  private async autoPreRegisterCustomer(
    application: DealerApplication,
  ): Promise<void> {
    if (application.status === 'APPROVED') return;

    const normalizedEmail = application.email.trim().toLowerCase();

    const conflictUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, role: true },
    });
    if (conflictUser && conflictUser.role !== 'CUSTOMER') {
      this.logger.warn(
        `auto pre-register skipped — admin user exists email=${normalizedEmail}`,
      );
      return;
    }

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, mustChangePassword: true, isActive: true },
    });
    if (existingCustomer && !existingCustomer.mustChangePassword) {
      // Aktif (parolasını değiştirmiş) bir müşteri varsa override etme.
      this.logger.warn(
        `auto pre-register skipped — active customer exists email=${normalizedEmail}`,
      );
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const phoneNormalized =
      normalizeTrPhone(application.phone) ?? application.phone;

    const [, customer] = await this.prisma.$transaction([
      this.prisma.dealerApplication.update({
        where: { id: application.id },
        data: {
          status:
            application.status === 'PENDING'
              ? 'PRE_REGISTERED'
              : application.status,
        },
      }),
      this.prisma.customer.upsert({
        where: { email: normalizedEmail },
        update: {
          passwordHash,
          mustChangePassword: true,
          isActive: false,
          name: application.name,
          phone: phoneNormalized,
          // Başvuru profil verileri — varsa doldur (mevcut değeri null'la ezme).
          ...(application.company ? { companyTitle: application.company } : {}),
          ...(application.vergiNo ? routeTaxId(application.vergiNo) : {}),
          ...(application.vergiDairesi
            ? { vergiDairesi: application.vergiDairesi }
            : {}),
        },
        create: {
          email: normalizedEmail,
          passwordHash,
          name: application.name,
          phone: phoneNormalized,
          companyTitle: application.company ?? null,
          ...routeTaxId(application.vergiNo),
          vergiDairesi: application.vergiDairesi ?? null,
          discountPercent: 0,
          mustChangePassword: true,
          isActive: false,
        },
        select: { id: true },
      }),
    ]);

    // Yeni müşteri oluşturulduğu anda bayiNo ata (kart işlemi beklenmez).
    await this.assignBayiNoSafe(customer.id);

    this.logger.log(
      JSON.stringify({
        event: 'dealer.application.auto_pre_registered',
        applicationId: application.id,
        email: normalizedEmail,
      }),
    );
  }

  // NOTE: DealerApplication has no tenantId field in schema (cross-tenant
  // pipeline). Caller must be authenticated admin (RolesGuard upstream).
  // Form(type=APPLICATION) kayıtları da bu listeye dahil edilir — landing'den
  // gelen başvurular Form tablosuna düşer, DealerApplication tablosuna değil.
  //
  // H-10: pageSize ile sınır artık caller-kontrollü. Geriye dönük uyumluluk
  // için varsayılan 200 korundu (eski admin paneli parametresiz çağırıyor);
  // 1000 hard cap sayfa başına başvuru patlamasını önler.
  async listApplications(
    _tenantId: string,
    pagination?: { page?: number; pageSize?: number },
  ) {
    const pageSize = Math.min(1000, Math.max(1, pagination?.pageSize ?? 200));
    const page = Math.max(1, pagination?.page ?? 1);
    // İki tablodan birleşik liste döndüğümüz için DB-seviyesinde tam offset
    // pagination yapamıyoruz; her tabloyu page*pageSize ile çekip merge sonrası
    // dilimlemek doğru sıralamayı (createdAt desc) korur.
    const fetchLimit = page * pageSize;
    const [dealerApps, forms] = await Promise.all([
      this.prisma.dealerApplication.findMany({
        orderBy: { createdAt: 'desc' },
        take: fetchLimit,
      }),
      this.prisma.form.findMany({
        where: { type: 'APPLICATION' },
        orderBy: { createdAt: 'desc' },
        take: fetchLimit,
      }),
    ]);

    // Form kayıtlarını DealerApplication şekline normalize et.
    // id olarak Form.id kullanılır; resolveApplicationOrFromForm bu id'yi tanır.
    const formApps = forms
      .filter((f) => !dealerApps.some((d) => d.email === f.email))
      .map((f) => ({
        id: f.id,
        name: f.name,
        email: f.email,
        phone: f.phone,
        company: f.company ?? null,
        message: f.message,
        vergiNo: f.vergiNo ?? null,
        vergiDairesi: f.vergiDairesi ?? null,
        package: f.package ?? null,
        hasIntegration: f.hasIntegration ?? null,
        integrationSoftware: f.integrationSoftware ?? null,
        status: (f.status === 'HANDLED' ? 'APPROVED' : 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED' | 'PRE_REGISTERED',
        createdAt: f.createdAt,
        updatedAt: f.createdAt,
      }));

    const merged = [...dealerApps, ...formApps].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    // Caller geçmişte düz dizi alıyordu; varsayılan parametresiz çağrıda
    // davranış aynı (ilk 200 kayıt). Açık page/pageSize verildiyse offset
    // alınır. Toplam sayım kabaca merged.length; gerçek toplam için iki ayrı
    // count gerekirdi, mevcut UI bunu istemediği için ek RTT'den kaçınıyoruz.
    const start = (page - 1) * pageSize;
    return merged.slice(start, start + pageSize);
  }

  /**
   * applicationId hem `DealerApplication.id` hem de `Form.id` (type=APPLICATION)
   * olabilir. Form kaydı varsa `DealerApplication` kaydına dönüştürür ve
   * referansı `Form.notes` içine `dealerApplicationId=...` formatında yazar
   * (şemayı bozmamak için ayrı tablo eklemiyoruz).
   * Idempotent: aynı Form için tekrar çağrılırsa eski DealerApplication kaydı
   * bulunur, çift kayıt yaratmaz.
   */
  private async resolveApplicationOrFromForm(
    applicationId: string,
  ): Promise<{ application: DealerApplication | null; formId: string | null }> {
    const direct = await this.prisma.dealerApplication.findUnique({
      where: { id: applicationId },
    });
    if (direct) {
      // DealerApplication.id ile çağrıldıysa bile (ör. Customers sayfasındaki
      // "Aktive Et" → activateCustomer → approveApplication) ilişkili Form
      // kaydını bul ki Form.status da senkronize olsun — aksi halde Mesajlar
      // sayfasındaki bildirim düşmez.
      const formId = await this.findLinkedFormId(direct);
      return { application: direct, formId };
    }

    const form = await this.prisma.form.findUnique({
      where: { id: applicationId },
    });
    if (!form) return { application: null, formId: null };
    if (form.type !== 'APPLICATION') {
      throw new NotFoundException('form is not an APPLICATION');
    }

    // Daha önce bu Form için bir DealerApplication yarattık mı? notes alanına
    // `dealerApplicationId=...` formatında yazıyoruz. (Schema'ya yeni kolon
    // eklemekten kaçınmak için.)
    const existingId = form.notes
      ? (/dealerApplicationId=([a-z0-9_-]+)/i.exec(form.notes)?.[1] ?? null)
      : null;
    if (existingId) {
      const existing = await this.prisma.dealerApplication.findUnique({
        where: { id: existingId },
      });
      if (existing) return { application: existing, formId: form.id };
    }

    // DealerApplication.email @unique — aynı email'le başka bir başvuru zaten
    // varsa onu kullan (kullanıcı aynı email'le tekrar başvurmuş olabilir).
    // Aksi halde P2002 patlar ve auto-pre-register sessizce başarısız olur.
    const normalizedEmail = form.email.trim().toLowerCase();
    const byEmail = await this.prisma.dealerApplication.findUnique({
      where: { email: normalizedEmail },
    });
    if (byEmail) {
      await this.prisma.form.update({
        where: { id: form.id },
        data: {
          notes:
            (form.notes ? form.notes + '\n' : '') +
            `dealerApplicationId=${byEmail.id}`,
        },
      });
      return { application: byEmail, formId: form.id };
    }

    // Yeni DealerApplication kaydı yarat — Form'un YAPISAL alanlarından doldur.
    const created = await this.prisma.dealerApplication.create({
      data: {
        name: form.name,
        email: normalizedEmail,
        phone: form.phone,
        company: form.company ?? null,
        vergiNo: form.vergiNo ?? null,
        vergiDairesi: form.vergiDairesi ?? null,
        message: form.message,
        package: form.package ?? null,
        hasIntegration: form.hasIntegration ?? null,
        integrationSoftware: form.integrationSoftware ?? null,
      },
    });
    await this.prisma.form.update({
      where: { id: form.id },
      data: {
        notes:
          (form.notes ? form.notes + '\n' : '') +
          `dealerApplicationId=${created.id}`,
      },
    });
    return { application: created, formId: form.id };
  }

  /**
   * Bir DealerApplication ile ilişkili Form(type=APPLICATION) kaydının id'sini
   * bulur. İlişki iki şekilde kurulabilir:
   *   1. Form.notes içinde `dealerApplicationId=<id>` referansı
   *   2. Aynı e-posta (DealerApplication.email @unique; Form.email normalize)
   * Bulunamazsa null döner — DealerApplication doğrudan /bayilik-basvuru
   * akışıyla yaratılmış olabilir, Form karşılığı yoktur.
   */
  private async findLinkedFormId(
    application: DealerApplication,
  ): Promise<string | null> {
    const byNotes = await this.prisma.form.findFirst({
      where: {
        type: 'APPLICATION',
        notes: { contains: `dealerApplicationId=${application.id}` },
      },
      select: { id: true },
    });
    if (byNotes) return byNotes.id;

    const normalizedEmail = application.email.trim().toLowerCase();
    const byEmail = await this.prisma.form.findFirst({
      where: {
        type: 'APPLICATION',
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return byEmail?.id ?? null;
  }

  /**
   * Bayilik başvurusu onaylandığında:
   *   1. DealerApplication.status -> 'APPROVED'
   *   2. Aynı email ile **Customer** kaydı yoksa yaratılır
   *      (User != Customer; admin tablosu DEĞİL — storefront /giris akışı).
   *      Her başvuru için `crypto.randomBytes` ile 12 karakterli rastgele
   *      parola üretilir (mustChangePassword = true).
   *   3. Form üzerinden geldiyse Form.status -> HANDLED
   *   4. Audit log: DEALER_APPLICATION_APPROVED (parola loglanmaz!)
   *   5. Üretilen parola:
   *        - SMTP yapılandırılmışsa müşteriye e-posta ile gönderilir
   *        - Ek olarak admin'e response body içinde tek seferlik döner
   *          (`oneTimePassword` alanı). Admin bu değeri başka yerde saklamamalı.
   *
   * NOT: Eski sürümde `User` tablosuna `role=CUSTOMER` kaydı atılıyordu.
   * Doğru tablo `Customer` — storefront login bu tabloyu kullanıyor. Mevcut
   * User kayıtları silinmedi (hesap kaybı riski); manuel temizlik admin işi.
   */
  async approveApplication(
    applicationId: string,
    actor: { id: string; tenantId: string; name?: string | null; email?: string | null },
    req?: Request | null,
  ) {
    const { application, formId } = await this.resolveApplicationOrFromForm(
      applicationId,
    );
    if (!application) throw new NotFoundException('application not found');

    // Bug #9 — login uses Postgres unique index on Customer.email which is
    // case-sensitive. Normalize once here so the upsert/lookup keys match the
    // form storefront login uses (`loginDto.email.trim().toLowerCase()`).
    const normalizedEmail = application.email.trim().toLowerCase();

    if (application.status === 'APPROVED') {
      // Idempotent: tekrar onaylama -> mevcut Customer bilgisini geri döner.
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, name: true, isActive: true },
      });
      // Drift düzeltmesi: status=APPROVED ama Customer.isActive=false ise
      // (eski bug'dan kalma split state) parola/mail üretmeden sadece flag'i
      // senkronize et. Yeni parola ÜRETME — müşteri zaten ilk onay sırasında
      // gelen parolayla giriyor.
      if (existingCustomer && existingCustomer.isActive === false) {
        await this.prisma.customer.update({
          where: { id: existingCustomer.id },
          data: { isActive: true },
        });
        existingCustomer.isActive = true;
      }
      // Form üzerinden gelmişse status'u da senkronize et.
      if (formId) {
        await this.prisma.form.update({
          where: { id: formId },
          data: { status: 'HANDLED', handledAt: new Date() },
        });
      }
      return {
        success: true,
        data: {
          alreadyApproved: true,
          application,
          customer: existingCustomer ?? null,
        },
      };
    }

    // Aynı email ile bir admin/owner User varsa, riskli birleştirmeyi yapmayız;
    // Customer yaratımı User'dan bağımsızdır ama uyarı amaçlı kontrol ediyoruz.
    const conflictUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, role: true },
    });
    if (conflictUser && conflictUser.role !== 'CUSTOMER') {
      // E-posta zaten yönetici (OWNER/ADMIN/MEMBER) hesabına atanmış.
      // Onayı işaretle ama Customer yaratma; yöneticinin manuel müdahalesi gerek.
      await this.prisma.dealerApplication.update({
        where: { id: application.id },
        data: { status: 'APPROVED' },
      });
      if (formId) {
        await this.prisma.form.update({
          where: { id: formId },
          data: { status: 'HANDLED', handledAt: new Date() },
        });
      }
      throw new ConflictException(
        'Bu e-posta adresi zaten bir yönetici hesabına atanmış. ' +
          'Manuel müdahale gerekli.',
      );
    }

    // Her bayi onayında taze parola — sabit '1234' kesinlikle KULLANILMAMALI.
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const phoneNormalized = normalizeTrPhone(application.phone) ?? application.phone;

    // Bug #9 — Önceden upsert.update bloğu passwordHash'i tazelemiyordu, yani
    // aynı e-posta ile eski bir Customer varsa yeni geçici parola hash'i DB'ye
    // yazılmıyor; admin'e dönen "tek kullanımlık parola" hiçbir zaman hesabın
    // gerçek hash'i ile eşleşmiyordu → "invalid credentials".
    // #H-3 — Override sadece "ilk parolasını henüz değiştirmemiş" kullanıcılar
    // için güvenli. Aktif (mustChangePassword=false) bir customer hesabını
    // silsiz overlap eden ikinci başvuru ile resetlemek hesap ele geçirmeye
    // davetiye çıkarır: kötü niyetli biri kurbanın e-postasıyla başvuru
    // yapar, admin sosyal mühendislikle onaylar, parola sıfırlanır. Bu nedenle
    // aktif hesap varsa 409 ile engelliyor ve manuel müdahale istiyoruz.
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, mustChangePassword: true },
    });
    const isExistingCustomer = existingCustomer !== null;
    if (existingCustomer && !existingCustomer.mustChangePassword) {
      throw new ConflictException(
        'Bu e-posta adresine bağlı aktif bir bayi hesabı zaten var. ' +
          'Parola sıfırlama için müşteri kendi panelinden istek atmalı; ' +
          'admin bu akışta hesabı override edemez.',
      );
    }

    const [, customer] = await this.prisma.$transaction([
      this.prisma.dealerApplication.update({
        where: { id: application.id },
        data: { status: 'APPROVED' },
      }),
      this.prisma.customer.upsert({
        where: { email: normalizedEmail },
        update: {
          // Mevcut Customer kaydının parolası TAZELENİR — admin onay akışı
          // kullanıcıya yeni geçici parola yayınlar; eski hash ile login imkansız
          // olduğu için aksi halde bug #9 tekrarlanır.
          passwordHash,
          mustChangePassword: true,
          // Tek aktivasyon kuralı: approve = aktive et. Customers sayfasındaki
          // "Aktive Et" akışıyla drift olmasın.
          isActive: true,
          name: application.name,
          phone: phoneNormalized,
          // Başvuru profil verileri — varsa doldur (mevcut değeri null'la ezme).
          ...(application.company ? { companyTitle: application.company } : {}),
          ...(application.vergiNo ? routeTaxId(application.vergiNo) : {}),
          ...(application.vergiDairesi
            ? { vergiDairesi: application.vergiDairesi }
            : {}),
        },
        create: {
          email: normalizedEmail,
          passwordHash,
          name: application.name,
          phone: phoneNormalized,
          companyTitle: application.company ?? null,
          ...routeTaxId(application.vergiNo),
          vergiDairesi: application.vergiDairesi ?? null,
          discountPercent: 0,
          mustChangePassword: true,
          isActive: true,
        },
        select: { id: true, email: true, name: true, phone: true },
      }),
    ]);

    // Bayilik onaylandı → müşteri aktif; bayiNo yoksa hemen ata.
    await this.assignBayiNoSafe(customer.id);

    if (isExistingCustomer) {
      // Audit trail — admin response gövdesinde dönen "tek kullanımlık parola"
      // mevcut bir hesabı override etti. Operasyonel inceleme için log'lanır
      // (parola loglanmaz; sadece event + email).
      this.logger.log(
        `[DEALER-APPROVAL] Existing customer password reset for ${normalizedEmail}`,
      );
    }

    if (formId) {
      await this.prisma.form.update({
        where: { id: formId },
        data: { status: 'HANDLED', handledAt: new Date() },
      });
    }

    void (async () => {
      try {
        const adminLabel = actor.name?.trim() || actor.email || 'Admin';
        await this.audit.record({
          action: 'DEALER_APPLICATION_APPROVE',
          summary: `${adminLabel} ${application.name} (${normalizedEmail}) bayilik başvurusunu onayladı`,
          actor: {
            type: 'admin',
            id: actor.id,
            name: actor.name ?? null,
            email: actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: {
            id: application.id,
            type: 'dealer_application',
            label: application.name,
          },
          extra: {
            applicationEmail: normalizedEmail,
            createdCustomerId: customer.id,
            formId: formId ?? null,
            tempPasswordIssued: true,
            existingCustomerOverridden: isExistingCustomer,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record DEALER_APPLICATION_APPROVE audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    // Hoş geldin e-postası — üretilen parolayı müşteriye iletir. SMTP
    // yapılandırılmamışsa MailService log'a düşürür; admin yine de response
    // gövdesindeki `oneTimePassword` ile parolaya erişebilir.
    void this.sendDealerWelcomeEmail({
      to: normalizedEmail,
      name: application.name,
      tempPassword,
    });

    this.logger.log(
      JSON.stringify({
        event: 'dealer.application.approved',
        applicationId: application.id,
        formId: formId ?? null,
        customerId: customer.id,
        email: normalizedEmail,
      }),
    );

    return {
      success: true,
      data: {
        alreadyApproved: false,
        application: { id: application.id, status: 'APPROVED' },
        customer,
        // Üretilen tek kullanımlık parola — yalnızca bu çağrının response'unda
        // döner; tekrar onaylama (idempotent path) bu değeri ÜRETMEZ. Admin
        // bu değeri başka yerde saklamamalı; müşteri ilk girişte değiştirmek
        // zorunda (mustChangePassword = true).
        oneTimePassword: tempPassword,
      },
    };
  }

  /**
   * Bayi onay e-postası — donotreply hesabından, MailService.sendDealerWelcome
   * üzerinden gönderilir. SMTP_HOST yoksa MailService log'a düşürür ve sessiz
   * geçer. Kritik bir akış değil — başarısız olursa onay yine geçerli kalır
   * (admin response gövdesindeki parolayı manuel iletebilir).
   */
  private async sendDealerWelcomeEmail(payload: {
    to: string;
    name: string;
    tempPassword: string;
  }): Promise<void> {
    try {
      await this.mail.sendDealerWelcome({
        to: payload.to,
        name: payload.name,
        tempPassword: payload.tempPassword,
      });
    } catch (err) {
      this.logger.warn(
        `dealer welcome mail failed (non-fatal) email=${payload.to} err=${
          (err as Error).message
        }`,
      );
    }
  }

  async rejectApplication(
    applicationId: string,
    actor: { id: string; tenantId: string; name?: string | null; email?: string | null },
    req?: Request | null,
  ) {
    const { application, formId } = await this.resolveApplicationOrFromForm(
      applicationId,
    );
    if (!application) throw new NotFoundException('application not found');

    const updated = await this.prisma.dealerApplication.update({
      where: { id: application.id },
      data: { status: 'REJECTED' },
    });

    // Auto pre-register sırasında oluşturulmuş PASİF Customer kaydını da temizle.
    // Sadece henüz aktive edilmemiş kayıt silinir (isActive=false +
    // mustChangePassword=true). Admin tarafından aktive edilmiş bayi varsa
    // dokunulmaz — manuel müdahale gerektirir.
    const normalizedEmail = application.email.trim().toLowerCase();
    let passiveCustomerDeleted = false;
    const passiveCustomer = await this.prisma.customer.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, isActive: true, mustChangePassword: true },
    });
    if (
      passiveCustomer &&
      passiveCustomer.isActive === false &&
      passiveCustomer.mustChangePassword === true
    ) {
      try {
        await this.prisma.customer.delete({ where: { id: passiveCustomer.id } });
        passiveCustomerDeleted = true;
      } catch (err) {
        this.logger.warn(
          `reject: passive customer delete failed (non-fatal) customerId=${passiveCustomer.id} err=${(err as Error).message}`,
        );
      }
    }

    if (formId) {
      await this.prisma.form.update({
        where: { id: formId },
        data: { status: 'HANDLED', handledAt: new Date() },
      });
    }

    void (async () => {
      try {
        const adminLabel = actor.name?.trim() || actor.email || 'Admin';
        await this.audit.record({
          action: 'DEALER_APPLICATION_REJECT',
          summary: `${adminLabel} ${application.name} (${application.email}) bayilik başvurusunu reddetti`,
          actor: {
            type: 'admin',
            id: actor.id,
            name: actor.name ?? null,
            email: actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: {
            id: application.id,
            type: 'dealer_application',
            label: application.name,
          },
          extra: {
            applicationEmail: application.email,
            formId: formId ?? null,
            passiveCustomerDeleted,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record DEALER_APPLICATION_REJECT audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    return { success: true, data: updated };
  }

  /**
   * Onay/red işlemini geri alır — `DealerApplication.status` PENDING'e döner,
   * varsa Form.status NEW olur. Onay sırasında User yaratıldıysa User aktif
   * kalır (kullanıcı hesabını silmek mantıksal olarak yıkıcı; manuel müdahale
   * gerektirebilir).
   */
  async undoApplication(
    applicationId: string,
    actor: { id: string; tenantId: string; name?: string | null; email?: string | null },
    req?: Request | null,
  ) {
    const { application, formId } = await this.resolveApplicationOrFromForm(
      applicationId,
    );
    if (!application) throw new NotFoundException('application not found');

    const updated = await this.prisma.dealerApplication.update({
      where: { id: application.id },
      data: { status: 'PENDING' },
    });
    if (formId) {
      await this.prisma.form.update({
        where: { id: formId },
        data: { status: 'NEW', handledAt: null },
      });
    }
    void (async () => {
      try {
        const adminLabel = actor.name?.trim() || actor.email || 'Admin';
        await this.audit.record({
          action: 'DEALER_APPLICATION_UNDO',
          summary: `${adminLabel} ${application.name} (${application.email}) başvurusunu bekleyen durumuna geri aldı`,
          actor: {
            type: 'admin',
            id: actor.id,
            name: actor.name ?? null,
            email: actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: {
            id: application.id,
            type: 'dealer_application',
            label: application.name,
          },
          extra: { applicationEmail: application.email, formId: formId ?? null },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record DEALER_APPLICATION_UNDO audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();
    return { success: true, data: updated };
  }

  /**
   * Ön kayıt — bayi başvurusunu onaylamadan önce Customer kaydını pasif olarak
   * oluşturur. E-posta GÖNDERİLMEZ; `Customer.isActive=false` nedeniyle müşteri
   * henüz giriş yapamaz. Admin ayarları yapıp `activateCustomer()` çağırınca
   * hesap aktif olur ve hoş geldin maili o zaman gider.
   */
  async preRegisterApplication(
    applicationId: string,
    actor: { id: string; tenantId: string; name?: string | null; email?: string | null },
    req?: Request | null,
  ) {
    const { application, formId } = await this.resolveApplicationOrFromForm(
      applicationId,
    );
    if (!application) throw new NotFoundException('application not found');

    if (application.status === 'APPROVED') {
      throw new BadRequestException('Başvuru zaten onaylanmış.');
    }
    if (application.status === 'PRE_REGISTERED') {
      // Idempotent
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { email: application.email.trim().toLowerCase() },
        select: { id: true, email: true, name: true, isActive: true },
      });
      return { success: true, data: { alreadyPreRegistered: true, application, customer: existingCustomer ?? null } };
    }

    const normalizedEmail = application.email.trim().toLowerCase();

    const conflictUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, role: true },
    });
    if (conflictUser && conflictUser.role !== 'CUSTOMER') {
      throw new ConflictException(
        'Bu e-posta adresi zaten bir yönetici hesabına atanmış.',
      );
    }

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, mustChangePassword: true, isActive: true },
    });
    if (existingCustomer && !existingCustomer.mustChangePassword) {
      throw new ConflictException(
        'Bu e-posta adresine bağlı aktif bir bayi hesabı zaten var.',
      );
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const phoneNormalized = normalizeTrPhone(application.phone) ?? application.phone;

    const [, customer] = await this.prisma.$transaction([
      this.prisma.dealerApplication.update({
        where: { id: application.id },
        data: { status: 'PRE_REGISTERED' },
      }),
      this.prisma.customer.upsert({
        where: { email: normalizedEmail },
        update: {
          passwordHash,
          mustChangePassword: true,
          isActive: false,
          name: application.name,
          phone: phoneNormalized,
        },
        create: {
          email: normalizedEmail,
          passwordHash,
          name: application.name,
          phone: phoneNormalized,
          vergiDairesi: application.vergiDairesi ?? null,
          discountPercent: 0,
          mustChangePassword: true,
          isActive: false,
        },
        select: { id: true, email: true, name: true, phone: true, isActive: true },
      }),
    ]);

    // Müşteri ön-kayıt edildi → bayiNo yoksa hemen ata.
    await this.assignBayiNoSafe(customer.id);

    if (formId) {
      await this.prisma.form.update({
        where: { id: formId },
        data: { status: 'HANDLED', handledAt: new Date() },
      });
    }

    void (async () => {
      try {
        const adminLabel = actor.name?.trim() || actor.email || 'Admin';
        await this.audit.record({
          action: 'DEALER_APPLICATION_PRE_REGISTER',
          summary: `${adminLabel} ${application.name} (${normalizedEmail}) için ön kayıt oluşturdu`,
          actor: {
            type: 'admin',
            id: actor.id,
            name: actor.name ?? null,
            email: actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: {
            id: application.id,
            type: 'dealer_application',
            label: application.name,
          },
          extra: {
            applicationEmail: normalizedEmail,
            createdCustomerId: customer.id,
            formId: formId ?? null,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record DEALER_APPLICATION_PRE_REGISTER audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    this.logger.log(
      JSON.stringify({
        event: 'dealer.application.pre_registered',
        applicationId: application.id,
        customerId: customer.id,
        email: normalizedEmail,
      }),
    );

    return {
      success: true,
      data: {
        alreadyPreRegistered: false,
        application: { id: application.id, status: 'PRE_REGISTERED' },
        customer,
        // Şifre henüz müşteriye GÖNDERİLMEDİ — aktivasyon sonrası gidecek.
        // Admin bu şifreyi şimdi görmez; aktivasyon adımında taze şifre üretilir.
      },
    };
  }
}

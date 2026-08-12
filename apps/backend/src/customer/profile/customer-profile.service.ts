import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordCryptoService } from '../../vault/password-crypto.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { normalizeTrPhone } from '../../common/utils/phone';
import { formatCompanyAddress, type AddressParts } from '../../common/utils/address';

const BCRYPT_ROUNDS = 12;

interface CustomerBrief {
  name?: string | null;
  email?: string | null;
}

function customerLabel(c: CustomerBrief | null | undefined): string {
  if (!c) return 'Müşteri';
  const trimmed = c.name?.trim();
  if (trimmed) return trimmed;
  if (c.email) return c.email;
  return 'Müşteri';
}

const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: 'Ad Soyad',
  phone: 'Telefon',
  email: 'E-posta',
  birthDate: 'Doğum tarihi',
  language: 'Dil',
  timezone: 'Saat dilimi',
  companyTitle: 'Firma unvanı',
  vergiNo: 'Vergi numarası',
  vergiDairesi: 'Vergi dairesi',
  mersisNumber: 'MERSİS numarası',
  companyAddress: 'Firma adresi',
  contactName: 'İletişim kişisi',
  contactPhone: 'İletişim telefonu',
  contactEmail: 'İletişim e-postası',
  orderConfirmEmailEnabled: 'Sipariş onay e-postası',
  orderStatusEmailEnabled: 'Sipariş durum e-postası',
};

function formatAddress(a: {
  title?: string | null;
  fullName?: string | null;
  line1?: string | null;
  city?: string | null;
} | null | undefined): string {
  if (!a) return 'Adres';
  const parts = [a.title, a.fullName, a.city].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  if (parts.length) return parts.join(' • ');
  return 'Adres';
}

@Injectable()
export class CustomerProfileService {
  private readonly logger = new Logger(CustomerProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordCrypto: PasswordCryptoService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        birthDate: true,
        language: true,
        timezone: true,
        companyTitle: true,
        vergiNo: true,
        vergiDairesi: true,
        mersisNumber: true,
        companyAddress: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        discountPercent: true,
        mustChangePassword: true,
        profileCompleted: true,
        orderConfirmEmailEnabled: true,
        orderStatusEmailEnabled: true,
        vacationMode: true,
        vacationStartedAt: true,
        createdAt: true,
        // Adres defteri — müşteri kendi profilinde de adreslerini görsün
        // (companyAddress boş kalsa bile "adres yok" gibi görünmesin).
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            fullName: true,
            phone: true,
            line1: true,
            line2: true,
            city: true,
            district: true,
            postalCode: true,
            country: true,
            isDefault: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('customer not found');
    return { success: true, data: customer };
  }

  async updateProfile(
    customerId: string,
    dto: UpdateProfileDto,
    req?: Request | null,
  ) {
    // E-posta normalize (trim + lowercase): login normalizeEmail ile AYNI.
    // Aksi halde "Bayi@Firma.com" gibi büyük harfli kayıt müşteriyi kendi
    // hesabından kilitler (login lowercase'e çevirip arar → bulamaz). Çakışma
    // kontrolü de normalize edilmiş değerle yapılır (case-sensitive ikiz kayıt
    // oluşmasını engeller).
    const normalizedEmail =
      dto.email !== undefined ? dto.email.trim().toLowerCase() : undefined;
    if (normalizedEmail) {
      const conflict = await this.prisma.customer.findFirst({
        where: { email: normalizedEmail, NOT: { id: customerId } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('Email already in use');
    }

    // Önceki snapshot — audit diff için
    const before = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true, phone: true, email: true,
        birthDate: true, language: true, timezone: true,
        companyTitle: true, vergiNo: true, vergiDairesi: true,
        mersisNumber: true, companyAddress: true,
        contactName: true, contactPhone: true, contactEmail: true,
        orderConfirmEmailEnabled: true, orderStatusEmailEnabled: true,
      },
    });

    const data: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) {
      data.phone = dto.phone ? normalizeTrPhone(dto.phone) ?? dto.phone : null;
    }
    if (dto.email !== undefined) data.email = normalizedEmail;

    // Kişisel bilgiler
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate || null;
    if (dto.language !== undefined) data.language = dto.language;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;

    // Firma bilgileri
    if (dto.companyTitle !== undefined) data.companyTitle = dto.companyTitle || null;
    if (dto.vergiNo !== undefined) data.vergiNo = dto.vergiNo || null;
    if (dto.vergiDairesi !== undefined) data.vergiDairesi = dto.vergiDairesi || null;
    if (dto.mersisNumber !== undefined) data.mersisNumber = dto.mersisNumber || null;
    if (dto.companyAddress !== undefined) data.companyAddress = dto.companyAddress || null;

    // İletişim bilgileri
    if (dto.contactName !== undefined) data.contactName = dto.contactName || null;
    if (dto.contactPhone !== undefined) {
      data.contactPhone = dto.contactPhone ? normalizeTrPhone(dto.contactPhone) ?? dto.contactPhone : null;
    }
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail || null;

    // E-posta bildirim tercihleri (opsiyonel sipariş maillerini aç/kapat)
    if (dto.orderConfirmEmailEnabled !== undefined) {
      data.orderConfirmEmailEnabled = dto.orderConfirmEmailEnabled;
    }
    if (dto.orderStatusEmailEnabled !== undefined) {
      data.orderStatusEmailEnabled = dto.orderStatusEmailEnabled;
    }

    // Profil tamamlandı olarak işaretle — ad ve telefon doluysa
    const effectiveName = dto.name ?? before?.name;
    const effectivePhone = dto.phone !== undefined ? dto.phone : before?.phone;
    if (effectiveName && effectiveName.trim() && effectivePhone && effectivePhone.trim()) {
      data.profileCompleted = true;
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data,
      select: {
        id: true, email: true, name: true, phone: true,
        birthDate: true, language: true, timezone: true,
        companyTitle: true, vergiNo: true, vergiDairesi: true,
        mersisNumber: true, companyAddress: true,
        contactName: true, contactPhone: true, contactEmail: true,
        orderConfirmEmailEnabled: true, orderStatusEmailEnabled: true,
        profileCompleted: true, updatedAt: true,
      },
    });

    // Audit — değişen alanları diff ile yaz
    void (async () => {
      try {
        const changedFields: string[] = [];
        const beforeSnap: Record<string, unknown> = {};
        const afterSnap: Record<string, unknown> = {};
        for (const key of Object.keys(PROFILE_FIELD_LABELS)) {
          const k = key as keyof typeof PROFILE_FIELD_LABELS;
          const beforeVal = before ? (before as Record<string, unknown>)[k] : undefined;
          const afterVal = (updated as Record<string, unknown>)[k];
          if (beforeVal !== afterVal) {
            const beforeStr = beforeVal instanceof Date ? beforeVal.toISOString() : beforeVal;
            const afterStr = afterVal instanceof Date ? afterVal.toISOString() : afterVal;
            if (beforeStr !== afterStr) {
              changedFields.push(PROFILE_FIELD_LABELS[k]);
              beforeSnap[k] = beforeStr ?? null;
              afterSnap[k] = afterStr ?? null;
            }
          }
        }

        const cLabel = customerLabel(updated);
        const summary = changedFields.length
          ? `${cLabel} profil bilgilerini güncelledi (${changedFields.join(', ')})`
          : `${cLabel} profil bilgilerini güncelledi`;

        await this.audit.record({
          action: 'CUSTOMER_PROFILE_UPDATE',
          summary,
          actor: {
            type: 'customer',
            id: customerId,
            name: updated.name ?? null,
            email: updated.email ?? null,
          },
          target: {
            id: customerId,
            type: 'customer',
            label: cLabel,
          },
          before: beforeSnap,
          after: afterSnap,
          extra: { changedFields },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_PROFILE_UPDATE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: updated };
  }

  async changePassword(
    customerId: string,
    dto: ChangePasswordDto,
    req?: Request | null,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        passwordHash: true,
        mustChangePassword: true,
        name: true,
        email: true,
      },
    });
    if (!customer) throw new NotFoundException('customer not found');

    // mustChangePassword=true ise admin tarafından sabit "toptan1234"e
    // sıfırlanmış (veya bayi onayı sırasında random tek kullanımlık parola
    // verilmiş) demektir. Current password kontrolü yine yapılır (mevcut
    // parola doğrulanmalı); başarısızlığında 401 — sıfırlama bilgisi UI'ya
    // iletilir.
    const ok = await bcrypt.compare(dto.currentPassword, customer.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // Yeni şifre değiştiğinde sealed kopya da senkron tutulur — admin
    // "şifre görüntüle" eski plaintext'i değil her zaman güncelini gösterir.
    const encryptedPassword = this.passwordCrypto.seal(dto.newPassword);
    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        passwordHash,
        encryptedPassword,
        mustChangePassword: false,
        // Şifre değişti: bekleyen sıfırlama linkini geçersizle (henüz kullanılmamış
        // bir reset maili artık yeni şifreyi ezmesin). tokenVersion BURADA
        // ARTTIRILMAZ: kullanıcı kendi oturumunda bu isteği yaptı; bump onu anında
        // 401'e düşürürdü. Oturum-geçersizleme reset + admin yollarında yapılır.
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
      select: { email: true, name: true },
    });

    void this.mail
      .sendPasswordChanged({ to: updated.email, recipientName: updated.name ?? updated.email })
      .catch(() => undefined);

    void (async () => {
      try {
        const cLabel = customerLabel(updated);
        await this.audit.record({
          action: 'CUSTOMER_PASSWORD_CHANGE',
          summary: `${cLabel} kendi şifresini değiştirdi`,
          actor: {
            type: 'customer',
            id: customerId,
            name: updated.name ?? null,
            email: updated.email ?? null,
          },
          target: {
            id: customerId,
            type: 'customer',
            label: cLabel,
          },
          extra: { mustChangePassword: customer.mustChangePassword },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_PASSWORD_CHANGE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: { message: 'Password updated' } };
  }

  /**
   * Legacy `Customer.companyAddress` ("Firma Adresi" düz metni) ile yapısal
   * adres defterini senkron tutar: bir adres VARSAYILAN olduğunda, companyAddress
   * HÂLÂ BOŞSA onu bu adresten doldurur. Müşteri/admin'in elle girdiği dolu bir
   * companyAddress ASLA ezilmez (where guard: null/''). Aynı $transaction içinde
   * çağrılmalı (tek-default invariant'ıyla atomik kalsın). Idempotenttir.
   */
  private async syncCompanyAddressFromDefault(
    tx: Prisma.TransactionClient,
    customerId: string,
    addr: AddressParts,
  ): Promise<void> {
    const formatted = formatCompanyAddress(addr);
    if (!formatted) return;
    await tx.customer.updateMany({
      where: {
        id: customerId,
        OR: [{ companyAddress: null }, { companyAddress: '' }],
      },
      data: { companyAddress: formatted },
    });
  }

  async listAddresses(customerId: string) {
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        fullName: true,
        phone: true,
        line1: true,
        line2: true,
        city: true,
        district: true,
        postalCode: true,
        country: true,
        isDefault: true,
        createdAt: true,
      },
    });
    return { success: true, data: addresses };
  }

  /**
   * #H-TOCTOU — `updateMany({isDefault:false})` + `create({isDefault:true})`
   * iki ayrı statement olduğu için araya başka bir create giren bir paralel
   * istek hem onun hem de bu istek tarafından yazılan satırları "default"
   * olarak bırakabiliyordu (tek-default invariant kırılır). $transaction içine
   * sarılması setDefaultAddress'taki pattern ile tutarlı tek atomik birim
   * sağlar.
   */
  async createAddress(
    customerId: string,
    dto: CreateAddressDto,
    req?: Request | null,
  ) {
    const address = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId },
          data: { isDefault: false },
        });
      }
      const created = await tx.customerAddress.create({
        data: {
          customerId,
          title: dto.title ?? '',
          fullName: dto.fullName,
          phone: dto.phone ? normalizeTrPhone(dto.phone) ?? dto.phone : null,
          line1: dto.line1 ?? '',
          line2: dto.line2,
          city: dto.city ?? '',
          district: dto.district,
          postalCode: dto.postalCode,
          country: dto.country ?? 'TR',
          isDefault: dto.isDefault ?? false,
        },
        select: {
          id: true,
          title: true,
          fullName: true,
          line1: true,
          city: true,
          country: true,
          isDefault: true,
          createdAt: true,
        },
      });
      // Varsayılan adres eklendiyse legacy companyAddress'i (boşsa) doldur.
      if (created.isDefault) {
        await this.syncCompanyAddressFromDefault(tx, customerId, {
          line1: dto.line1,
          line2: dto.line2,
          city: dto.city,
          district: dto.district,
          postalCode: dto.postalCode,
        });
      }
      return created;
    });

    void (async () => {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { name: true, email: true },
        });
        const cLabel = customerLabel(customer);
        const addrLabel = formatAddress(address);
        const defaultSuffix = address.isDefault ? ' (varsayılan)' : '';
        await this.audit.record({
          action: 'CUSTOMER_ADDRESS_CREATE',
          summary: `${cLabel} yeni adres ekledi: ${addrLabel}${defaultSuffix}`,
          actor: {
            type: 'customer',
            id: customerId,
            name: customer?.name ?? null,
            email: customer?.email ?? null,
          },
          target: {
            id: address.id,
            type: 'customer_address',
            label: addrLabel,
          },
          after: address,
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_ADDRESS_CREATE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: address };
  }

  /**
   * Aynı TOCTOU sebebiyle (#H-TOCTOU) ownership doğrulama, default-flag reset
   * ve update tek transaction içinde çalışıyor. Address'in başka bir customer
   * tarafından silinmesi de update statement'ı `findFirst` koşuluyla atomik
   * eşleştirildiği için race değil 404 üretir.
   */
  async updateAddress(
    customerId: string,
    addressId: string,
    dto: UpdateAddressDto,
    req?: Request | null,
  ) {
    const data: Prisma.CustomerAddressUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) {
      data.phone = dto.phone ? normalizeTrPhone(dto.phone) ?? dto.phone : null;
    }
    if (dto.line1 !== undefined) data.line1 = dto.line1;
    if (dto.line2 !== undefined) data.line2 = dto.line2;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.district !== undefined) data.district = dto.district;
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    const beforeSnap = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
      select: {
        id: true,
        title: true,
        fullName: true,
        line1: true,
        city: true,
        country: true,
        isDefault: true,
      },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('address not found');

      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }

      const row = await tx.customerAddress.update({
        where: { id: addressId },
        data,
        select: {
          id: true,
          title: true,
          fullName: true,
          line1: true,
          line2: true,
          city: true,
          district: true,
          postalCode: true,
          country: true,
          isDefault: true,
          updatedAt: true,
        },
      });
      // Güncellenen adres varsayılan ise legacy companyAddress'i (boşsa) tazele.
      if (row.isDefault) {
        await this.syncCompanyAddressFromDefault(tx, customerId, row);
      }
      return row;
    });

    void (async () => {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { name: true, email: true },
        });
        const cLabel = customerLabel(customer);
        const addrLabel = formatAddress(updated);
        await this.audit.record({
          action: 'CUSTOMER_ADDRESS_UPDATE',
          summary: `${cLabel} adresi güncelledi: ${addrLabel}`,
          actor: {
            type: 'customer',
            id: customerId,
            name: customer?.name ?? null,
            email: customer?.email ?? null,
          },
          target: {
            id: addressId,
            type: 'customer_address',
            label: addrLabel,
          },
          before: beforeSnap ?? null,
          after: updated,
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_ADDRESS_UPDATE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: updated };
  }

  async deleteAddress(
    customerId: string,
    addressId: string,
    req?: Request | null,
  ) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
      select: {
        id: true,
        title: true,
        fullName: true,
        line1: true,
        city: true,
        country: true,
        isDefault: true,
      },
    });
    if (!existing) throw new NotFoundException('address not found');

    await this.prisma.customerAddress.delete({ where: { id: addressId } });

    void (async () => {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { name: true, email: true },
        });
        const cLabel = customerLabel(customer);
        const addrLabel = formatAddress(existing);
        await this.audit.record({
          action: 'CUSTOMER_ADDRESS_DELETE',
          summary: `${cLabel} adresi sildi: ${addrLabel}`,
          actor: {
            type: 'customer',
            id: customerId,
            name: customer?.name ?? null,
            email: customer?.email ?? null,
          },
          target: {
            id: addressId,
            type: 'customer_address',
            label: addrLabel,
          },
          before: existing,
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_ADDRESS_DELETE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: { deleted: true } };
  }

  /**
   * Bir adresi varsayılan yapar — aynı tx içinde diğer adreslerin
   * isDefault flag'ini false yapar, hedef adresin flag'ini true yapar.
   * Sadece müşterinin kendi adresleri üzerinde çalışır (ownership check).
   */
  async setDefaultAddress(
    customerId: string,
    addressId: string,
    req?: Request | null,
  ) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
      select: {
        id: true,
        title: true,
        fullName: true,
        line1: true,
        city: true,
        isDefault: true,
      },
    });
    if (!existing) throw new NotFoundException('address not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId, NOT: { id: addressId } },
        data: { isDefault: false },
      });
      const row = await tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: {
          id: true,
          title: true,
          fullName: true,
          line1: true,
          line2: true,
          city: true,
          district: true,
          postalCode: true,
          isDefault: true,
          updatedAt: true,
        },
      });
      // Yeni varsayılan adresten legacy companyAddress'i (boşsa) doldur.
      await this.syncCompanyAddressFromDefault(tx, customerId, row);
      return row;
    });

    void (async () => {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { name: true, email: true },
        });
        const cLabel = customerLabel(customer);
        const addrLabel = formatAddress(updated);
        await this.audit.record({
          action: 'CUSTOMER_ADDRESS_SET_DEFAULT',
          summary: `${cLabel} varsayılan adresini değiştirdi: ${addrLabel}`,
          actor: {
            type: 'customer',
            id: customerId,
            name: customer?.name ?? null,
            email: customer?.email ?? null,
          },
          target: {
            id: addressId,
            type: 'customer_address',
            label: addrLabel,
          },
          before: existing,
          after: updated,
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_ADDRESS_SET_DEFAULT audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true, data: updated };
  }

  /**
   * Müşteri kendi tatil modunu açar/kapatır — bayinin geçici olarak siparişe
   * kapalı olduğunu işaretler.
   */
  async setVacationMode(
    customerId: string,
    enabled: boolean,
    req?: Request | null,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        vacationMode: true,
      },
    });
    if (!existing) throw new NotFoundException('customer not found');

    if (existing.vacationMode === enabled) {
      return {
        success: true,
        data: { id: customerId, vacationMode: enabled, changed: false },
      };
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        vacationMode: enabled,
        vacationStartedAt: enabled ? new Date() : null,
      },
      select: { id: true, vacationMode: true, vacationStartedAt: true },
    });

    void (async () => {
      try {
        const cLabel = customerLabel(existing);
        await this.audit.record({
          action: enabled
            ? 'CUSTOMER_VACATION_ENABLED'
            : 'CUSTOMER_VACATION_DISABLED',
          summary: enabled
            ? `${cLabel} tatil modunu açtı (iade ilanları gizlendi)`
            : `${cLabel} tatil modunu kapattı (iade ilanları tekrar görünür)`,
          actor: {
            type: 'customer',
            id: customerId,
            name: existing.name ?? null,
            email: existing.email ?? null,
          },
          target: {
            id: customerId,
            type: 'customer',
            label: cLabel,
          },
          extra: { source: 'self' },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CUSTOMER_VACATION audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    void this.notifications
      .emit({
        type: 'customer.vacation',
        severity: enabled ? 'warning' : 'info',
        title: enabled ? 'Bayi tatil modunu açtı' : 'Bayi tatil modunu kapattı',
        body: enabled
          ? `${customerLabel(existing)} iade ilanlarını geçici olarak gizledi.`
          : `${customerLabel(existing)} iade ilanlarını tekrar görünür yaptı.`,
        link: `/customers/${customerId}`,
        data: {
          customerId,
          vacationMode: enabled,
          source: 'self',
        },
        audience: { role: 'ADMIN' },
      })
      .catch((e) =>
        this.logger.warn(
          `Failed to emit customer.vacation notification: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        ),
      );

    return { success: true, data: { ...updated, changed: true } };
  }

  async getOrder(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        status: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        kdvRate: true,
        currency: true,
        trackingNumber: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            unitPriceOriginal: true,
            discountPercent: true,
            qty: true,
          },
        },
        // KESKİN KURAL: ham event.description/location tedarikçi/otomasyon metni
        // taşır → müşteriye ASLA gönderilmez (yalnızca status + occurredAt).
        trackingEvents: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            status: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('order not found');

    return {
      success: true,
      data: {
        id: order.id,
        status: order.status,
        total: Number(order.total),
        subtotal: order.subtotal !== null ? Number(order.subtotal) : null,
        kdvAmount: order.kdvAmount !== null ? Number(order.kdvAmount) : null,
        kdvRate: order.kdvRate ?? null,
        currency: order.currency,
        trackingNumber: order.trackingNumber,
        items: order.items.map((i) => ({
          id: i.id,
          slug: i.productSlug,
          name: i.productName,
          price: Number(i.unitPrice),
          priceOriginal:
            i.unitPriceOriginal !== null ? Number(i.unitPriceOriginal) : null,
          discountPercent: i.discountPercent,
          qty: i.qty,
        })),
        timeline: order.trackingEvents,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    };
  }
}

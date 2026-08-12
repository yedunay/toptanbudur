import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PasswordCryptoService } from '../vault/password-crypto.service';
import { AuditService } from '../audit/audit.service';
import { LoginCustomerDto } from './dto/login-customer.dto';

/**
 * Customer.email Postgres unique index'i case-sensitive — login lookup'unun
 * dealer onay akışı (DealerService.approveApplication) ile aynı kanonik formu
 * kullanması için tek noktadan trim+lowercase uyguluyoruz. Aksi halde
 * "Firma@X.com" başvurusu sonrası "firma@x.com" ile login → invalid creds (#9).
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * #2 — Per-(e-posta + IP) başarısız giriş sayacı. Brute-force'a karşı
 * @Throttle (per-IP 10/dk) ile birlikte ikinci savunma hattı: 15 dakikalık
 * kayan pencerede 10 başarısız denemeden sonra hesap-IP çifti kilitlenir ve
 * müşteriye kalan deneme sayısı gösterilir.
 *
 * Tasarım notu: Proje tek backend instance olarak (nginx arkasında) çalıştığı
 * için basit in-memory TTL Map yeterli. Çok-instance'a geçilirse Redis'e
 * taşınmalı. Map sınırsız büyümesin diye her okuma/yazmada süresi dolmuş
 * kayıtlar temizlenir (lazy GC).
 */
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 dakika

interface LoginAttemptEntry {
  count: number;
  /** Pencere bitiş zamanı (epoch ms) — bu zamandan sonra sayaç sıfırlanır. */
  expiresAt: number;
}

const loginAttempts = new Map<string, LoginAttemptEntry>();

function attemptKey(email: string, ip: string): string {
  return `${email}|${ip}`;
}

function pruneExpiredAttempts(now: number): void {
  for (const [key, entry] of loginAttempts) {
    if (entry.expiresAt <= now) loginAttempts.delete(key);
  }
}

const BCRYPT_ROUNDS = 12;

/** Şifre sıfırlama token'ı geçerlilik süresi — 5 dakika (kullanıcı isteği). */
const RESET_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Manuel "şifremi unuttum" için e-posta bazlı yeniden-gönderim cooldown'ı.
 * Bu süre içinde aynı e-postaya YENİ token/mail üretilmez (mevcut token korunur)
 * — IP'den bağımsız mail-bomb + devam eden reset'i ezme (griefing) koruması.
 */
const MANUAL_REISSUE_COOLDOWN_MS = 60 * 1000;

/**
 * Ardışık YANLIŞ ŞİFRE eşiği. Var olan + aktif bir bayide bu kadar üst üste
 * yanlış şifre girilince self-servis sıfırlama linki OTOMATİK mail atılır
 * (mevcut şifre DEĞİŞMEZ). E-posta bazlı sayılır (IP'den bağımsız).
 */
const AUTO_RESET_THRESHOLD = 3;

/**
 * E-posta bazlı ardışık yanlış-şifre sayacı — 3-yanlış oto-tetik için.
 * loginAttempts'ten AYRI: yalnız var olan+aktif hesapta PASSWORD_MISMATCH'te
 * artar (enumeration'a katkısı yok; hiçbir yere sızmaz), başarıda/reset'te
 * sıfırlanır. Aynı LOGIN_LOCK_WINDOW_MS penceresini kullanır.
 */
const passwordMismatchStreak = new Map<string, LoginAttemptEntry>();

/**
 * 256-bit güvenli sıfırlama token'ı üretir. Ham token yalnız mailde taşınır;
 * DB'ye SHA-256 hash'i yazılır (DB sızsa bile token kullanılamaz).
 */
function generateResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashResetToken(raw: string): string {
  // trim: validate ve reset uçları AYNI kanonik girdiyi hash'lemeli — bazı mail
  // istemcileri linke sondan boşluk/CRLF ekleyebilir.
  return createHash('sha256')
    .update((raw ?? '').trim())
    .digest('hex');
}

/**
 * Dummy bcrypt hash — login'de kullanıcı yok / passwordHash yokken gerçek
 * bcrypt.compare kadar zaman harcayıp timing-tabanlı e-posta enumeration'ını
 * kapatmak için karşılaştırılır. GEÇERLİ bir hash olmalı (aksi halde compare
 * işi yapmadan döner) → modül yüklenişinde bir kez üretilir.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS);

export interface CustomerSummary {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  discountPercent: number;
  profitDiscountPercent: number;
  supplierDiscounts: {
    supplierId: string;
    discountPercent: number;
    profitDiscountPercent: number;
    adminDiscount: boolean;
  }[];
  xmlToken: string | null;
  mustChangePassword: boolean;
  profileCompleted: boolean;
  customerStatus: 'STANDARD' | 'ADMIN_DISCOUNT';
}

export interface CustomerAuthResult {
  accessToken: string;
  customer: CustomerSummary;
  mustChangePassword: boolean;
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly passwordCrypto: PasswordCryptoService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginCustomerDto, ip?: string): Promise<CustomerAuthResult> {
    const email = normalizeEmail(dto.email);
    const clientIp = (ip ?? '').trim() || 'unknown';
    const key = attemptKey(email, clientIp);

    // Kilitliyse hemen reddet — bcrypt karşılaştırması bile yapma.
    this.assertNotLocked(key);

    const customer = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (!customer) {
      // Timing enumeration'ı kapat: kayıtlı e-postadaki bcrypt.compare kadar
      // zaman harca ki "hesap var mı" gecikme farkından anlaşılmasın.
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      this.logFailureReason('EMAIL_NOT_FOUND', email);
      throw this.invalidCredentials('EMAIL_NOT_FOUND', key);
    }
    if (!customer.passwordHash) {
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      this.logFailureReason('NO_PASSWORD_HASH', email);
      throw this.invalidCredentials('NO_PASSWORD_HASH', key);
    }

    const ok = await bcrypt.compare(dto.password, customer.passwordHash);
    if (!ok) {
      this.logFailureReason('PASSWORD_MISMATCH', email);
      // 3-yanlış oto-tetik: var olan+aktif bayide ardışık yanlış şifreyi say;
      // eşiğe ulaşınca sıfırlama linki maili gönder (mevcut şifre değişmez).
      this.noteFailedPassword(customer);
      throw this.invalidCredentials('PASSWORD_MISMATCH', key);
    }

    if (customer.isActive === false) {
      this.logger.warn(`customer login blocked isActive=false email=${email}`);
      // isActive=false hatalı şifre değil — sayacı artırma; ama başarılı
      // kimlik doğrulama da değil, bu yüzden mevcut sayaç olduğu gibi kalır.
      throw new ForbiddenException(
        'Hesabınız henüz aktive edilmemiş. Lütfen sistem yöneticinizle iletişime geçin.',
      );
    }

    // Başarılı giriş → bu e-posta için tüm başarısız-deneme sayaçlarını sıfırla.
    loginAttempts.delete(key);
    passwordMismatchStreak.delete(email);

    return this.buildToken(customer);
  }

  /**
   * Pencere içinde MAX_LOGIN_ATTEMPTS'e ulaşılmışsa kilit hatası fırlatır.
   * Pencere süresi dolmuşsa kayıt temizlenir ve geçişe izin verilir.
   */
  private assertNotLocked(key: string): void {
    const now = Date.now();
    pruneExpiredAttempts(now);
    const entry = loginAttempts.get(key);
    if (entry && entry.expiresAt > now && entry.count >= MAX_LOGIN_ATTEMPTS) {
      throw new UnauthorizedException(
        'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.',
      );
    }
  }

  /**
   * Tüm ortamlarda generic 401 mesajı — e-posta enumeration'a karşı koruma.
   * Root cause kodu (EMAIL_NOT_FOUND / NO_PASSWORD_HASH / PASSWORD_MISMATCH)
   * sadece sunucu log'una düşer (logFailureReason); response gövdesine asla
   * sızdırılmaz, çünkü dev/staging cevapları da pentestlerde delil oluyordu.
   *
   * #2: Başarısız deneme sayacını (e-posta+IP) artırır. Mesaj kalan deneme
   * sayısını gösterir; sayaç limite ulaşınca 15 dakikalık kilit mesajı döner.
   * Sayaç e-posta varlığını sızdırmaz — hem var olmayan hem yanlış-şifre
   * durumunda aynı şekilde artar.
   */
  private invalidCredentials(_code: string, key: string): UnauthorizedException {
    const now = Date.now();
    pruneExpiredAttempts(now);
    const entry = loginAttempts.get(key);
    let count: number;
    if (entry && entry.expiresAt > now) {
      count = entry.count + 1;
      entry.count = count;
      // Pencereyi son denemeden itibaren kaydırmıyoruz; ilk hatalı denemeden
      // başlayan sabit 15 dk pencere içinde sayıyoruz (expiresAt sabit kalır).
    } else {
      count = 1;
      loginAttempts.set(key, {
        count,
        expiresAt: now + LOGIN_LOCK_WINDOW_MS,
      });
    }

    if (count >= MAX_LOGIN_ATTEMPTS) {
      return new UnauthorizedException(
        'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.',
      );
    }
    const remaining = MAX_LOGIN_ATTEMPTS - count;
    return new UnauthorizedException(
      `Hatalı e-posta veya şifre. Kalan deneme: ${remaining}`,
    );
  }

  private logFailureReason(code: string, email: string): void {
    // Sadece sunucu log'una düşer — gerçek nedeni operasyonel ekip görür.
    this.logger.warn(
      `customer login failed code=${code} email=${email}`,
    );
  }

  // ─── Şifre sıfırlama (forgot-password) ──────────────────────────────────────

  /**
   * Buton akışı: bayi "şifremi unuttum" der. Kayıtlı + aktif bir hesap varsa
   * 5 dk geçerli sıfırlama linki maili gönderilir; aksi halde SESSİZCE hiçbir
   * şey yapılmaz (bayi değilse/pasifse mail gitmez). Yanıt HER DURUMDA aynıdır
   * (generic) — e-posta enumeration ve timing sızıntısını önlemek için gerçek
   * iş fire-and-forget yürütülür.
   */
  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    const normalized = normalizeEmail(email);
    // Manuel yolda da e-posta bazlı cooldown uygula → mail-bomb/griefing kapanır.
    void this.maybeIssueResetToken(normalized, {
      reissueCooldownMs: MANUAL_REISSUE_COOLDOWN_MS,
    });
    return { ok: true };
  }

  /**
   * Link akışı: bayi maildeki linke tıklayıp yeni şifresini belirler. Token
   * geçersiz/süresi dolmuş/hesap pasif ise generic hata döner (enumeration yok).
   * Başarıda şifre + vault kopyası güncellenir, token tek-kullanım silinir,
   * login kilitleri temizlenir, onay maili + audit yazılır.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
    req?: Request | null,
  ): Promise<{ ok: true }> {
    const hash = hashResetToken(rawToken);
    const customer = await this.prisma.customer.findUnique({
      where: { passwordResetTokenHash: hash },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        passwordResetExpiresAt: true,
      },
    });
    if (
      !customer ||
      customer.isActive === false ||
      !customer.passwordResetExpiresAt ||
      customer.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'Bağlantı geçersiz veya süresi dolmuş. Lütfen giriş ekranından tekrar şifre sıfırlama talebinde bulunun.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Admin "şifre görüntüle" senkron kalsın diye sealed kopya da güncellenir
    // (customer-profile.service.changePassword ile aynı desen).
    const encryptedPassword = this.passwordCrypto.seal(newPassword);
    // Tek-kullanım'ı DB seviyesinde atomik garanti et: koşullu updateMany yalnız
    // token hash HÂLÂ eşleşiyorsa yazar (ensureXmlTokenV2 ile aynı TOCTOU-güvenli
    // desen). Eşzamanlı ikinci istek 0 satır günceller → replay reddedilir.
    // tokenVersion +1 → reset öncesi verilmiş tüm oturumlar (7 gün) geçersizleşir.
    const result = await this.prisma.customer.updateMany({
      where: { id: customer.id, passwordResetTokenHash: hash },
      data: {
        passwordHash,
        encryptedPassword,
        mustChangePassword: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    if (result.count === 0) {
      // Token bu arada kullanıldı/yenilendi — replay.
      throw new BadRequestException(
        'Bağlantı geçersiz veya süresi dolmuş. Lütfen giriş ekranından tekrar şifre sıfırlama talebinde bulunun.',
      );
    }

    // Bayi hemen giriş yapabilsin: bu e-postaya ait tüm login kilitlerini temizle.
    this.clearLoginState(customer.email);

    void this.mail
      .sendPasswordChanged({
        to: customer.email,
        recipientName: customer.name?.trim() || customer.email,
      })
      .catch(() => undefined);

    void this.audit
      .record({
        action: 'CUSTOMER_PASSWORD_RESET',
        summary: `${customer.name?.trim() || customer.email} şifresini sıfırlama linkiyle güncelledi`,
        actor: {
          type: 'customer',
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
        target: { id: customer.id, type: 'customer', label: customer.email },
        req: req ?? null,
      })
      .catch(() => undefined);

    return { ok: true };
  }

  /** Reset sayfası formu göstermeden önce token'ı doğrular (süre/aktiflik). */
  async validateResetToken(rawToken: string): Promise<{ valid: boolean }> {
    const raw = (rawToken ?? '').trim();
    if (!raw) return { valid: false };
    const hash = hashResetToken(raw);
    const customer = await this.prisma.customer.findUnique({
      where: { passwordResetTokenHash: hash },
      select: { isActive: true, passwordResetExpiresAt: true },
    });
    const valid =
      !!customer &&
      customer.isActive !== false &&
      !!customer.passwordResetExpiresAt &&
      customer.passwordResetExpiresAt.getTime() > Date.now();
    return { valid };
  }

  /**
   * Kayıtlı + aktif hesaba sıfırlama token'ı üretir, DB'ye hash+expiry yazar ve
   * link mailini gönderir. `reissueCooldownMs`: son token bu süre içinde
   * üretilmişse YENİ token/mail üretmez (mevcut token korunur) — hem manuel yolda
   * mail-bomb/griefing, hem oto-tetik yolda tekrar-gönderim koruması. Tüm hatalar
   * yutulur — çağıran generic yanıt döndürür / login akışını bloke etmez.
   */
  private async maybeIssueResetToken(
    email: string,
    opts: { reissueCooldownMs: number },
  ): Promise<void> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          passwordResetExpiresAt: true,
        },
      });
      if (!customer || customer.isActive === false) return;
      // Cooldown: son token'ın üretim anı = expiresAt - TTL. Bu andan itibaren
      // cooldown geçmediyse yeni token/mail üretme (mevcut token dokunulmaz).
      if (customer.passwordResetExpiresAt) {
        const lastIssuedAt =
          customer.passwordResetExpiresAt.getTime() - RESET_TOKEN_TTL_MS;
        if (Date.now() - lastIssuedAt < opts.reissueCooldownMs) return;
      }

      const { raw, hash } = generateResetToken();
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          passwordResetTokenHash: hash,
          passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = `${this.storefrontBaseUrl()}/sifre-sifirla?token=${raw}`;
      await this.mail.sendPasswordReset({
        to: customer.email,
        recipientName: customer.name?.trim() || customer.email,
        resetUrl,
      });
    } catch (e) {
      this.logger.warn(
        `password reset issue failed email=${email}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * 3-yanlış oto-tetik sayacı. Yalnız var olan + aktif hesapta çağrılır (login
   * PASSWORD_MISMATCH dalından). Eşiğe TAM ulaşıldığında bir kez link maili
   * tetikler; TTL kadarlık reissue cooldown'ı tekrar-göndermeyi engeller.
   */
  private noteFailedPassword(customer: {
    email: string;
    isActive: boolean;
  }): void {
    if (customer.isActive === false) return;
    const now = Date.now();
    for (const [key, entry] of passwordMismatchStreak) {
      if (entry.expiresAt <= now) passwordMismatchStreak.delete(key);
    }
    const entry = passwordMismatchStreak.get(customer.email);
    let count: number;
    if (entry && entry.expiresAt > now) {
      count = entry.count + 1;
      entry.count = count;
    } else {
      count = 1;
      passwordMismatchStreak.set(customer.email, {
        count,
        expiresAt: now + LOGIN_LOCK_WINDOW_MS,
      });
    }
    if (count === AUTO_RESET_THRESHOLD) {
      // Oto-tetik: aktif (süresi geçmemiş) token varsa yeni mail atma → cooldown
      // = tam TTL (5 dk) demektir.
      void this.maybeIssueResetToken(customer.email, {
        reissueCooldownMs: RESET_TOKEN_TTL_MS,
      });
    }
  }

  /** Bir e-postaya ait tüm login kilidi/sayaç durumunu temizler. */
  private clearLoginState(email: string): void {
    const prefix = `${email}|`;
    for (const key of loginAttempts.keys()) {
      if (key.startsWith(prefix)) loginAttempts.delete(key);
    }
    passwordMismatchStreak.delete(email);
  }

  private storefrontBaseUrl(): string {
    const raw =
      this.config.get<string>('STOREFRONT_URL') ?? 'http://localhost:3001';
    return raw.replace(/\/+$/, '');
  }

  async getById(customerId: string): Promise<CustomerSummary> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        supplierDiscounts: {
          select: {
            supplierId: true,
            discountPercent: true,
            profitDiscountPercent: true,
            adminDiscount: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      discountPercent: customer.discountPercent,
      profitDiscountPercent: customer.profitDiscountPercent,
      supplierDiscounts: customer.supplierDiscounts,
      // Müşteri-yüzlü token artık V2 token'ı. Legacy xmlToken arka planda
      // çalışmaya devam eder ama UI'a expose edilmez.
      xmlToken: customer.xmlTokenV2,
      mustChangePassword: customer.mustChangePassword,
      profileCompleted: customer.profileCompleted,
      customerStatus: (customer.customerStatus ?? 'STANDARD') as
        | 'STANDARD'
        | 'ADMIN_DISCOUNT',
    };
  }

  async listOrders(customerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        total: true,
        currency: true,
        status: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            qty: true,
          },
        },
      },
    });

    return orders.map((o) => ({
      id: o.id,
      total: Number(o.total),
      currency: o.currency,
      status: o.status,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({
        id: i.id,
        slug: i.productSlug,
        name: i.productName,
        price: Number(i.unitPrice),
        qty: i.qty,
      })),
    }));
  }

  private async buildToken(customer: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
  }): Promise<CustomerAuthResult> {
    const xmlToken = await this.ensureXmlTokenV2(customer.id);
    // V3 (doğru-kategori) feed token'ını da garanti et — tüm müşteriler panelde
    // yeni doğru-kategorili XML'leri görür. xmlToken/xmlTokenV2'ye dokunmaz.
    await this.ensureXmlTokenV3(customer.id);
    const full = await this.prisma.customer.findUnique({
      where: { id: customer.id },
      select: {
        discountPercent: true,
        profitDiscountPercent: true,
        mustChangePassword: true,
        profileCompleted: true,
        customerStatus: true,
        tokenVersion: true,
        supplierDiscounts: {
          select: {
            supplierId: true,
            discountPercent: true,
            profitDiscountPercent: true,
            adminDiscount: true,
          },
        },
      },
    });
    // JWT'ye oturum sürümünü (`ver`) göm — şifre değişince guard eski token'ları
    // reddeder. Token bu yüzden `full` fetch'inden SONRA imzalanır.
    const accessToken = this.jwt.sign({
      sub: customer.id,
      email: customer.email,
      type: 'customer',
      ver: full?.tokenVersion ?? 0,
    });
    const mustChangePassword = full?.mustChangePassword ?? false;
    return {
      accessToken,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        discountPercent: full?.discountPercent ?? 0,
        profitDiscountPercent: full?.profitDiscountPercent ?? 0,
        supplierDiscounts: full?.supplierDiscounts ?? [],
        xmlToken,
        mustChangePassword,
        profileCompleted: full?.profileCompleted ?? false,
        customerStatus: (full?.customerStatus ?? 'STANDARD') as
          | 'STANDARD'
          | 'ADMIN_DISCOUNT',
      },
      mustChangePassword,
    };
  }

  /// V2 XML feed token'ını garanti eder — müşteride yoksa üretir.
  /// Profil ekranındaki 5 part link bu token ile kurulur.
  ///
  /// NOT: legacy `xmlToken` alanına ARTIK hiç dokunulmaz. Yeni müşteriler
  /// legacy token almaz (null kalır); mevcut müşterilerin legacy token'ı
  /// entegrasyona verilmiş haliyle olduğu gibi korunur. Bu metot yalnızca
  /// `xmlTokenV2` ile ilgilenir.
  ///
  /// H-7: Eşzamanlı login isteklerinde TOCTOU yarışı vardı; `updateMany` +
  /// null guard sayesinde yalnızca ilk yazıcı kazanır, ikincisi 0 satır
  /// günceller ve mevcut token'ı geri okur.
  private async ensureXmlTokenV2(customerId: string): Promise<string> {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { xmlTokenV2: true },
    });
    if (existing?.xmlTokenV2) return existing.xmlTokenV2;

    const token = generateToken();
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, xmlTokenV2: null },
      data: { xmlTokenV2: token },
    });
    if (result.count === 1) return token;

    const reread = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { xmlTokenV2: true },
    });
    if (!reread?.xmlTokenV2) {
      // Mantıksal olarak buraya düşmemeli (updateMany 0 → başkası yazmış olmalı).
      throw new Error('ensureXmlTokenV2: token persist failed');
    }
    return reread.xmlTokenV2;
  }

  /// V3 (doğru-kategori) XML feed token'ını garanti eder — yoksa üretir.
  /// ensureXmlTokenV2 ile AYNI TOCTOU-güvenli desen. xmlToken/xmlTokenV2'ye
  /// dokunmaz; yalnız xmlTokenV3 ile ilgilenir. Tüm müşteriler için çağrılır.
  private async ensureXmlTokenV3(customerId: string): Promise<string> {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { xmlTokenV3: true },
    });
    if (existing?.xmlTokenV3) return existing.xmlTokenV3;

    const token = generateToken();
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, xmlTokenV3: null },
      data: { xmlTokenV3: token },
    });
    if (result.count === 1) return token;

    const reread = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { xmlTokenV3: true },
    });
    if (!reread?.xmlTokenV3) {
      throw new Error('ensureXmlTokenV3: token persist failed');
    }
    return reread.xmlTokenV3;
  }
}

function generateToken(): string {
  // Cryptographically secure XML feed token (uzun ömürlü API anahtarı).
  // Math.random() güvenli değildir; randomBytes işletim sistemi CSPRNG'sini
  // kullanır. 24 byte = 192 bit entropi.
  return randomBytes(24).toString('hex');
}

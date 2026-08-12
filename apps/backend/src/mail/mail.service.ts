import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  renderOrderConfirmation,
  renderOrderPreparing,
  renderOrderStatusChanged,
  renderOrderCancelledRefund,
  renderCariRequestReceived,
  renderCariApproved,
  renderCariRejected,
  renderTopupRequestReceived,
  renderTopupApproved,
  renderTopupRejected,
  renderGiftBalanceGranted,
  renderSupportReply,
  renderSupportReceived,
  renderDealerWelcome,
  renderDealerApplicationReceived,
  renderPasswordChanged,
  renderPasswordReset,
  renderAdminNewAdmin,
  renderAdminNewDeviceLogin,
  renderAdminNewSupplier,
  renderAdminLargeTopup,
  renderAdminNewOrder,
} from './templates';
import {
  renderAdminNewContactForm,
  renderAdminNewDealerApplication,
  renderAdminNewSupportMessage,
  renderAdminNewTopupRequest,
  renderAdminNewCariPaymentRequest,
  renderAdminSupplierLowBalance,
  renderAdminConversationMessage,
  renderAdminBotPurchaseFailed,
  contactFormTypeLabel,
} from './admin-templates';

interface OrderItemSummary {
  name: string;
  qty: number;
  unitPrice: number;
}

export interface OrderConfirmationPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  total: number;
  subtotal: number;
  kdvAmount: number;
  packagingCost?: number | null;
  /** Kart komisyonu (KDV dahil brüt) — kartlı ödemede; mailde ayrı satır. */
  cardCommissionAmount?: number | null;
  currency: string;
  items: OrderItemSummary[];
  paymentType?: string | null;
  marketplace?: string | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  cariBalanceBefore?: number | null;
  cariBalanceAfter?: number | null;
}

export interface OrderPreparingPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  marketplace?: string | null;
}

export interface OrderStatusChangedPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  fromLabel: string;
  toLabel: string;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  marketplace?: string | null;
  note?: string | null;
}

export interface OrderCancelledRefundPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  refundAmount: number;
  previousBalance: number;
  newBalance: number;
  currency?: string;
  reason?: string | null;
}

export interface DealerApplicationReceivedPayload {
  to: string;
  name: string;
  email: string;
  phone: string;
  company?: string | null;
  message?: string | null;
}

export interface SupportReceivedPayload {
  to: string;
  recipientName: string;
  subject?: string | null;
  message: string;
}

export interface PasswordChangedPayload {
  to: string;
  recipientName: string;
}

export interface PasswordResetPayload {
  to: string;
  recipientName: string;
  /** 5 dk geçerli tek-kullanımlık sıfırlama URL'i (ham token URL'de). */
  resetUrl: string;
}

export interface AdminNotifyPayload {
  to: string | string[];
  subject: string;
  html: string;
}

export interface CariRequestReceivedPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  amount: number;
  currency: string;
}

export interface CariDecisionPayload {
  to: string;
  customerName: string;
  humanOrderNo: string | null;
  amount: number;
  currency: string;
  note?: string | null;
}

export interface TopupRequestReceivedPayload {
  to: string;
  customerName: string;
  amount: number;
  currency: string;
  humanTopupNo?: string | null;
}

export interface TopupDecisionPayload {
  to: string;
  customerName: string;
  amount: number;
  currency: string;
  note?: string | null;
  humanTopupNo?: string | null;
}

export interface GiftBalancePayload {
  to: string;
  customerName: string;
  /** Tanımlanan hediye tutarı. */
  amount: number;
  /** Hediye öncesi cari bakiye. */
  previousBalance: number;
  /** Hediye sonrası yeni cari bakiye. */
  newBalance: number;
  currency: string;
  /** Admin'in eklediği opsiyonel kişisel mesaj/kampanya notu. */
  note?: string | null;
}

export interface SupportReplyPayload {
  to: string;
  recipientName: string;
  subject: string;
  /** Bizim yanıtımız (adminNote). */
  body: string;
  /** Müşterinin ilk talep metni — mailde birebir gösterilir. */
  originalMessage?: string | null;
  orderNumber?: string | null;
  category?: string | null;
  createdAt?: Date | null;
}

export interface DealerWelcomePayload {
  to: string;
  name: string;
  tempPassword: string;
  loginUrl?: string;
}

export type MailAccount = 'donotreply' | 'info';

/** Nodemailer ek dosyası — Buffer içerikli (örn. CSV raporu). */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendHtmlOptions {
  account?: MailAccount;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: MailAttachment[];
  /**
   * true ise SMTP yapılandırılmamışsa (stub mod) VEYA gönderim hata verirse
   * HATA FIRLATIR (yutmaz). Statü değişikliğini "gerçekten gönderildi mi"ye
   * bağlamak gereken akışlar (Toptan Budur Excel botu) bunu kullanır.
   */
  throwOnError?: boolean;
}

interface AccountConfig {
  user: string;
  pass: string;
  from: string;
  transporter: Transporter;
}

/** E-posta gönderen adı / konu başlıklarında görünen firma adı (env'den). */
const COMPANY_NAME = process.env.COMPANY_NAME?.trim() || 'Toptan Budur';

/**
 * H-31: Mail header injection guard. Nodemailer'a giden subject/replyTo/to/cc/bcc
 * alanlarında CR (\r), LF (\n) veya NUL karakterleri varsa saldırgan SMTP
 * header'ları enjekte edebilir (örn. "Subject: x\r\nBcc: attacker@..."). Bu
 * yardımcı her header değerini tek-satırlık ve kontrol-karakteri içermeyen
 * forma indirger.
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}

function sanitizeAddress(value: string | string[]): string | string[] {
  if (Array.isArray(value)) return value.map(sanitizeHeader);
  return sanitizeHeader(value);
}

function sanitizeOptionalAddress(
  value: string | string[] | undefined,
): string | string[] | undefined {
  if (value === undefined) return undefined;
  return sanitizeAddress(value);
}

/**
 * HTML gövdesinden okunabilir düz-metin (text/plain) üretir. HTML-only mailler
 * spam filtrelerinde ciddi puan kaybettirir; her mail'e multipart text alternatif
 * eklemek teslimatı belirgin iyileştirir. Basit ama yeterli bir dönüştürücü:
 * blok etiketlerini satır sonuna çevirir, kalan etiketleri atar, HTML
 * entity'lerini çözer.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private accounts = new Map<MailAccount, AccountConfig>();

  /**
   * SMTP gönderim hız sınırı — relay'in (kurumsaleposta) giden-posta spam
   * filtresi "kısa sürede ardışık gönderim"i toplu mail sayıp 550 [SSP-02]
   * ile durduruyor (2026-07-13 destek yanıtı). Ardışık gönderimler arasına
   * en az MAIL_MIN_GAP_MS + rastgele jitter konur; tekil mail beklemez.
   */
  private static readonly MAIL_MIN_GAP_MS = 4_000;
  private static readonly MAIL_JITTER_MS = 2_000;
  private lastSmtpSendAt = 0;
  private smtpQueueTail: Promise<unknown> = Promise.resolve();

  /**
   * Gönderimi sıraya alır: bir önceki SMTP gönderiminden bu yana
   * MAIL_MIN_GAP_MS geçmediyse aradaki fark + jitter kadar bekler.
   * Hata çağırana aynen yansır; kuyruk sonraki mail için ayakta kalır.
   */
  private enqueueSmtpSend<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.smtpQueueTail.then(async () => {
      const wait =
        this.lastSmtpSendAt + MailService.MAIL_MIN_GAP_MS - Date.now();
      if (wait > 0) {
        const jitter = Math.floor(Math.random() * MailService.MAIL_JITTER_MS);
        await new Promise((r) => setTimeout(r, wait + jitter));
      }
      try {
        return await fn();
      } finally {
        this.lastSmtpSendAt = Date.now();
      }
    });
    // Reddedilen link kuyruğu kilitlemesin — hata yalnız çağırana gider.
    this.smtpQueueTail = run.catch(() => undefined);
    return run;
  }
  /**
   * DKIM imza yapılandırması. Yalnız SMTP_DKIM_PRIVATE_KEY_B64 tanımlıysa dolar;
   * yoksa undefined kalır ve mailler imzasız gider (mevcut davranış). DKIM,
   * SPF+DMARC ile birlikte maillerin spam yerine gelen kutusuna düşmesini sağlar.
   */
  private dkim?: {
    domainName: string;
    keySelector: string;
    privateKey: string;
    skipFields: string;
  };

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);

    // DKIM: private key base64 olarak env'de tutulur (.env tek-satır dostu).
    // Public key DNS'e s?._domainkey TXT olarak eklenmelidir (canonicalization
    // nodemailer default'u relaxed/relaxed → relay ufak reformat yapsa bile
    // imza korunur).
    const dkimB64 = this.config.get<string>('SMTP_DKIM_PRIVATE_KEY_B64');
    if (dkimB64) {
      const donotreplyUser =
        this.config.get<string>('SMTP_DONOTREPLY_USER') ?? '';
      const domainName =
        this.config.get<string>('SMTP_DKIM_DOMAIN') ||
        donotreplyUser.split('@')[1] ||
        'toptanbudur.com';
      this.dkim = {
        domainName,
        keySelector: this.config.get<string>('SMTP_DKIM_SELECTOR') || 's1',
        privateKey: Buffer.from(dkimB64, 'base64').toString('utf8'),
        // Relay (Natro smarthost) Message-ID/Date'i yeniden yazarsa imza
        // kırılmasın diye bu iki alan imzalanmaz; From/To/Subject/body imzalı
        // kalır — DMARC hizalaması From üzerinden korunur.
        skipFields: 'message-id:date',
      };
      this.logger.log(
        `DKIM signing enabled domain=${this.dkim.domainName} selector=${this.dkim.keySelector}`,
      );
    }

    if (!host) {
      this.logger.warn(
        'SMTP_HOST not set — mail service will log payloads instead of sending',
      );
      return;
    }

    this.registerAccount('donotreply', host, port, {
      user: this.config.get<string>('SMTP_DONOTREPLY_USER'),
      pass: this.config.get<string>('SMTP_DONOTREPLY_PASS'),
      fromName:
        this.config.get<string>('SMTP_DONOTREPLY_FROM_NAME') ?? COMPANY_NAME,
    });

    this.registerAccount('info', host, port, {
      user: this.config.get<string>('SMTP_INFO_USER'),
      pass: this.config.get<string>('SMTP_INFO_PASS'),
      fromName: this.config.get<string>('SMTP_INFO_FROM_NAME') ?? COMPANY_NAME,
    });

    if (this.accounts.size === 0) {
      this.logger.warn(
        'SMTP credentials missing for both accounts — falling back to log-only mode',
      );
    }
  }

  private registerAccount(
    account: MailAccount,
    host: string,
    port: number,
    creds: { user?: string; pass?: string; fromName: string },
  ): void {
    if (!creds.user || !creds.pass) {
      this.logger.warn(
        `SMTP creds missing for "${account}" — emails for this sender will be skipped`,
      );
      return;
    }
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: creds.user, pass: creds.pass },
      // DKIM imzası (yapılandırılmışsa). Gönderdiğimiz her mail bu özel anahtarla
      // imzalanır; alıcı sunucu DNS'teki public key ile doğrular → gelen kutusu.
      ...(this.dkim ? { dkim: this.dkim } : {}),
    });
    this.accounts.set(account, {
      user: creds.user,
      pass: creds.pass,
      from: `"${creds.fromName}" <${creds.user}>`,
      transporter,
    });
    this.logger.log(
      `SMTP account "${account}" ready user=${creds.user} host=${host} port=${port}`,
    );
  }

  /**
   * Generic HTML mail sender. Other functions should compose their HTML and
   * call this method, choosing which sender account to use:
   *  - "donotreply" → transactional / system notifications (default)
   *  - "info"       → human-facing replies & support correspondence
   */
  async sendHtml(opts: SendHtmlOptions): Promise<void> {
    const account: MailAccount = opts.account ?? 'donotreply';
    const cfg = this.accounts.get(account);

    // H-31: Header injection guard — saldırgan adres veya subject alanına
    // \r\n yerleştirip Bcc/From override edemesin. HTML body header değil,
    // sanitize edilmez.
    const safeTo = sanitizeAddress(opts.to);
    const safeSubject = sanitizeHeader(opts.subject);
    const safeReplyTo = opts.replyTo ? sanitizeHeader(opts.replyTo) : undefined;
    const safeCc = sanitizeOptionalAddress(opts.cc);
    const safeBcc = sanitizeOptionalAddress(opts.bcc);

    const recipients = Array.isArray(safeTo) ? safeTo.join(',') : safeTo;

    const attachmentNote = opts.attachments?.length
      ? ` attachments=${opts.attachments.length}`
      : '';

    if (!cfg) {
      this.logger.log(
        `[mail-stub account=${account}] to=${recipients} subject="${safeSubject}" htmlLen=${opts.html.length}${attachmentNote}`,
      );
      if (opts.throwOnError) {
        throw new Error(
          `SMTP yapılandırılmamış (account=${account}) — mail gönderilemedi`,
        );
      }
      return;
    }

    try {
      await this.enqueueSmtpSend(() =>
        cfg.transporter.sendMail({
          from: cfg.from,
          to: safeTo,
          subject: safeSubject,
          html: opts.html,
          // Multipart text/plain alternatif: HTML-only mail spam puanını yükseltir.
          text: htmlToText(opts.html),
          replyTo: safeReplyTo,
          cc: safeCc,
          bcc: safeBcc,
          attachments: opts.attachments,
        }),
      );
      this.logger.log(
        `mail sent account=${account} to=${recipients} subject="${safeSubject}"`,
      );
    } catch (err) {
      this.logger.error(
        `mail send failed account=${account} to=${recipients} subject="${safeSubject}"`,
        err as Error,
      );
      if (opts.throwOnError) throw err;
    }
  }

  async sendOrderConfirmation(
    payload: OrderConfirmationPayload,
  ): Promise<void> {
    const subject = `Siparişiniz alındı${
      payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''
    }`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderOrderConfirmation(payload),
    });
  }

  async sendCariRequestReceived(
    payload: CariRequestReceivedPayload,
  ): Promise<void> {
    const subject = `Cariden ödeme talebiniz alındı${
      payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''
    }`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderCariRequestReceived(payload),
    });
  }

  async sendCariApproved(payload: CariDecisionPayload): Promise<void> {
    const subject = `Cariden ödeme talebiniz onaylandı${
      payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''
    }`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderCariApproved(payload),
    });
  }

  async sendCariRejected(payload: CariDecisionPayload): Promise<void> {
    const subject = `Cariden ödeme talebiniz reddedildi${
      payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''
    }`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderCariRejected(payload),
    });
  }

  async sendTopupRequestReceived(
    payload: TopupRequestReceivedPayload,
  ): Promise<void> {
    const ref = payload.humanTopupNo ? ` — ${payload.humanTopupNo}` : '';
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: `Cari yükleme talebiniz alındı${ref}`,
      html: renderTopupRequestReceived({
        customerName: payload.customerName,
        amount: payload.amount,
        currency: payload.currency,
        humanTopupNo: payload.humanTopupNo ?? null,
      }),
    });
  }

  async sendTopupApproved(payload: TopupDecisionPayload): Promise<void> {
    const ref = payload.humanTopupNo ? ` — ${payload.humanTopupNo}` : '';
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: `Cari yüklemeniz onaylandı${ref}`,
      html: renderTopupApproved({
        customerName: payload.customerName,
        amount: payload.amount,
        currency: payload.currency,
        note: payload.note ?? null,
        humanTopupNo: payload.humanTopupNo ?? null,
      }),
    });
  }

  async sendTopupRejected(payload: TopupDecisionPayload): Promise<void> {
    const ref = payload.humanTopupNo ? ` — ${payload.humanTopupNo}` : '';
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: `Cari yüklemeniz reddedildi${ref}`,
      html: renderTopupRejected({
        customerName: payload.customerName,
        amount: payload.amount,
        currency: payload.currency,
        note: payload.note ?? null,
        humanTopupNo: payload.humanTopupNo ?? null,
      }),
    });
  }

  async sendGiftBalanceGranted(payload: GiftBalancePayload): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: `🎁 Size özel hediye bakiye tanımlandı — ${COMPANY_NAME}`,
      html: renderGiftBalanceGranted({
        customerName: payload.customerName,
        amount: payload.amount,
        previousBalance: payload.previousBalance,
        newBalance: payload.newBalance,
        currency: payload.currency,
        note: payload.note ?? null,
      }),
    });
  }

  async sendSupportReply(payload: SupportReplyPayload): Promise<void> {
    const subject = payload.subject || `${COMPANY_NAME} destek yanıtı`;
    // Reply-To'yu gerçek/izlenen kutuya (info@) ayarla: müşteri "Yanıtla"
    // dediğinde donotreply çıkmazına düşmesin, mesajı bize ulaşsın.
    const infoUser = this.config.get<string>('SMTP_INFO_USER');
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderSupportReply(payload),
      replyTo: infoUser || undefined,
    });
  }

  async sendDealerWelcome(payload: DealerWelcomePayload): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: 'Bayi başvurunuz onaylandı — giriş bilgileriniz',
      html: renderDealerWelcome({
        name: payload.name,
        email: payload.to,
        tempPassword: payload.tempPassword,
        loginUrl: payload.loginUrl,
      }),
    });
  }

  async sendDealerApplicationReceived(
    payload: DealerApplicationReceivedPayload,
  ): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: 'Bayilik başvurunuz alındı',
      html: renderDealerApplicationReceived({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        company: payload.company,
        message: payload.message,
      }),
    });
  }

  async sendSupportReceived(payload: SupportReceivedPayload): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: 'Destek talebiniz alındı',
      html: renderSupportReceived({
        recipientName: payload.recipientName,
        subject: payload.subject,
        message: payload.message,
      }),
    });
  }

  async sendPasswordChanged(payload: PasswordChangedPayload): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: 'Şifreniz değiştirildi',
      html: renderPasswordChanged({ recipientName: payload.recipientName }),
    });
  }

  /**
   * Şifre sıfırlama (forgot-password) linki — 5 dk geçerli tek-kullanımlık
   * URL. Yalnızca kayıtlı + aktif bayilere gönderilir (çağıran taraf gate'ler).
   */
  async sendPasswordReset(payload: PasswordResetPayload): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject: 'Şifre sıfırlama talebi',
      html: renderPasswordReset({
        recipientName: payload.recipientName,
        resetUrl: payload.resetUrl,
      }),
    });
  }

  async sendOrderStatusChanged(
    payload: OrderStatusChangedPayload,
  ): Promise<void> {
    const subject = `Sipariş durumu güncellendi${payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''}`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderOrderStatusChanged({
        customerName: payload.customerName,
        humanOrderNo: payload.humanOrderNo,
        fromLabel: payload.fromLabel,
        toLabel: payload.toLabel,
        cargoCompany: payload.cargoCompany,
        cargoBarcode: payload.cargoBarcode,
        marketplace: payload.marketplace,
        note: payload.note,
      }),
    });
  }

  /**
   * Sipariş iptal edildiğinde — bedel cari hesaba iade edilmişse — müşteriye
   * "cari bakiyenize ekleme yapılmıştır" mailini önceki/yeni bakiye ile gönderir.
   * Tedarikçi kaynaklı iptal (bot) dahil her cari-iadeli iptalde tetiklenir.
   */
  async sendOrderCancelledRefund(
    payload: OrderCancelledRefundPayload,
  ): Promise<void> {
    const subject = `Siparişiniz iptal edildi — bedel cari hesabınıza eklendi${
      payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''
    }`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderOrderCancelledRefund({
        customerName: payload.customerName,
        humanOrderNo: payload.humanOrderNo,
        refundAmount: payload.refundAmount,
        previousBalance: payload.previousBalance,
        newBalance: payload.newBalance,
        currency: payload.currency ?? 'TL',
        reason: payload.reason ?? null,
      }),
    });
  }

  async sendOrderPreparing(payload: OrderPreparingPayload): Promise<void> {
    const subject = `Siparişiniz hazırlanıyor${payload.humanOrderNo ? ` — ${payload.humanOrderNo}` : ''}`;
    await this.sendHtml({
      account: 'donotreply',
      to: payload.to,
      subject,
      html: renderOrderPreparing({
        customerName: payload.customerName,
        humanOrderNo: payload.humanOrderNo,
        cargoCompany: payload.cargoCompany,
        cargoBarcode: payload.cargoBarcode,
        marketplace: payload.marketplace,
      }),
    });
  }

  async sendAdminNewAdmin(opts: {
    to: string | string[];
    newAdminName: string;
    newAdminEmail: string;
    addedByName: string;
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni yönetici eklendi: ${opts.newAdminEmail}`,
      html: renderAdminNewAdmin({
        newAdminName: opts.newAdminName,
        newAdminEmail: opts.newAdminEmail,
        addedByName: opts.addedByName,
      }),
    });
  }

  async sendAdminNewDeviceLogin(opts: {
    to: string | string[];
    userName: string;
    userEmail: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni cihazdan giriş yapıldı: ${opts.userEmail}`,
      html: renderAdminNewDeviceLogin({
        adminName: opts.userName,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        loginAt: new Date(),
      }),
    });
  }

  async sendAdminOtp(opts: {
    to: string;
    name: string;
    code: string;
  }): Promise<void> {
    await this.sendHtml({
      account: 'donotreply',
      to: opts.to,
      subject: `Giriş doğrulama kodunuz: ${opts.code}`,
      html: `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <tr><td style="background:#111827;padding:28px 40px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;">${COMPANY_NAME}</span>
      </td></tr>
      <tr><td style="padding:40px;">
        <p style="margin:0 0 8px;font-size:16px;color:#111827;">Merhaba ${opts.name},</p>
        <p style="margin:0 0 32px;font-size:14px;color:#6b7280;">Yönetim paneline yeni bir cihazdan giriş denemesi yapıldı. Aşağıdaki tek kullanımlık kodu girin:</p>
        <div style="text-align:center;margin:0 0 32px;">
          <span style="display:inline-block;background:#f3f4f6;border:2px dashed #d1d5db;border-radius:12px;padding:24px 48px;font-size:40px;font-weight:800;letter-spacing:12px;color:#111827;">${opts.code}</span>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center;">Bu kod <strong>10 dakika</strong> geçerlidir.</p>
        <p style="margin:0;font-size:13px;color:#ef4444;text-align:center;">Bu işlemi siz başlatmadıysanız hemen şifrenizi değiştirin.</p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">Bu e-posta otomatik olarak gönderilmiştir, lütfen yanıtlamayın.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
    });
  }

  async sendAdminNewSupplier(opts: {
    to: string | string[];
    supplierName: string;
    addedByName: string;
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni tedarikçi eklendi: ${opts.supplierName}`,
      html: renderAdminNewSupplier({
        supplierName: opts.supplierName,
        addedByName: opts.addedByName,
      }),
    });
  }

  async sendAdminNewOrder(opts: {
    to: string | string[];
    humanOrderNo: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    subtotal: number;
    kdvAmount: number;
    packagingCost?: number | null;
    total: number;
    currency: string;
    paymentType: string | null;
    items: OrderItemSummary[];
    cariBalanceBefore: number | null;
    cariBalanceAfter: number | null;
    marketplace: string | null;
    cargoCompany: string | null;
    cargoBarcode: string | null;
  }): Promise<void> {
    const label = opts.humanOrderNo ?? opts.customerName;
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni sipariş alındı — ${label}`,
      html: renderAdminNewOrder({
        humanOrderNo: opts.humanOrderNo,
        customerName: opts.customerName,
        customerEmail: opts.customerEmail,
        customerPhone: opts.customerPhone,
        subtotal: opts.subtotal,
        kdvAmount: opts.kdvAmount,
        packagingCost: opts.packagingCost ?? null,
        total: opts.total,
        currency: opts.currency,
        paymentType: opts.paymentType,
        items: opts.items,
        cariBalanceBefore: opts.cariBalanceBefore,
        cariBalanceAfter: opts.cariBalanceAfter,
        marketplace: opts.marketplace,
        cargoCompany: opts.cargoCompany,
        cargoBarcode: opts.cargoBarcode,
      }),
    });
  }

  async sendAdminLargeTopup(opts: {
    to: string | string[];
    customerName: string;
    customerEmail: string;
    amount: number;
    currency: string;
    approvedByName: string;
    humanTopupNo?: string | null;
  }): Promise<void> {
    const ref = opts.humanTopupNo ? ` ${opts.humanTopupNo} —` : '';
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yüksek tutarlı cari yükleme onaylandı${ref} ${opts.customerEmail}`,
      html: renderAdminLargeTopup({
        customerName: opts.customerName,
        customerEmail: opts.customerEmail,
        amount: opts.amount,
        currency: opts.currency,
        approvedByName: opts.approvedByName,
        humanTopupNo: opts.humanTopupNo ?? null,
      }),
    });
  }

  async sendAdminSupplierLowBalance(opts: {
    to: string | string[];
    supplierName: string;
    balance: number;
    threshold: number;
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Tedarikçi bakiyesi düşük — ${opts.supplierName}`,
      html: renderAdminSupplierLowBalance({
        supplierName: opts.supplierName,
        balance: opts.balance,
        threshold: opts.threshold,
      }),
    });
  }

  async sendAdminNewContactForm(opts: {
    to: string | string[];
    formType: 'CONTACT' | 'CALLBACK' | 'INTEGRATION';
    name: string;
    email: string | null;
    phone: string | null;
    company?: string | null;
    subject?: string | null;
    message: string;
    adminUrl?: string | null;
  }): Promise<void> {
    const typeLabel = contactFormTypeLabel(opts.formType);
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni ${typeLabel.toLowerCase()} — ${opts.name}`,
      html: renderAdminNewContactForm({
        formType: opts.formType,
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
        company: opts.company ?? null,
        subject: opts.subject ?? null,
        message: opts.message,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  async sendAdminNewDealerApplication(opts: {
    to: string | string[];
    applicantName: string;
    email: string;
    phone: string;
    company?: string | null;
    city?: string | null;
    message?: string | null;
    adminUrl?: string | null;
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni bayilik başvurusu — ${opts.applicantName}`,
      html: renderAdminNewDealerApplication({
        applicantName: opts.applicantName,
        email: opts.email,
        phone: opts.phone,
        company: opts.company ?? null,
        city: opts.city ?? null,
        message: opts.message ?? null,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  async sendAdminNewSupportMessage(opts: {
    to: string | string[];
    senderName: string;
    senderEmail: string;
    senderPhone?: string | null;
    subject?: string | null;
    message: string;
    adminUrl?: string | null;
  }): Promise<void> {
    const label = opts.subject ?? opts.senderName;
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni destek talebi — ${label}`,
      html: renderAdminNewSupportMessage({
        senderName: opts.senderName,
        senderEmail: opts.senderEmail,
        senderPhone: opts.senderPhone ?? null,
        subject: opts.subject ?? null,
        message: opts.message,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  /** Mevcut destek talebine / iade sohbetine müşteri yeni mesaj yazdığında. */
  async sendAdminConversationMessage(opts: {
    to: string | string[];
    kind: 'support' | 'return';
    senderName: string;
    senderEmail?: string | null;
    subject?: string | null;
    humanOrderNo?: string | null;
    message: string;
    adminUrl?: string | null;
  }): Promise<void> {
    const label =
      opts.subject ?? opts.humanOrderNo ?? opts.senderName;
    const prefix =
      opts.kind === 'return'
        ? '[Admin] İade sohbetine yeni mesaj'
        : '[Admin] Talebe yeni mesaj';
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `${prefix} — ${label}`,
      html: renderAdminConversationMessage({
        kind: opts.kind,
        senderName: opts.senderName,
        senderEmail: opts.senderEmail ?? null,
        subject: opts.subject ?? null,
        humanOrderNo: opts.humanOrderNo ?? null,
        message: opts.message,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  /** Satın alma botu siparişi tedarikçiden alamadığında — manuel alım gerekli. */
  async sendAdminBotPurchaseFailed(opts: {
    to: string | string[];
    humanOrderNo: string | null;
    customerName: string | null;
    supplierKey: string;
    lastError: string | null;
    adminUrl?: string | null;
  }): Promise<void> {
    const label = opts.humanOrderNo ?? opts.supplierKey;
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Bot siparişi alamadı — ${label}`,
      html: renderAdminBotPurchaseFailed({
        humanOrderNo: opts.humanOrderNo,
        customerName: opts.customerName,
        supplierKey: opts.supplierKey,
        lastError: opts.lastError,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  async sendAdminNewTopupRequest(opts: {
    to: string | string[];
    customerName: string;
    customerEmail: string | null;
    amount: number;
    currency: string;
    note?: string | null;
    adminUrl?: string | null;
    humanTopupNo?: string | null;
  }): Promise<void> {
    const label = opts.humanTopupNo
      ? `${opts.humanTopupNo} — ${opts.customerName}`
      : opts.customerName;
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni cari yükleme talebi — ${label}`,
      html: renderAdminNewTopupRequest({
        customerName: opts.customerName,
        customerEmail: opts.customerEmail,
        amount: opts.amount,
        currency: opts.currency,
        note: opts.note ?? null,
        adminUrl: opts.adminUrl ?? null,
        humanTopupNo: opts.humanTopupNo ?? null,
      }),
    });
  }

  async sendAdminNewCariPaymentRequest(opts: {
    to: string | string[];
    customerName: string;
    customerEmail: string | null;
    humanOrderNo: string | null;
    amount: number;
    currency: string;
    adminUrl?: string | null;
  }): Promise<void> {
    const label = opts.humanOrderNo ?? opts.customerName;
    await this.sendHtml({
      account: 'info',
      to: opts.to,
      subject: `[Admin] Yeni cariden ödeme talebi — ${label}`,
      html: renderAdminNewCariPaymentRequest({
        customerName: opts.customerName,
        customerEmail: opts.customerEmail,
        humanOrderNo: opts.humanOrderNo,
        amount: opts.amount,
        currency: opts.currency,
        adminUrl: opts.adminUrl ?? null,
      }),
    });
  }

  /**
   * Günlük Z raporu — admin'lere gönderilir.
   * HTML gövde + (opsiyonel) sipariş detayı CSV eki. HTML ve CSV `reports`
   * modülünde üretilir; bu metot yalnız taşıma katmanıdır.
   */
  async sendZReport(opts: {
    to: string | string[];
    subject: string;
    html: string;
    csv?: { filename: string; content: Buffer };
  }): Promise<void> {
    await this.sendHtml({
      account: 'info',
      // Z raporu için gönderim hatası SESSİZ KALAMAZ: hata fırlatılır ki
      // BullMQ job'ı failed'e düşsün ve retry mekanizması devreye girsin.
      // (2026-07: 9-13 Tem arası rapor 5 gece sessizce gitmedi — job
      // "completed" görünüyordu çünkü hata burada yutuluyordu.)
      throwOnError: true,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.csv
        ? [
            {
              filename: opts.csv.filename,
              content: opts.csv.content,
              contentType: 'text/csv; charset=utf-8',
            },
          ]
        : undefined,
    });
  }
}

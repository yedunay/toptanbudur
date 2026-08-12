import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ConversationSenderType,
  Prisma,
  ReturnFlowStatus,
  SupportMessageStatus,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import { detectMedia } from '../common/utils/image-magic-bytes';
import { detectPdf } from '../common/utils/pdf-magic-bytes';
import { trParts } from '../common/utils/tr-time';
import { resolveSupplierId } from '../profitability/supplier-attribution.util';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AdminOrdersService } from '../admin/orders/admin-orders.service';
import type { CreateSupportMessageDto } from './dto/create-support-message.dto';
import type { UpdateSupportMessageDto } from './dto/update-support-message.dto';
import type { ListSupportMessagesDto } from './dto/list-support-messages.dto';

/**
 * In-memory representation of a multipart file accepted by the controller.
 * Mirrors Multer's shape but kept narrow so the service does not depend on
 * any specific upload middleware.
 */
export interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB (foto+video, 2026-08-02)
const MAX_RETURN_INVOICE_BYTES = 10 * 1024 * 1024; // 10 MB (iade faturası PDF)

/**
 * İade talebi açıldığında sipariş faturalamadan tutulurken Order.billingNote'a
 * yazılan işaret. Reddedince YALNIZCA bu işareti taşıyan hold'u serbest bırakırız
 * (adminin elle koyduğu bir fatura-tutmayı ezmemek için).
 */
const RETURN_HOLD_NOTE = 'İade talebi bekliyor — fatura tutuldu';

/**
 * Bir talebin İADE niyetinde olup olmadığını belirler (admin panelindeki
 * detectTicketIntent 'refund' mantığının backend aynası). category='iade' ya da
 * konu/metin iade/geri-ödeme anahtar kelimeleri içeriyorsa true. Otomatik-akış
 * ÖNCESİ açılmış (returnStatus boş) eski iade taleplerinde admin'in aksiyon
 * alabilmesi (onay/ret/tamamla) için bu talepleri de "iade" say.
 */
function isReturnIntentTicket(
  category: string | null,
  subject: string | null,
  body: string | null,
): boolean {
  const cat = (category ?? '').toLocaleLowerCase('tr-TR').trim();
  if (cat === 'iade') return true;
  const text = `${subject ?? ''} ${body ?? ''}`.toLocaleLowerCase('tr-TR');
  return (
    /\biade\b/.test(text) ||
    text.includes('geri öde') ||
    text.includes('geri ode') ||
    text.includes('para iade') ||
    text.includes('refund')
  );
}

/**
 * Bir talep bu kadar gün boyunca HİÇ güncellenmediyse (updatedAt @updatedAt
 * herhangi bir status değişimi / yanıt ile tazelendiğinden, "son N gün boyunca
 * statü değişikliği görmediyse" demek) otomatik kapatılır (ARCHIVED). Müşterinin
 * "destek taleplerim" listesi çok sayıda açık talep ile dolup karışmasın diye.
 */
const SUPPORT_TICKET_STALE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Oto-iptal akışında "Cevaplandı" (REPLIED) yapılan ve siparişi ARTIK iptal
 * olan "iptal" talepleri, cevaplandıktan bu kadar süre sonra otomatik kapanır
 * (ARCHIVED) — talep admin/müşteri listesinde gereksiz açık kalmasın.
 */
const RESOLVED_CANCEL_CLOSE_MS = 5 * 60 * 1000; // 5 dakika

/**
 * "Talebiniz alındı" bilgilendirme e-postası, talep oluştuktan HEMEN sonra
 * değil bu kadar süre sonra gönderilir. Amaç: müşteride "talebim gerçek biri
 * tarafından görüldü / izleniyor" hissi (anlık robotik yanıt yerine). Bu
 * e-posta talebin statüsünü DEĞİŞTİRMEZ — talep admin'de "bekleyen" (NEW) +
 * kırmızı bildirim olarak kalır. Süre içinde talep yanıtlanır/kapanırsa
 * (REPLIED/ARCHIVED) bilgilendirme GÖNDERİLMEZ.
 */
const RECEIVED_ACK_DELAY_MS = 150 * 1000; // 150 saniye

/**
 * Oto-iptal onayında AdminOrdersService.updateOrder'a geçilen sistem actor
 * id'si. Gerçek bir User değildir; audit/iz için sentinel — orchestrator'lardaki
 * 'system-*' deseniyle aynı (actorId FK'siz olduğu için güvenli).
 */
const AUTO_CANCEL_ACTOR_ID = 'system-support-auto-cancel';

/// Oto-onayda müşteriye giden tek yanıt metni (sipariş iptal + cari iade).
function buildAutoCancelReply(
  customerName: string,
  orderNumber: string | null,
): string {
  const ad = customerName?.trim() ? customerName.trim() : 'Sayın müşterimiz';
  const sip = orderNumber
    ? `#${orderNumber} numaralı siparişinize`
    : 'siparişinize';
  return [
    `Merhaba ${ad},`,
    '',
    `${sip} ait iptal talebiniz onaylanmıştır. Siparişiniz iptal edilmiş ve ödediğiniz tutar cüzdan (cari) bakiyenize iade edilmiştir.`,
    '',
    'İlginiz için teşekkür ederiz.',
  ].join('\n');
}

/// Tedarikçi botu (status-poll) bir siparişi OTOMATİK iptale çektiğinde müşteriye
/// gidecek yanıt metni. Müşteri iptali kendisi TALEP ETMEDİĞİ için "talebiniz
/// onaylanmıştır" DENMEZ; nötr bir iptal bilgilendirmesidir. KURAL: müşteriye
/// tedarikçi adı/gerekçesi sızdırılmaz (customer-no-supplier-leak) — mesaj
/// tedarikçiden HİÇ bahsetmez. KURAL: ASLA özür/mağduriyet dili KULLANILMAZ
/// ("özür dileriz", "yaşanan olumsuzluk" vb. yasak); iptal + cari iade zaten
/// olumlu bir haberdir, kapanış pozitif ve güven veren tonda olur.
function buildSupplierAutoCancelReply(
  customerName: string | null,
  orderNumber: string | null,
  refunded: boolean,
): string {
  const ad = customerName?.trim() ? customerName.trim() : 'Sayın müşterimiz';
  const sip = orderNumber
    ? `#${orderNumber} numaralı siparişiniz`
    : 'siparişiniz';
  const lines = [`Merhaba ${ad},`, ''];
  if (refunded) {
    lines.push(
      `${sip} iptal edilmiştir. Ödediğiniz tutar cüzdan (cari) bakiyenize iade edilmiştir; dilediğiniz yeni siparişte kullanabilirsiniz.`,
    );
  } else {
    lines.push(`${sip} iptal edilmiştir.`);
  }
  lines.push('', 'İlginiz için teşekkür eder, iyi günler ve bol kazançlı satışlar dileriz.');
  return lines.join('\n');
}

/**
 * Bir siparişin kalemlerinden tedarikçi adını çözer. Öncelik HER YERDEKİ ile
 * aynı: elle override → snapshot → ürünün tedarikçisi. Sipariş tek-tedarikçi
 * olduğundan çoğu zaman tek ad döner; farklı tedarikçiler varsa " · " ile
 * birleştirir. Ad bulunamazsa null.
 */
function resolveOrderSupplierName(
  items: Array<{
    supplierOverride: { name: string } | null;
    supplierNameSnapshot: string | null;
    product: { supplier: { name: string } | null } | null;
  }>,
): string | null {
  const names = new Set<string>();
  for (const it of items) {
    const name =
      it.supplierOverride?.name ??
      it.supplierNameSnapshot ??
      it.product?.supplier?.name ??
      null;
    if (name) names.add(name);
  }
  return names.size ? Array.from(names).join(' · ') : null;
}

@Injectable()
export class SupportMessagesService {
  private readonly logger = new Logger(SupportMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
    private readonly adminOrders: AdminOrdersService,
    private readonly appSettings: AppSettingsService,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: IFileStorage,
  ) {}

  /**
   * Public endpoint: site contact form submission.
   *
   * DB hatalarını sessizce yutmuyoruz — controller bir 5xx üretir; bunu
   * yapan eski silent try/catch (`return { ok: true, id: '' }`) kayıp
   * ticket'lara yol açıyordu. Anonim ziyaretçiye yine generic mesaj gider
   * ama sunucuda hata Pino üzerinden görünür ve istemci retry yapabilir.
   */
  async create(
    dto: CreateSupportMessageDto,
    meta: {
      ip?: string | null;
      userAgent?: string | null;
      customerId?: string | null;
      attachments?: UploadedAttachment[];
      /** İADE akışı: müşterinin yüklediği iade faturası (PDF). Yalnız sipariş
       *  faturalandıysa zorunlu; faturasızsa opsiyonel/atlanır. */
      returnInvoice?: UploadedAttachment | null;
    },
    req?: Request | null,
  ): Promise<{ ok: true; id: string }> {
    // Validate attachments BEFORE entering the silent-error try block.
    // For authenticated callers we want surface-level rejection (4xx) on
    // bad files; for anonymous public form there are simply no attachments
    // attached so this is a no-op.
    type ValidatedAttachment = {
      original: UploadedAttachment;
      mimetype: string;
      extension: string;
    };
    const attachments = meta.attachments ?? [];
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new Error(
        `En fazla ${MAX_ATTACHMENTS} adet dosya yükleyebilirsiniz.`,
      );
    }
    const validated: ValidatedAttachment[] = attachments.map((file) => {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(
          `Dosya boyutu 100 MB sınırını aşıyor: ${file.originalname}`,
        );
      }
      // Foto + video kabulü (2026-08-02): iPhone HEIC/video reddi yüzünden
      // bayiler destek talebine hiç ek yükleyemiyordu.
      const detected = detectMedia(file.buffer);
      if (!detected) {
        throw new Error(
          `Desteklenmeyen dosya türü (fotoğraf veya video yükleyin): ${file.originalname}`,
        );
      }
      return {
        original: file,
        mimetype: detected.mimetype,
        extension: detected.extension,
      };
    });

    if (validated.length > 0 && !this.storage) {
      throw new Error('Dosya depolama servisi yapılandırılmamış.');
    }

    // ── İADE (return) TALEBİ KAPISI ──────────────────────────────────────────
    // Müşteri sipariş desteğinden "İade" seçtiğinde: (1) yalnız KARGOYA VERİLMİŞ
    // (shipped) sipariş iade edilebilir, (2) aynı sipariş için açık bir iade
    // talebi olamaz, (3) sipariş FATURALANDIYSA talebi açabilmek için İADE
    // FATURASI (PDF) yüklemek ZORUNLU (faturasızsa opsiyonel). Auto-onay YOK —
    // her iade admine düşer. returnStatus REQUESTED ile işaretlenir.
    let returnFlowOrderId: string | null = null;
    let validatedReturnInvoice: {
      buffer: Buffer;
      filename: string;
      size: number;
    } | null = null;
    if (dto.category === 'iade' && dto.orderId && meta.customerId) {
      const ord = await this.prisma.order.findFirst({
        where: { id: dto.orderId, customerId: meta.customerId },
        select: { id: true, status: true, invoicedAt: true },
      });
      if (!ord) throw new Error('Sipariş bulunamadı.');
      if (ord.status !== 'shipped') {
        throw new Error(
          'Yalnızca kargoya verilmiş siparişler için iade talebi açılabilir.',
        );
      }
      const openReturn = await this.prisma.supportMessage.findFirst({
        where: {
          orderId: ord.id,
          // SHIPPED_BACK de "açık" sayılır: müşteri ürünü yollamış ama iade henüz
          // tamamlanmamıştır → aynı sipariş için ikinci talep açılamaz.
          returnStatus: { in: ['REQUESTED', 'APPROVED', 'SHIPPED_BACK'] },
        },
        select: { id: true },
      });
      if (openReturn) {
        throw new Error('Bu sipariş için zaten açık bir iade talebiniz var.');
      }
      const invoiced = ord.invoicedAt !== null;
      if (invoiced && !meta.returnInvoice) {
        throw new Error(
          'Bu sipariş faturalandırıldığı için iade talebinizi açabilmek üzere iade faturası (PDF) yüklemeniz gerekir.',
        );
      }
      if (meta.returnInvoice) {
        const inv = meta.returnInvoice;
        if (inv.size > MAX_RETURN_INVOICE_BYTES) {
          throw new Error('İade faturası 10 MB sınırını aşıyor.');
        }
        if (!detectPdf(inv.buffer)) {
          throw new Error('İade faturası yalnızca PDF formatında olabilir.');
        }
        if (!this.storage) {
          throw new Error('Dosya depolama servisi yapılandırılmamış.');
        }
        validatedReturnInvoice = {
          buffer: inv.buffer,
          filename: inv.originalname.slice(0, 255),
          size: inv.size,
        };
      }
      returnFlowOrderId = ord.id;
    }

    // İPTAL OTO-ONAY (yalnız 'paid'): müşteri ödendi statüsündeki bir siparişi
    // için "iptal" kategorili talep açarsa, talep ANINDA onaylanır — sipariş
    // iptal edilir (cüzdan/cari iadesi mevcut updateOrder akışıyla), talep
    // "Cevaplandı" olur ve admin'e DÜŞMEZ. SADECE status==='paid' (henüz
    // tedarikçiye gitmemiş; hazırlanıyor/çekilmiş/kargo DEĞİL). Diğer tüm
    // statüler ve kategoriler değişmez — normal manuel akış.
    // İPTAL OTO-ONAY — iki durumda otomatik iptal + iade + müşteriye mesaj:
    //   1) Sipariş 'paid'  → tedarikçiye HİÇ gitmedi → HER ZAMAN (saat farketmez).
    //   2) Sipariş 'preparing' + TOPTAN BUDUR + TR saati < 18:00 → sabah listesine
    //      girdi ama kargo firması kargoya 18:00'de verir; o ana kadar hâlâ iptal
    //      edilebilir (panelde SARIYA düşer, gönderilmez → iş yükü azalır).
    // Diğer tüm durumlar (preparing ≥18:00 = kargoda, shipped, başka tedarikçi
    // preparing, iptal-dışı kategori) → normal MANUEL akış (admin bildirimi,
    // talep NEW, admin elle bakar).
    let autoCancelOrder: {
      id: string;
      tenantId: string;
      fromStatus: 'paid' | 'preparing';
    } | null = null;
    if (dto.category === 'iptal' && dto.orderId && meta.customerId) {
      const ord = await this.prisma.order.findFirst({
        where: { id: dto.orderId, customerId: meta.customerId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          items: {
            select: {
              supplierIdOverride: true,
              supplierIdSnapshot: true,
              product: { select: { supplierId: true } },
            },
          },
        },
      });
      if (ord?.status === 'paid') {
        autoCancelOrder = {
          id: ord.id,
          tenantId: ord.tenantId,
          fromStatus: 'paid',
        };
      } else if (ord?.status === 'preparing') {
        const trHour = trParts(new Date()).hour;
        if (trHour < 18 && (await this.isToptanBudurOrder(ord.items))) {
          autoCancelOrder = {
            id: ord.id,
            tenantId: ord.tenantId,
            fromStatus: 'preparing',
          };
        }
      }
    }

    const msg = await this.prisma.supportMessage.create({
      data: {
        name: dto.name,
        email: dto.email,
        subject: dto.subject ?? null,
        body: dto.body,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        customerId: meta.customerId ?? null,
        orderId: dto.orderId ?? null,
        orderNumber: dto.orderNumber ?? null,
        kind: dto.kind ?? (dto.orderId ? 'order' : 'general'),
        category: dto.category ?? null,
        marketplace: dto.marketplace ?? null,
        carrier: dto.carrier ?? null,
        trackingCode: dto.trackingCode ?? null,
        // İade talebiyse yaşam döngüsünü REQUESTED ile başlat (admin karar verir).
        returnStatus: returnFlowOrderId ? ReturnFlowStatus.REQUESTED : undefined,
      },
      select: { id: true, createdAt: true },
    });

    // Persist attachments after the ticket exists so the FK is valid. If
    // any individual upload fails we log and continue — the ticket itself
    // is more valuable than its images. We also collect the successfully
    // persisted rows so the opening conversation message can reuse the SAME
    // storage keys (no re-upload) below.
    const persistedAttachments: Array<{
      storageKey: string;
      filename: string;
      mimetype: string;
      size: number;
    }> = [];
    if (validated.length > 0 && this.storage) {
      for (const att of validated) {
        const fileId = randomUUID();
        const key = `support/${msg.id}/${fileId}.${att.extension}`;
        const filename = att.original.originalname.slice(0, 255);
        try {
          await this.storage.upload(
            key,
            att.original.buffer,
            att.mimetype,
          );
          await this.prisma.supportMessageAttachment.create({
            data: {
              ticketId: msg.id,
              storageKey: key,
              filename,
              mimetype: att.mimetype,
              size: att.original.size,
            },
          });
          persistedAttachments.push({
            storageKey: key,
            filename,
            mimetype: att.mimetype,
            size: att.original.size,
          });
        } catch (err) {
          this.logger.error(
            `support attachment upload failed ticket=${msg.id} key=${key}`,
            err as Error,
          );
        }
      }
    }

    // İADE FATURASI + FATURALAMA TUTMA: iade talebi ise, PDF'i özel (private)
    // prefixe yükle + alanları işaretle ve siparişi faturalamadan tut. İade
    // sürecindeki siparişe ASLA fatura kesilmemeli (kullanıcı şartı). Yükleme
    // hatası non-fatal — talep yine oluşur; kapı (gate) create öncesinde geçti.
    if (returnFlowOrderId) {
      if (validatedReturnInvoice && this.storage) {
        const fileId = randomUUID();
        const key = `return-invoices/${msg.id}/${fileId}.pdf`;
        try {
          await this.storage.upload(
            key,
            validatedReturnInvoice.buffer,
            'application/pdf',
          );
          await this.prisma.supportMessage.update({
            where: { id: msg.id },
            data: {
              returnInvoiceKey: key,
              returnInvoiceName: validatedReturnInvoice.filename,
              returnInvoiceUploadedAt: new Date(),
            },
          });
        } catch (err) {
          this.logger.error(
            `[return.create] iade faturası yüklemesi başarısız ticket=${msg.id} key=${key}`,
            err as Error,
          );
        }
      }
      await this.holdOrderFromInvoicing(returnFlowOrderId);
    }

    // Two-way threaded chat: for authenticated customer tickets we open a
    // SUPPORT conversation and seed it with the ticket body as the first
    // CUSTOMER message, reusing the SAME storage keys for attachments. The
    // public/anonymous contact form (no customerId) is intentionally excluded
    // — guests have no place to receive/read replies. Non-fatal: any failure
    // here must never break ticket creation.
    if (meta.customerId && !autoCancelOrder) {
      const customerId = meta.customerId;
      // AWAIT (fire-and-forget değil): sohbeti + açılış mesajını talep
      // görünür olmadan ÖNCE tohumla. Böylece admin talebi "hemen" açtığında
      // conversationId daima hazırdır ve chat görünür — eski "kutucuk"
      // görünümüne düşmez. İçerideki try/catch sayesinde hata create'i bozmaz.
      await (async () => {
        try {
          const tenantId =
            await this.adminNotifier.resolveDefaultTenantId();
          if (!tenantId) {
            this.logger.warn(
              `[support.create] conversation skipped — tenant bulunamadı id=${msg.id}`,
            );
            return;
          }
          const conversation =
            await this.conversations.getOrCreateForSupportTicket({
              tenantId,
              supportTicketId: msg.id,
              customerId,
            });
          const message = await this.conversations.postMessage({
            conversationId: conversation.id,
            senderType: ConversationSenderType.CUSTOMER,
            senderCustomerId: customerId,
            body: dto.body,
            // Talep oluşturma zaten "[Admin] Yeni destek talebi" maili atıyor;
            // tohum mesajı için ikinci bir "Talebe yeni mesaj" maili gitmesin.
            suppressAdminMail: true,
          });
          // Mirror the ticket attachments onto the opening message by reusing
          // the existing storage keys — do NOT re-upload the buffers.
          for (const att of persistedAttachments) {
            await this.prisma.conversationMessageAttachment.create({
              data: {
                messageId: message.id,
                storageKey: att.storageKey,
                filename: att.filename,
                mimetype: att.mimetype,
                size: att.size,
              },
            });
          }
        } catch (err) {
          this.logger.error(
            `[support.create] conversation threading failed ticket=${msg.id}`,
            err as Error,
          );
        }
      })();
    }

    this.logger.log(
      JSON.stringify({
        event: 'support.received',
        id: msg.id,
        email: dto.email,
      }),
    );

    void (async () => {
      try {
        const isCustomer = !!meta.customerId;
        const subjectSuffix = dto.subject ? ` — ${dto.subject}` : '';
        const orderSuffix = dto.orderNumber
          ? ` (Sipariş #${dto.orderNumber})`
          : '';
        await this.audit.record({
          action: 'SUPPORT_MESSAGE_CREATE',
          summary: `${dto.name} (${dto.email}) destek talebi oluşturdu${subjectSuffix}${orderSuffix}`,
          actor: isCustomer
            ? {
                type: 'customer',
                id: meta.customerId ?? null,
                name: dto.name,
                email: dto.email,
              }
            : { type: 'public', name: dto.name, email: dto.email },
          target: { id: msg.id, type: 'support_message', label: dto.name },
          extra: {
            subject: dto.subject ?? null,
            kind: dto.kind ?? (dto.orderId ? 'order' : 'general'),
            orderId: dto.orderId ?? null,
            orderNumber: dto.orderNumber ?? null,
            category: dto.category ?? null,
            marketplace: dto.marketplace ?? null,
            carrier: dto.carrier ?? null,
            trackingCode: dto.trackingCode ?? null,
            attachmentCount: validated.length,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record SUPPORT_MESSAGE_CREATE audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    // İptal oto-onay denemesi (ödendi sipariş). Başarılıysa sipariş iptal +
    // cari iade yapılır, talep "Cevaplandı" olur, müşteriye onay yanıtı gider;
    // admin'e HİÇ düşmez → aşağıdaki "alındı"/admin-bildirim blokları ATLANIR.
    if (autoCancelOrder) {
      const autoApproved = await this.tryAutoApproveCancellation({
        ticketId: msg.id,
        order: autoCancelOrder,
        customerName: dto.name,
        customerEmail: dto.email,
        subject: dto.subject ?? null,
        orderNumber: dto.orderNumber ?? null,
        originalMessage: dto.body ?? null,
        category: dto.category ?? 'iptal',
        createdAt: msg.createdAt,
        req: req ?? null,
      });
      if (autoApproved) {
        return { ok: true, id: msg.id };
      }
      // Oto-onay başarısız (ör. sipariş artık 'paid' değil) → normal manuel
      // akışa düş: aşağıda "alındı" maili + admin bildirimi gönderilir, talep
      // NEW kalır ve admin listesinde görünür.
    }

    // "Talebiniz alındı" bilgilendirmesi ANINDA değil ~150 sn sonra gönderilir
    // (RECEIVED_ACK_DELAY_MS) — müşteride "izleniyor" hissi. Gönderim anında
    // talebin GÜNCEL statüsü yeniden okunur: bu sürede admin yanıtladıysa
    // (REPLIED) ya da arşivlendiyse ack GÖNDERİLMEZ (gerçek yanıt zaten gitti).
    // Ack talebin statüsüne DOKUNMAZ → talep "bekleyen" + kırmızı kalır.
    // .unref(): timer süreç kapanışını 150 sn bloklamasın (nadir restart
    // penceresinde o talebin ack'i atlanır — bilinçli, kabul edilebilir bir
    // ödünç; statü/mantık korunur).
    const ackTicketId = msg.id;
    setTimeout(() => {
      void (async () => {
        try {
          const fresh = await this.prisma.supportMessage.findUnique({
            where: { id: ackTicketId },
            select: {
              status: true,
              email: true,
              name: true,
              subject: true,
              body: true,
            },
          });
          if (!fresh?.email) return;
          // Yalnız hâlâ bekleyen (NEW/READ) taleplere gönder; yanıtlanmış/kapatılmışa gönderme.
          if (
            fresh.status !== SupportMessageStatus.NEW &&
            fresh.status !== SupportMessageStatus.READ
          ) {
            return;
          }
          await this.mail.sendSupportReceived({
            to: fresh.email,
            recipientName: fresh.name,
            subject: fresh.subject ?? null,
            message: fresh.body,
          });
        } catch (e) {
          this.logger.warn(
            `support received (gecikmeli) mail failed id=${ackTicketId} err=${(e as Error).message}`,
          );
        }
      })();
    }, RECEIVED_ACK_DELAY_MS).unref();

    // Admin bildirimi — yeni destek talebi/iletişim formu mesajı.
    void (async () => {
      const tenantId = await this.adminNotifier.resolveDefaultTenantId();
      if (!tenantId) {
        this.logger.warn(
          `[support.create] admin notification skipped — tenant bulunamadı id=${msg.id}`,
        );
        return;
      }
      const emails = await this.adminNotifier.resolveAdminEmails(
        tenantId,
        OPS_NOTIFY_ROLES,
      );
      if (emails.length === 0) {
        this.logger.warn(
          `[support.create] admin notification skipped — tenant=${tenantId} mail alıcısı yok id=${msg.id}`,
        );
        return;
      }
      await this.mail.sendAdminNewSupportMessage({
        to: emails,
        senderName: dto.name,
        senderEmail: dto.email,
        senderPhone: null,
        subject: dto.subject ?? null,
        message: dto.body,
        adminUrl: null,
      });
    })().catch((e) =>
      this.logger.warn(
        `[support.create] admin mail failed id=${msg.id} err=${(e as Error).message}`,
      ),
    );

    // Müşteri girişli ticket'lerde aynı body için conversation tarafında
    // `Yeni sohbet mesajı` zaten yayımlanıyor — çift bildirim önlemek için
    // burada sadece anonim iletişim formu (customerId yok) için emit ediyoruz.
    if (!meta.customerId) {
      void this.notifications
        .emit({
          type: 'support.message',
          severity: 'info',
          title: 'Yeni destek mesajı',
          body: `${dto.name}${dto.subject ? ' — ' + dto.subject : ''}`,
          link: dto.orderId
            ? `/orders/talepler?ticketId=${msg.id}`
            : `/mesajlar?source=SUPPORT&messageId=${msg.id}`,
          data: {
            messageId: msg.id,
            email: dto.email,
            orderId: dto.orderId ?? null,
            orderNumber: dto.orderNumber ?? null,
          },
          audience: { role: 'ADMIN' },
        })
        .catch((e) =>
          this.logger.warn(
            `[support.create] notification emit failed: ${(e as Error).message}`,
          ),
        );
    }

    return { ok: true, id: msg.id };
  }

  /**
   * Ödendi statüsündeki bir sipariş için açılan "iptal" talebini OTOMATİK
   * onaylar: siparişi iptal eder (cüzdan/cari iadesi mevcut
   * AdminOrdersService.updateOrder akışında yapılır), talebi REPLIED
   * ("Cevaplandı") yapar ve müşteriye tek bir onay yanıtı e-postası gönderir.
   * Admin'e bildirim/e-posta ÜRETİLMEZ — çağıran taraf true dönünce normal
   * "alındı"/admin-bildirim bloklarını atlar.
   *
   * Dönüş: true → oto-onaylandı; false → iptal yapılamadı, çağıran normal
   * manuel akışa (NEW + admin bildirimi) düşmeli. SADECE sipariş iptali (para
   * operasyonu) BAŞARILI olursa true döner; sonraki adımlar (mail/audit/bildirim
   * kapatma) best-effort'tur ve sonucu değiştirmez — çünkü sipariş zaten iptal
   * edilmiştir ve fallback İKİNCİ bir iptal denememelidir.
   */
  /**
   * Siparişin kalemlerinden en az biri Toptan Budur tedarikçisine mi ait?
   * AppSetting `toptanbudur.supplierId` + resolveSupplierId (TEK KAYNAK atıf:
   * override → snapshot → product). supplierId tanımsızsa false.
   */
  private async isToptanBudurOrder(
    items: Array<{
      supplierIdOverride: string | null;
      supplierIdSnapshot: string | null;
      product: { supplierId: string | null } | null;
    }>,
  ): Promise<boolean> {
    const tbId = (
      await this.appSettings.getString('toptanbudur.supplierId', '')
    ).trim();
    if (!tbId) return false;
    return items.some((it) => resolveSupplierId(it) === tbId);
  }

  private async tryAutoApproveCancellation(input: {
    ticketId: string;
    order: { id: string; tenantId: string; fromStatus: 'paid' | 'preparing' };
    customerName: string;
    customerEmail: string;
    subject: string | null;
    orderNumber: string | null;
    originalMessage?: string | null;
    category?: string | null;
    createdAt?: Date | null;
    req: Request | null;
  }): Promise<boolean> {
    const { ticketId, order } = input;

    // 1) Para operasyonu: siparişi iptal et. Stok + tedarikçi cüzdan + müşteri
    //    cari iadesi updateOrder'ın enteringCancelled bloğunda yapılır —
    //    'preparing' sipariş için tedarikçi bakiyesi de otomatik geri eklenir
    //    (ORDER_REFUND). notify:false → ayrı iptal e-postası YOK (tek mesaj
    //    oto-onay yanıtıdır). updateOrder atomiktir; statü ön-kontroldekinden
    //    farklıysa fırlatır → çift iptal/çift iade İMKÂNSIZ.
    try {
      await this.adminOrders.updateOrder(
        order.tenantId,
        order.id,
        { status: 'cancelled' },
        { id: AUTO_CANCEL_ACTOR_ID, tenantId: order.tenantId },
        // requireCurrentStatus → updateOrder siparişi ANCAK hâlâ ön-kontroldeki
        // statüdeyken (paid ya da TB-preparing) iptal eder. Ön-kontrol ile bu
        // çağrı arasında bir bot statüyü değiştirdiyse (paid→preparing→shipped)
        // guard fırlatır → return false → manuel akış. Yarış güvenli.
        { notify: false, requireCurrentStatus: order.fromStatus },
      );
    } catch (err) {
      this.logger.warn(
        `[support.autoCancel] sipariş iptali başarısız ticket=${ticketId} order=${order.id}: ${(err as Error).message} — talep manuel akışa düşürüldü`,
      );
      return false;
    }

    const replyBody = buildAutoCancelReply(input.customerName, input.orderNumber);

    // 2) Talebi "Cevaplandı" (REPLIED) + admin notu yap. Authoritative son yazım.
    try {
      await this.prisma.supportMessage.update({
        where: { id: ticketId },
        data: { status: SupportMessageStatus.REPLIED, adminNote: replyBody },
      });
    } catch (err) {
      this.logger.error(
        `[support.autoCancel] talep REPLIED güncellemesi başarısız ticket=${ticketId}`,
        err as Error,
      );
      // Sipariş zaten iptal edildi → fallback ETME (çift iptal riski). Talep
      // NEW kalsa bile admin elle "Cevaplandı" yapabilir.
    }

    // 3) Müşteriye onay yanıtı (best-effort). Müşteri panelinde ticket'in
    //    adminNote'u "Toptan Budur Yanıtı" olarak görünür (conversation yok).
    void this.mail
      .sendSupportReply({
        to: input.customerEmail,
        recipientName: input.customerName,
        subject: input.subject ?? 'İptal Talebiniz',
        body: replyBody,
        originalMessage: input.originalMessage,
        orderNumber: input.orderNumber,
        category: input.category,
        createdAt: input.createdAt,
      })
      .catch((e) =>
        this.logger.warn(
          `[support.autoCancel] onay yanıtı maili başarısız ticket=${ticketId}: ${(e as Error).message}`,
        ),
      );

    // 4) Savunma: bu talebe ait olası okunmamış admin bildirimlerini kapat
    //    (oto-onayda normalde hiç üretilmez ama garanti).
    void this.prisma.notification
      .updateMany({
        where: {
          readAt: null,
          role: 'ADMIN',
          OR: [
            { data: { path: ['messageId'], equals: ticketId } },
            { data: { path: ['supportTicketId'], equals: ticketId } },
          ],
        },
        data: { readAt: new Date() },
      })
      .catch(() => undefined);

    // 5) Audit izi.
    void this.audit
      .record({
        action: 'SUPPORT_AUTO_CANCEL_APPROVE',
        summary: `${input.customerName} — ödendi sipariş${input.orderNumber ? ` #${input.orderNumber}` : ''} iptal talebi otomatik onaylandı (sipariş iptal + cari iade)`,
        actor: {
          type: 'system',
          name: 'Otomatik İptal Onayı',
          tenantId: order.tenantId,
        },
        target: {
          id: ticketId,
          type: 'support_message',
          label: input.customerName,
        },
        extra: { orderId: order.id, orderNumber: input.orderNumber ?? null },
        req: input.req,
      })
      .catch(() => undefined);

    this.logger.log(
      `[support.autoCancel] ödendi sipariş iptal talebi oto-onaylandı ticket=${ticketId} order=${order.id}`,
    );
    return true;
  }

  /**
   * Bir siparişi FATURALAMADAN TUTAR (iade süreci boyunca fatura kesilmesin —
   * kullanıcı şartı). billingHold=true yapar; ayrıca sipariş henüz faturalanmamış
   * 'frozen' bir InvoiceBatch'e bağlıysa batch'ten çıkarır ki BirFatura o
   * siparişi çekip fatura kesmesin (iptal desenindeki gibi). Adminin ELLE koyduğu
   * bir fatura-tutmayı ezmemek için billingNote'a YALNIZ biz hold koyduğumuzda
   * RETURN_HOLD_NOTE damgası basılır (release bunu arar). Non-fatal.
   */
  private async holdOrderFromInvoicing(orderId: string): Promise<void> {
    try {
      const ord = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          billingHold: true,
          invoicedAt: true,
          invoiceBatchId: true,
          invoiceBatch: { select: { status: true } },
        },
      });
      if (!ord) return;
      // Unchecked variant: scalar FK (invoiceBatchId) doğrudan set edilebilir.
      const data: Prisma.OrderUncheckedUpdateInput = { billingHold: true };
      // Yalnız biz hold koyuyorsak damgayı bas (mevcut manuel hold'u koruruz).
      if (!ord.billingHold) data.billingNote = RETURN_HOLD_NOTE;
      // Faturalanmamış 'frozen' batch'ten çıkar (BirFatura çekmesin).
      if (
        ord.invoicedAt === null &&
        ord.invoiceBatchId &&
        ord.invoiceBatch?.status === 'frozen'
      ) {
        data.invoiceBatchId = null;
      }
      await this.prisma.order.update({ where: { id: orderId }, data });
    } catch (err) {
      this.logger.error(
        `[return.hold] fatura tutma başarısız order=${orderId}`,
        err as Error,
      );
    }
  }

  /**
   * İade REDDEDİLDİĞİNDE siparişin fatura-tutmasını serbest bırakır (normal
   * faturalamaya döner). YALNIZCA bizim koyduğumuz hold'u (RETURN_HOLD_NOTE)
   * kaldırır — adminin elle koyduğu hold'a dokunmaz. Non-fatal.
   */
  private async releaseOrderInvoicing(orderId: string): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: { id: orderId, billingNote: RETURN_HOLD_NOTE },
        data: { billingHold: false, billingNote: null },
      });
    } catch (err) {
      this.logger.error(
        `[return.release] fatura tutma kaldırma başarısız order=${orderId}`,
        err as Error,
      );
    }
  }

  /**
   * ADMIN İADE KARARI — approve | reject | finalize (iptal akışının aynası).
   *  approve  : REQUESTED→APPROVED; müşteriye iade adresi konuşma içinden iletilir
   *             (canlı mesaj + mail + talep REPLIED). Sipariş/cari DEĞİŞMEZ.
   *  reject   : REQUESTED→REJECTED; sipariş/cari DEĞİŞMEZ; fatura-tutma serbest
   *             bırakılır (sipariş normal faturalamaya döner). Hiçbir aksiyon yok.
   *  finalize : APPROVED|SHIPPED_BACK→FINALIZED; sipariş 'refunded' (müşteri "İade
   *             Edildi" görür) + müşteri cari iadesi (updateOrder refundCustomerCari:
   *             true). Para SADECE burada hareket eder. Atomik guard ile çift-
   *             çalıştırma engellenir; updateOrder hata verirse guard geri alınır.
   *
   * Ara adım (müşteri): APPROVED→SHIPPED_BACK, bkz. `markReturnShipped` — müşteri
   * "Ürünü Kargoya Verdim" der + foto yükler; para HÂLÂ hareket etmez.
   */
  async decideReturn(
    ticketId: string,
    dto: {
      action: 'approve' | 'reject' | 'finalize';
      address?: string;
      note?: string;
    },
    actor: { id: string; tenantId: string; email?: string | null },
    req?: Request | null,
  ) {
    const ticket = await this.prisma.supportMessage.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        customerId: true,
        orderId: true,
        orderNumber: true,
        name: true,
        subject: true,
        body: true,
        returnStatus: true,
        category: true,
      },
    });
    if (!ticket) throw new NotFoundException('talep bulunamadı');
    // Otomatik-akış ÖNCESİ açılmış eski iade taleplerinde returnStatus boştur.
    // İade niyeti (category='iade' ya da metin) varsa bunları da REQUESTED gibi
    // ele al → admin aksiyon alabilir. Gerçekten iade değilse reddet.
    if (
      !ticket.returnStatus &&
      !isReturnIntentTicket(ticket.category, ticket.subject, ticket.body)
    ) {
      throw new BadRequestException('Bu talep bir iade talebi değil.');
    }
    const currentReturnStatus =
      ticket.returnStatus ?? ReturnFlowStatus.REQUESTED;
    if (!ticket.orderId || !ticket.customerId) {
      throw new BadRequestException('İade talebi bir siparişe bağlı değil.');
    }
    const customerId = ticket.customerId;

    const order = await this.prisma.order.findUnique({
      where: { id: ticket.orderId },
      select: { id: true, tenantId: true, status: true, humanOrderNo: true },
    });
    if (!order) throw new NotFoundException('sipariş bulunamadı');

    const customerName = ticket.name?.trim() || 'Sayın müşterimiz';
    const orderNo = ticket.orderNumber ?? order.humanOrderNo ?? null;
    const sip = orderNo ? `#${orderNo} numaralı siparişinize` : 'siparişinize';

    // Admin mesajını müşteriye ilet (konuşma → canlı ekran + mail + REPLIED).
    const postToConversation = async (body: string) => {
      try {
        const conversation =
          await this.conversations.getOrCreateForSupportTicket({
            tenantId: actor.tenantId,
            supportTicketId: ticket.id,
            customerId,
          });
        await this.conversations.postMessage({
          conversationId: conversation.id,
          senderType: ConversationSenderType.ADMIN,
          senderUserId: actor.id,
          body,
        });
      } catch (err) {
        this.logger.error(
          `[return.decide] konuşma mesajı gönderilemedi ticket=${ticket.id}`,
          err as Error,
        );
      }
    };

    if (dto.action === 'approve') {
      if (currentReturnStatus !== ReturnFlowStatus.REQUESTED) {
        throw new ConflictException(
          `İade talebi zaten '${currentReturnStatus}' durumunda; yeniden onaylanamaz.`,
        );
      }
      const address = (dto.address ?? '').trim();
      if (address.length < 10) {
        throw new BadRequestException(
          'İade adresi zorunludur (en az 10 karakter).',
        );
      }
      await this.prisma.supportMessage.update({
        where: { id: ticket.id },
        data: {
          returnStatus: ReturnFlowStatus.APPROVED,
          returnAddress: address,
          returnDecidedAt: new Date(),
          returnDecidedById: actor.id,
          status: SupportMessageStatus.REPLIED,
        },
      });
      const note = (dto.note ?? '').trim();
      const body = [
        `Merhaba ${customerName},`,
        '',
        `${sip} ait iade talebiniz onaylanmıştır. Ürünü aşağıdaki adrese kargolayabilirsiniz:`,
        '',
        address,
        '',
        'Kargo bedeli tarafınıza aittir. Ürün tarafımıza ulaşıp incelendikten sonra iadeniz tamamlanır ve tutar cüzdan (cari) bakiyenize iade edilir.',
        ...(note ? ['', note] : []),
      ].join('\n');
      await postToConversation(body);
      void this.audit
        .record({
          action: 'SUPPORT_RETURN_APPROVE',
          summary: `${customerName} — sipariş${orderNo ? ` #${orderNo}` : ''} iade talebi onaylandı (iade adresi iletildi)`,
          actor: { type: 'admin', id: actor.id, email: actor.email ?? null },
          target: {
            id: ticket.id,
            type: 'support_message',
            label: customerName,
          },
          extra: { orderId: order.id, orderNumber: orderNo },
          req: req ?? null,
        })
        .catch(() => undefined);
      return {
        success: true,
        data: { id: ticket.id, returnStatus: ReturnFlowStatus.APPROVED },
      };
    }

    if (dto.action === 'reject') {
      if (currentReturnStatus !== ReturnFlowStatus.REQUESTED) {
        throw new ConflictException(
          `İade talebi zaten '${currentReturnStatus}' durumunda; reddedilemez.`,
        );
      }
      await this.prisma.supportMessage.update({
        where: { id: ticket.id },
        data: {
          returnStatus: ReturnFlowStatus.REJECTED,
          returnDecidedAt: new Date(),
          returnDecidedById: actor.id,
          status: SupportMessageStatus.REPLIED,
        },
      });
      // Fatura-tutmasını serbest bırak → sipariş normal faturalamaya döner.
      await this.releaseOrderInvoicing(order.id);
      const note = (dto.note ?? '').trim();
      const body = [
        `Merhaba ${customerName},`,
        '',
        `${sip} ait iade talebiniz değerlendirilmiş ve uygun bulunmamıştır.`,
        ...(note ? ['', note] : []),
      ].join('\n');
      await postToConversation(body);
      void this.audit
        .record({
          action: 'SUPPORT_RETURN_REJECT',
          summary: `${customerName} — sipariş${orderNo ? ` #${orderNo}` : ''} iade talebi reddedildi`,
          actor: { type: 'admin', id: actor.id, email: actor.email ?? null },
          target: {
            id: ticket.id,
            type: 'support_message',
            label: customerName,
          },
          extra: { orderId: order.id, orderNumber: orderNo },
          req: req ?? null,
        })
        .catch(() => undefined);
      return {
        success: true,
        data: { id: ticket.id, returnStatus: ReturnFlowStatus.REJECTED },
      };
    }

    // ── finalize ──────────────────────────────────────────────────────────
    // İade parası SADECE burada hareket eder. İki durumdan da tamamlanabilir:
    //   • SHIPPED_BACK — normal yol (müşteri kargoya verdi, foto geldi, ürün ulaştı)
    //   • APPROVED     — yedek yol (müşteri "kargoya verdim"e basmayı unuttu ama
    //                    ürün yine de elimize ulaştı) — admin elle tamamlayabilsin.
    if (
      currentReturnStatus !== ReturnFlowStatus.APPROVED &&
      currentReturnStatus !== ReturnFlowStatus.SHIPPED_BACK
    ) {
      throw new ConflictException(
        `İade yalnızca onaylanmış (APPROVED) veya kargoya verilmiş (SHIPPED_BACK) talep için tamamlanabilir; mevcut: '${currentReturnStatus}'.`,
      );
    }

    // Sipariş ZATEN 'refunded' ise (admin elle iade etmiş / önceden tamamlanmış)
    // → updateOrder'ı ATLA (requireCurrentStatus:'shipped' hata verirdi). Talebi
    // FINALIZED yap + kapanış mesajı gönder. Cari zaten iade edilmiş sayılır;
    // çift kredi verilmez (netPaid/REFUND guard'ları zaten engeller).
    if (order.status === 'refunded') {
      await this.prisma.supportMessage.update({
        where: { id: ticket.id },
        data: {
          returnStatus: ReturnFlowStatus.FINALIZED,
          returnFinalizedAt: new Date(),
          status: SupportMessageStatus.REPLIED,
        },
      });
      const doneBody = [
        `Merhaba ${customerName},`,
        '',
        `${sip} ait iadeniz tamamlanmıştır. Sipariş tutarı cüzdan (cari) bakiyenize iade edilmiştir; dilediğiniz yeni siparişte kullanabilirsiniz.`,
        '',
        'İlginiz için teşekkür ederiz.',
      ].join('\n');
      await postToConversation(doneBody);
      void this.audit
        .record({
          action: 'SUPPORT_RETURN_FINALIZE',
          summary: `${customerName} — sipariş${orderNo ? ` #${orderNo}` : ''} iadesi tamamlandı (sipariş zaten 'İade Edildi')`,
          actor: { type: 'admin', id: actor.id, email: actor.email ?? null },
          target: { id: ticket.id, type: 'support_message', label: customerName },
          extra: { orderId: order.id, orderNumber: orderNo },
          req: req ?? null,
        })
        .catch(() => undefined);
      return {
        success: true,
        data: { id: ticket.id, returnStatus: ReturnFlowStatus.FINALIZED },
      };
    }

    // Atomik çift-çalıştırma guard'ı: yalnız APPROVED/SHIPPED_BACK iken FINALIZED'a
    // çevir. Hata durumunda tam da bu duruma geri sarabilmek için saklıyoruz.
    const prevStatus = currentReturnStatus;
    const flip = await this.prisma.supportMessage.updateMany({
      where: {
        id: ticket.id,
        returnStatus: {
          in: [ReturnFlowStatus.APPROVED, ReturnFlowStatus.SHIPPED_BACK],
        },
      },
      data: {
        returnStatus: ReturnFlowStatus.FINALIZED,
        returnFinalizedAt: new Date(),
      },
    });
    if (flip.count === 0) {
      throw new ConflictException(
        'İade zaten tamamlanmış veya durumu değişmiş.',
      );
    }

    try {
      // Sipariş 'refunded' (müşteri "İade Edildi" görür) + müşteri cari iadesi.
      // requireCurrentStatus:'shipped' → yarış güvenli; refundCustomerCari:true →
      // enteringRefunded cari iade dalını tetikler (idempotent).
      await this.adminOrders.updateOrder(
        order.tenantId,
        order.id,
        { status: 'refunded' },
        { id: actor.id, tenantId: order.tenantId },
        {
          // notify:false → updateOrder ayrı bir "durum değişti" maili ATMAZ; tek
          // müşteri bildirimi aşağıdaki konuşma mesajıdır (iptal oto-onay deseni).
          notify: false,
          requireCurrentStatus: 'shipped',
          refundCustomerCari: true,
        },
      );
    } catch (err) {
      // updateOrder başarısız (ör. sipariş artık 'shipped' değil) → guard'ı geri
      // al ki admin tekrar deneyebilsin; durum tutarsız kalmasın.
      await this.prisma.supportMessage
        .updateMany({
          where: { id: ticket.id, returnStatus: ReturnFlowStatus.FINALIZED },
          data: {
            // Hangi durumdan geldiysek ona geri sar (APPROVED ya da SHIPPED_BACK).
            returnStatus: prevStatus,
            returnFinalizedAt: null,
          },
        })
        .catch(() => undefined);
      throw err;
    }

    // Belt: refunded sipariş zaten faturalanmaz (status 'shipped' değil); yine de
    // olası 'frozen' batch bağını kopar + hold damgasını koru.
    await this.holdOrderFromInvoicing(order.id);

    await this.prisma.supportMessage
      .update({
        where: { id: ticket.id },
        data: { status: SupportMessageStatus.REPLIED },
      })
      .catch(() => undefined);

    const body = [
      `Merhaba ${customerName},`,
      '',
      `${sip} ait iadeniz tamamlanmıştır. Sipariş tutarı cüzdan (cari) bakiyenize iade edilmiştir; dilediğiniz yeni siparişte kullanabilirsiniz.`,
      '',
      'İlginiz için teşekkür ederiz.',
    ].join('\n');
    await postToConversation(body);

    void this.audit
      .record({
        action: 'SUPPORT_RETURN_FINALIZE',
        summary: `${customerName} — sipariş${orderNo ? ` #${orderNo}` : ''} iadesi tamamlandı (sipariş 'İade Edildi' + cari iade)`,
        actor: { type: 'admin', id: actor.id, email: actor.email ?? null },
        target: { id: ticket.id, type: 'support_message', label: customerName },
        extra: { orderId: order.id, orderNumber: orderNo },
        req: req ?? null,
      })
      .catch(() => undefined);

    return {
      success: true,
      data: { id: ticket.id, returnStatus: ReturnFlowStatus.FINALIZED },
    };
  }

  /**
   * MÜŞTERİ İADE ADIMI — "Ürünü Kargoya Verdim" (APPROVED→SHIPPED_BACK).
   * Müşteri, admin'in ilettiği adrese ürünü kargoladıktan sonra bu adımı yapar:
   * en az bir FOTOĞRAF (kargo fişi/koli) yükler → foto sohbete düşer (admin görür)
   * + talep yeniden admin'e "Beklemede" olarak yükselir. PARA HAREKET ETMEZ;
   * iade ancak admin ürünü teslim alıp inceledikten sonra `decideReturn(finalize)`
   * ile yapılır. Sahiplik customerId ile doğrulanır.
   */
  async markReturnShipped(
    ticketId: string,
    customerId: string,
    photos: UploadedAttachment[],
    req?: Request | null,
  ) {
    if (!photos || photos.length === 0) {
      throw new BadRequestException(
        'Ürünü kargoya verdiğinize dair en az bir fotoğraf yüklemelisiniz.',
      );
    }
    const ticket = await this.prisma.supportMessage.findFirst({
      where: { id: ticketId, customerId },
      select: {
        id: true,
        orderId: true,
        customerId: true,
        returnStatus: true,
        name: true,
        orderNumber: true,
      },
    });
    if (!ticket) throw new NotFoundException('talep bulunamadı');
    if (ticket.returnStatus !== ReturnFlowStatus.APPROVED) {
      throw new ConflictException(
        'Bu adım yalnızca iadesi onaylanıp adresi iletilmiş talepte yapılabilir.',
      );
    }
    if (!ticket.orderId || !ticket.customerId) {
      throw new BadRequestException('İade talebi bir siparişe bağlı değil.');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: ticket.orderId },
      select: { id: true, tenantId: true, humanOrderNo: true },
    });
    if (!order) throw new NotFoundException('sipariş bulunamadı');

    // 1) Fotoğrafı sohbete düşür — ÖNCE bu, çünkü postMessage magic-byte + boyut +
    //    tür doğrulamasını yapar; geçersiz görselde durum HİÇ değişmeden hata döner.
    const conversation = await this.conversations.getOrCreateForSupportTicket({
      tenantId: order.tenantId,
      supportTicketId: ticket.id,
      customerId,
    });
    await this.conversations.postMessage({
      conversationId: conversation.id,
      senderType: ConversationSenderType.CUSTOMER,
      senderCustomerId: customerId,
      body: 'Ürünü kargoya verdim. Kargo fişi/fotoğrafı ektedir.',
      files: photos,
    });

    // 2) Durumu atomik olarak APPROVED→SHIPPED_BACK çevir + talebi admin'e
    //    "Beklemede" (NEW) olarak geri yükselt (REPLIED iken kaybolmasın).
    const flip = await this.prisma.supportMessage.updateMany({
      where: { id: ticket.id, returnStatus: ReturnFlowStatus.APPROVED },
      data: {
        returnStatus: ReturnFlowStatus.SHIPPED_BACK,
        returnShippedAt: new Date(),
        status: SupportMessageStatus.NEW,
      },
    });
    if (flip.count === 0) {
      throw new ConflictException(
        'Durum değişmiş görünüyor; sayfayı yenileyip tekrar deneyin.',
      );
    }

    const orderNo = ticket.orderNumber ?? order.humanOrderNo ?? null;
    void this.audit
      .record({
        action: 'SUPPORT_RETURN_SHIPPED',
        summary: `${ticket.name?.trim() || 'Müşteri'} — sipariş${orderNo ? ` #${orderNo}` : ''} ürünü kargoya verdiğini bildirdi (foto yüklendi)`,
        actor: { type: 'customer', id: customerId, email: null },
        target: { id: ticket.id, type: 'support_message', label: ticket.name },
        extra: { orderId: order.id, orderNumber: orderNo },
        req: req ?? null,
      })
      .catch(() => undefined);

    return {
      success: true,
      data: { id: ticket.id, returnStatus: ReturnFlowStatus.SHIPPED_BACK },
    };
  }

  /**
   * Tedarikçi botu (status-poll) bir siparişi OTOMATİK iptale çektiğinde
   * müşteriyi bilgilendirir. Müşteri kendi iptal talebini açtığında oto-onay
   * mesajının (buildAutoCancelReply) yaptığının AYNISI: müşteri panelinde bir
   * "iptal" talebi "Cevaplandı" olarak görünür ve `adminNote` "Toptan Budur
   * Yanıtı" olarak gösterilir; gerekirse e-posta da gider.
   *
   * Çift mail önleme: bot iptalinde `AdminOrdersService.updateOrder` cari
   * iadesi yaptıysa zaten `sendOrderCancelledRefund` mailini (tutar detaylı)
   * göndermiştir → burada İKİNCİ mail atılmaz. İade olmadıysa (ör. ödemesiz
   * sipariş) müşteri yine de e-posta ile bilgilensin diye buradan gönderilir.
   *
   * Best-effort: çağıran void ile çağırmalı — hiçbir hata bot iptal akışını
   * bozmamalı (sipariş zaten iptal edilmiştir).
   *
   * @param input.refunded updateOrder bir cari iadesi yaptıysa (dolayısıyla
   *   cari-iade mailini gönderdiyse) true.
   * @param input.transitioned updateOrder siparişi bu çağrıda GERÇEKTEN
   *   'cancelled'a geçirdiyse true. Sipariş zaten iptalliyse (bot yeniden
   *   poll etti) false gelir → tekrar bildirim/e-posta gönderilmez (idempotent).
   */
  async notifySupplierAutoCancel(input: {
    tenantId: string;
    orderId: string;
    refunded: boolean;
    transitioned: boolean;
  }): Promise<void> {
    // Sipariş bu çağrıda iptale geçmediyse (zaten iptalliydi) bildirme.
    if (!input.transitioned) return;

    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        customerId: true,
        customerEmail: true,
        customerName: true,
        humanOrderNo: true,
        status: true,
      },
    });
    // Müşteri kimliği/e-postası yoksa panelde talep gösterilemez / mail atılamaz
    // (ör. eski müşterisiz veya self sipariş) → sessizce çık.
    if (!order || !order.customerId || !order.customerEmail) {
      this.logger.warn(
        `[support.autoCancelNotice] atlandı order=${input.orderId} — müşteri/e-posta yok`,
      );
      return;
    }
    // Güvenlik: yalnızca gerçekten iptal edilmiş siparişte bilgilendir.
    if (order.status !== 'cancelled') {
      this.logger.warn(
        `[support.autoCancelNotice] atlandı order=${input.orderId} — statü '${order.status}' (cancelled değil)`,
      );
      return;
    }

    const replyBody = buildSupplierAutoCancelReply(
      order.customerName,
      order.humanOrderNo,
      input.refunded,
    );

    // Aynı siparişe ait AÇIK bir "iptal" talebi varsa ona yanıt ver (müşteri
    // arada kendisi de iptal istemiş olabilir); yoksa sistem adına yeni talep
    // oluştur. Zaten "Cevaplandı" (REPLIED) bir iptal talebi varsa müşteri
    // bilgilendirilmiş demektir → tekrar mesaj/mail atma (çift bildirim yok).
    const existing = await this.prisma.supportMessage.findFirst({
      where: {
        orderId: order.id,
        customerId: order.customerId,
        category: 'iptal',
        status: { not: SupportMessageStatus.ARCHIVED },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (existing?.status === SupportMessageStatus.REPLIED) {
      return;
    }

    let ticketId: string;
    if (existing) {
      ticketId = existing.id;
    } else {
      const created = await this.prisma.supportMessage.create({
        data: {
          name: order.customerName ?? order.customerEmail,
          email: order.customerEmail,
          subject: 'Siparişiniz İptal Edildi',
          body: order.humanOrderNo
            ? `#${order.humanOrderNo} numaralı siparişiniz iptal edildi.`
            : 'Siparişiniz iptal edildi.',
          customerId: order.customerId,
          orderId: order.id,
          orderNumber: order.humanOrderNo,
          kind: 'order',
          category: 'iptal',
        },
        select: { id: true },
      });
      ticketId = created.id;
    }

    // Talebi "Cevaplandı" (REPLIED) + adminNote = güzel iptal yanıtı yap.
    // Müşteri panelinde adminNote "Toptan Budur Yanıtı" olarak görünür
    // (oto-onay akışı ile birebir aynı gösterim).
    await this.prisma.supportMessage.update({
      where: { id: ticketId },
      data: { status: SupportMessageStatus.REPLIED, adminNote: replyBody },
    });

    // E-posta: updateOrder cari-iade mailini zaten gönderdiyse (refunded)
    // ikinci mail ATMA. Aksi halde müşteri e-posta ile de bilgilensin.
    if (!input.refunded) {
      void this.mail
        .sendSupportReply({
          to: order.customerEmail,
          recipientName: order.customerName ?? order.customerEmail,
          subject: 'Siparişiniz İptal Edildi',
          body: replyBody,
          originalMessage: null,
          orderNumber: order.humanOrderNo,
          category: 'iptal',
        })
        .catch((e) =>
          this.logger.warn(
            `[support.autoCancelNotice] mail başarısız ticket=${ticketId}: ${(e as Error).message}`,
          ),
        );
    }

    this.logger.log(
      `[support.autoCancelNotice] bot iptali için müşteri bilgilendirildi ticket=${ticketId} order=${order.id} refunded=${input.refunded}`,
    );
  }

  async list(query: ListSupportMessagesDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    const where: Prisma.SupportMessageWhereInput = {};
    if (query.status) where.status = query.status as SupportMessageStatus;
    // kind filter:
    //   'order'   -> sadece sipariş bağlı talepler
    //   'general' -> sipariş bağlı OLMAYAN mesajlar (legacy + iletişim formu)
    //   'all' veya undefined -> filtre uygulanmaz
    if (query.kind === 'order') {
      where.kind = 'order';
    } else if (query.kind === 'general') {
      where.OR = [
        { kind: 'general' },
        { kind: null },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supportMessage.findMany({
        where,
        // Yeniden açılan talepler (müşteri yeni mesaj → status NEW + updatedAt
        // tazelenir) listede en üste gelsin diye önce updatedAt'e göre sırala.
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          attachments: {
            select: {
              id: true,
              filename: true,
              mimetype: true,
              size: true,
              storageKey: true,
              createdAt: true,
              purgedAt: true,
            },
          },
          customer: { select: { phone: true } },
          // Bağlı sipariş: tedarikçi adı/sipariş no + gerçek kargo firması/barkodu
          // admin talep listesinde göstermek için (talep alanları fallback).
          order: {
            select: {
              supplierOrderNo: true,
              cargoCompany: true,
              cargoBarcode: true,
              trackingNumber: true,
              items: {
                select: {
                  supplierOverride: { select: { name: true } },
                  supplierNameSnapshot: true,
                  product: { select: { supplier: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.supportMessage.count({ where }),
    ]);

    const convoMap = await this.resolveConversationIdMap(
      items.map((i) => i.id),
    );
    const enriched = await Promise.all(
      items.map(async (item) => {
        const attachments = await this.attachUrls(item.attachments ?? []);
        const { customer, order, returnInvoiceKey, ...rest } = item;
        return {
          ...rest,
          attachments,
          returnInvoiceUrl: await this.signReturnInvoiceUrl(returnInvoiceKey),
          customerPhone: customer?.phone ?? null,
          conversationId: convoMap.get(item.id) ?? null,
          // Sipariş bağlıysa tedarikçi + kargo künyesi (yoksa talep alanları / null).
          supplierName: resolveOrderSupplierName(order?.items ?? []),
          supplierOrderNo: order?.supplierOrderNo ?? null,
          cargoCompany: order?.cargoCompany ?? rest.carrier ?? null,
          cargoBarcode:
            order?.cargoBarcode ??
            order?.trackingNumber ??
            rest.trackingCode ??
            null,
        };
      }),
    );

    return {
      success: true,
      data: enriched,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string) {
    const item = await this.prisma.supportMessage.findUnique({
      where: { id },
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            mimetype: true,
            size: true,
            storageKey: true,
            createdAt: true,
            purgedAt: true,
          },
        },
        customer: { select: { phone: true } },
        order: {
          select: {
            supplierOrderNo: true,
            cargoCompany: true,
            cargoBarcode: true,
            trackingNumber: true,
            items: {
              select: {
                supplierOverride: { select: { name: true } },
                supplierNameSnapshot: true,
                product: { select: { supplier: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('support message not found');
    const attachments = await this.attachUrls(item.attachments ?? []);
    // Talep açıldığında sohbet thread'ini DAİMA garanti et: müşteri girişli
    // taleplerde sohbet yoksa lazily oluşturup geçmişi (müşteri mesajı + varsa
    // admin yanıtı) tohumlar. Böylece admin her zaman chat görür.
    const conversationId = await this.ensureConversationForTicket(item.id, {
      includeAdminReply: true,
    });
    const { customer, order, returnInvoiceKey, ...rest } = item;
    return {
      success: true,
      data: {
        ...rest,
        attachments,
        returnInvoiceUrl: await this.signReturnInvoiceUrl(returnInvoiceKey),
        customerPhone: customer?.phone ?? null,
        conversationId,
        supplierName: resolveOrderSupplierName(order?.items ?? []),
        supplierOrderNo: order?.supplierOrderNo ?? null,
        cargoCompany: order?.cargoCompany ?? rest.carrier ?? null,
        cargoBarcode:
          order?.cargoBarcode ??
          order?.trackingNumber ??
          rest.trackingCode ??
          null,
      },
    };
  }

  /**
   * Bir destek talebine bağlı sohbet id'sini döndürür (yoksa null). Anonim
   * iletişim formu ticket'larında sohbet açılmadığı için null gelir. Ucuz tek
   * sorgu — admin/müşteri detayında thread'i açabilmek için.
   */
  private async resolveConversationId(
    supportTicketId: string,
  ): Promise<string | null> {
    const convo = await this.prisma.conversation.findUnique({
      where: { supportTicketId },
      select: { id: true },
    });
    return convo?.id ?? null;
  }

  /** Birden çok ticket için supportTicketId → conversation id eşlemesi. */
  private async resolveConversationIdMap(
    supportTicketIds: string[],
  ): Promise<Map<string, string>> {
    if (supportTicketIds.length === 0) return new Map();
    const convos = await this.prisma.conversation.findMany({
      where: { supportTicketId: { in: supportTicketIds } },
      select: { id: true, supportTicketId: true },
    });
    const map = new Map<string, string>();
    for (const c of convos) {
      if (c.supportTicketId) map.set(c.supportTicketId, c.id);
    }
    return map;
  }

  /**
   * Bir destek talebine bağlı sohbet thread'inin var olmasını GARANTİ eder ve
   * boşsa geçmişi tohumlar. Müşteri girişli taleplerde (customerId dolu):
   *  - Sohbet yoksa oluşturur.
   *  - Sohbet hiç mesaj içermiyorsa müşterinin açılış mesajını (talep gövdesi +
   *    ekleri) CUSTOMER mesajı olarak, `includeAdminReply` ise mevcut admin
   *    notunu ADMIN mesajı olarak DOĞRUDAN insert eder — bildirim/mail/statü
   *    otomasyonu tetiklemeden (postMessage side-effect'leri YOK), yalnızca
   *    görüntülenebilir geçmiş.
   * Anonim iletişim formu taleplerinde (customerId yok) sohbet açılmaz → null.
   * Non-fatal: hata halinde mevcut conversation id (veya null) döner.
   *
   * `includeAdminReply` seçimi çift-yazımı önler: yanıt (update) akışından
   * çağrılırken false verilir; çünkü admin notu ayrıca thread'e köprülenir
   * (bkz. update()'deki bridge). Açılış/okuma (findOne) akışında true'dur ki
   * geçmiş talepler tam dökülsün.
   */
  private async ensureConversationForTicket(
    ticketId: string,
    opts: { includeAdminReply?: boolean } = {},
  ): Promise<string | null> {
    const includeAdminReply = opts.includeAdminReply ?? true;

    const ticket = await this.prisma.supportMessage.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        customerId: true,
        body: true,
        adminNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!ticket) return null;

    // Anonim (iletişim formu) talepleri: sohbet yok.
    if (!ticket.customerId) {
      return this.resolveConversationId(ticketId);
    }
    const customerId = ticket.customerId;

    try {
      const existing = await this.prisma.conversation.findUnique({
        where: { supportTicketId: ticketId },
        select: { id: true, _count: { select: { messages: true } } },
      });
      // Zaten mesaj varsa dokunma — thread mevcut.
      if (existing && existing._count.messages > 0) return existing.id;

      let conversationId = existing?.id ?? null;
      if (!conversationId) {
        const tenantId = await this.adminNotifier.resolveDefaultTenantId();
        if (!tenantId) {
          this.logger.warn(
            `[support.ensureConversation] tenant bulunamadı ticket=${ticketId}`,
          );
          return null;
        }
        const created = await this.conversations.getOrCreateForSupportTicket({
          tenantId,
          supportTicketId: ticketId,
          customerId,
        });
        conversationId = created.id;
      }

      await this.seedConversationHistory(conversationId, ticket, includeAdminReply);
      return conversationId;
    } catch (err) {
      this.logger.warn(
        `[support.ensureConversation] failed ticket=${ticketId}: ${(err as Error).message}`,
      );
      return this.resolveConversationId(ticketId).catch(() => null);
    }
  }

  /**
   * Boş bir sohbeti talebin geçmişiyle DOĞRUDAN doldurur (side-effect'siz).
   * Yarış güvencesi: arada mesaj eklendiyse hiçbir şey yapmaz.
   */
  private async seedConversationHistory(
    conversationId: string,
    ticket: {
      id: string;
      customerId: string | null;
      body: string;
      adminNote: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    includeAdminReply: boolean,
  ): Promise<void> {
    const count = await this.prisma.conversationMessage.count({
      where: { conversationId },
    });
    if (count > 0) return;

    // 1) Müşterinin açılış mesajı (talep gövdesi) + ekleri.
    const body = (ticket.body ?? '').trim();
    const ticketAttachments = await this.prisma.supportMessageAttachment.findMany(
      {
        where: { ticketId: ticket.id },
        select: {
          storageKey: true,
          filename: true,
          mimetype: true,
          size: true,
        },
      },
    );
    if (body.length > 0 || ticketAttachments.length > 0) {
      const opening = await this.prisma.conversationMessage.create({
        data: {
          conversationId,
          senderType: ConversationSenderType.CUSTOMER,
          senderCustomerId: ticket.customerId,
          body,
          // Geçmiş backfill: her iki taraf da okunmuş sayılır ki bu tohumlama
          // "yeni okunmamış mesaj" gürültüsü üretmesin.
          createdAt: ticket.createdAt,
          readByAdminAt: ticket.createdAt,
          readByCounterpartyAt: ticket.createdAt,
        },
      });
      for (const att of ticketAttachments) {
        await this.prisma.conversationMessageAttachment.create({
          data: {
            messageId: opening.id,
            storageKey: att.storageKey,
            filename: att.filename,
            mimetype: att.mimetype,
            size: att.size,
          },
        });
      }
    }

    // 2) Varsa mevcut admin yanıtı (adminNote) — ADMIN mesajı olarak.
    const note = (ticket.adminNote ?? '').trim();
    if (includeAdminReply && note.length > 0) {
      await this.prisma.conversationMessage.create({
        data: {
          conversationId,
          senderType: ConversationSenderType.ADMIN,
          body: note,
          createdAt: ticket.updatedAt,
          readByAdminAt: ticket.updatedAt,
          readByCounterpartyAt: ticket.updatedAt,
        },
      });
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: ticket.updatedAt },
    });
  }

  /**
   * Resolves storage keys to (signed) URLs the client can render. We always
   * return both `storageKey` and `url` so the admin UI can build full origin
   * paths if needed; the URL itself is the primary value to use.
   */
  private async attachUrls(
    rows: Array<{
      id: string;
      filename: string;
      mimetype: string;
      size: number;
      storageKey: string;
      createdAt: Date;
      purgedAt: Date | null;
    }>,
  ) {
    if (rows.length === 0) {
      return [] as Array<
        (typeof rows)[number] & { url: string | null; purged: boolean }
      >;
    }
    if (!this.storage) {
      return rows.map((r) => ({
        ...r,
        url: null as string | null,
        purged: r.purgedAt !== null,
      }));
    }
    const storage = this.storage;
    return Promise.all(
      rows.map(async (r) => {
        // 30 günlük R2 saklama süresi dolduysa signed URL üretme; UI
        // "Görsel süresi doldu (30 gün)" mesajını gösterir.
        if (r.purgedAt) {
          return { ...r, url: null as string | null, purged: true };
        }
        try {
          const url = await storage.getSignedUrl(r.storageKey, 600);
          return { ...r, url, purged: false };
        } catch (err) {
          this.logger.warn(
            `attachment url generation failed key=${r.storageKey}: ${(err as Error).message}`,
          );
          return { ...r, url: null as string | null, purged: false };
        }
      }),
    );
  }

  /**
   * İADE FATURASI (PDF) için taze imzalı URL üretir (600 sn). Ham storageKey
   * asla dışarı verilmez (private prefix). Key yoksa/hata olursa null döner.
   */
  private async signReturnInvoiceUrl(
    key: string | null | undefined,
  ): Promise<string | null> {
    if (!key || !this.storage) return null;
    try {
      return await this.storage.getSignedUrl(key, 600);
    } catch (err) {
      this.logger.warn(
        `return invoice url üretilemedi key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Müşteri response'undan iç storage anahtarını kaldırır. storageKey, yalnız
   * admin tarafının doğrudan storage URL üretebilmesi için sızdırılan bir iç
   * detay; müşteri arayüzü imzalı `url` alanını kullanır, anahtara ihtiyacı
   * yoktur ve diğer ticket'ların key formatını tahmin etmesi için ipucu
   * olmamalıdır (#H-2).
   */
  private stripStorageKeys<
    T extends { storageKey?: string | null },
  >(rows: T[]): Array<Omit<T, 'storageKey'>> {
    return rows.map((row) => {
      const { storageKey: _omit, ...rest } = row;
      return rest;
    });
  }

  /**
   * Stabil ticket numarası — DB migration olmadan id+createdAt'tan türetilir.
   * `AB-{YYYY}-{ID son 6 alfanumerik karakter, upper}` formatında olur ve
   * aynı id için her zaman aynı değeri döner (arama yapılabilir).
   */
  private deriveTicketNo(id: string, createdAt: Date): string {
    const clean = id.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const tail = clean.slice(-6).padStart(6, '0');
    return `AB-${createdAt.getFullYear()}-${tail}`;
  }

  /**
   * Customer-scoped findOne — returns ticket + attachment URLs only when the
   * caller owns the ticket. Throws NotFound otherwise so we don't leak
   * existence to other customers.
   */
  async findOneForCustomer(id: string, customerId: string) {
    const item = await this.prisma.supportMessage.findFirst({
      where: { id, customerId },
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            mimetype: true,
            size: true,
            storageKey: true,
            createdAt: true,
            purgedAt: true,
          },
        },
        order: {
          select: {
            id: true,
            humanOrderNo: true,
            endCustomerName: true,
            customerName: true,
            marketplace: true,
            cargoCompany: true,
            cargoBarcode: true,
            total: true,
            currency: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                productName: true,
                productSlug: true,
                qty: true,
                unitPrice: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    images: {
                      select: { url: true, position: true },
                      orderBy: { position: 'asc' },
                      take: 1,
                    },
                  },
                },
              },
              take: 10,
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('ticket not found');
    const attachments = this.stripStorageKeys(
      await this.attachUrls(item.attachments ?? []),
    );
    const conversationId = await this.resolveConversationId(item.id);
    const orderSnapshot = this.buildSafeOrderSnapshot(item.order);
    const { order: _order, returnInvoiceKey, ...rest } = item;
    return {
      success: true,
      data: {
        ...rest,
        attachments,
        returnInvoiceUrl: await this.signReturnInvoiceUrl(returnInvoiceKey),
        conversationId,
        ticketNo: this.deriveTicketNo(item.id, item.createdAt),
        orderSnapshot,
      },
    };
  }

  /**
   * Customer-scoped list — same filtering as the controller used to do
   * inline, but now goes through the service so attachment URLs are
   * resolved consistently.
   */
  async listForCustomer(customerId: string, orderId?: string | null) {
    const items = await this.prisma.supportMessage.findMany({
      where: orderId ? { customerId, orderId } : { customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            mimetype: true,
            size: true,
            storageKey: true,
            createdAt: true,
            purgedAt: true,
          },
        },
        order: {
          select: {
            id: true,
            humanOrderNo: true,
            endCustomerName: true,
            customerName: true,
            marketplace: true,
            cargoCompany: true,
            cargoBarcode: true,
            total: true,
            currency: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                productName: true,
                productSlug: true,
                qty: true,
                unitPrice: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    images: {
                      select: { url: true, position: true },
                      orderBy: { position: 'asc' },
                      take: 1,
                    },
                  },
                },
              },
              take: 10,
            },
          },
        },
      },
    });
    const convoMap = await this.resolveConversationIdMap(
      items.map((i) => i.id),
    );
    const enriched = await Promise.all(
      items.map(async (item) => {
        const attachments = this.stripStorageKeys(
          await this.attachUrls(item.attachments ?? []),
        );
        const orderSnapshot = this.buildSafeOrderSnapshot(item.order);
        const { order: _order, returnInvoiceKey, ...rest } = item;
        return {
          ...rest,
          attachments,
          returnInvoiceUrl: await this.signReturnInvoiceUrl(returnInvoiceKey),
          conversationId: convoMap.get(item.id) ?? null,
          ticketNo: this.deriveTicketNo(item.id, item.createdAt),
          orderSnapshot,
        };
      }),
    );
    return { success: true, data: enriched };
  }

  /**
   * Müşterinin KENDİ talebini kapatması. Yalnız sahibi olduğu (customerId)
   * talep kapatılabilir; kapatma = soft-archive (ARCHIVED), admin tarafının
   * `remove(soft)` davranışını birebir yansıtır ama sahiplik kontrolü ekler.
   * Zaten kapalıysa idempotent döner (çift tık / yarış güvenli).
   */
  async closeForCustomer(id: string, customerId: string) {
    const existing = await this.prisma.supportMessage.findFirst({
      where: { id, customerId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('support message not found');

    if (existing.status === 'ARCHIVED') {
      return {
        success: true,
        data: { closed: true, alreadyClosed: true, id },
      };
    }

    const archived = await this.prisma.supportMessage.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    return {
      success: true,
      data: { closed: true, alreadyClosed: false, item: archived },
    };
  }

  /**
   * Son {@link SUPPORT_TICKET_STALE_DAYS} gün boyunca güncellenmemiş (status
   * değişmemiş) açık talepleri toplu otomatik kapatır. `updatedAt @updatedAt`
   * olduğundan herhangi bir aktivite (admin yanıtı, status değişimi) zamanı
   * tazeler; bu yüzden `updatedAt < now - N gün` = "N gündür hareketsiz".
   * ARCHIVED zaten kapalı, dokunulmaz. Cron tarafından çağrılır; `now`
   * parametresi test edilebilirlik içindir.
   */
  async autoCloseStaleTickets(now: Date = new Date()) {
    const threshold = new Date(now.getTime() - SUPPORT_TICKET_STALE_DAYS * DAY_MS);
    const result = await this.prisma.supportMessage.updateMany({
      where: {
        status: { not: 'ARCHIVED' },
        updatedAt: { lt: threshold },
      },
      data: { status: 'ARCHIVED' },
    });
    if (result.count > 0) {
      this.logger.log(
        `Auto-closed ${result.count} stale support ticket(s) (>${SUPPORT_TICKET_STALE_DAYS}d inactive)`,
      );
    }
    return {
      success: true,
      data: { closed: result.count, threshold },
    };
  }

  /**
   * Çözülmüş iptal taleplerini hızlı kapatır: "Cevaplandı" (REPLIED) olan,
   * kategorisi "iptal" ve bağlı siparişi ARTIK 'cancelled' olan talepleri,
   * cevaplandıktan ~5 dk sonra ARCHIVED yapar. Müşteri kısa süre "Cevaplandı"
   * görür, sonra talep kapanır; admin/müşteri listesinde açık asılı kalmaz.
   *
   * Yarış güvencesi: müşteri arada yeni mesaj yazarsa conversation otomasyonu
   * talebi NEW'e çeker (updatedAt tazelenir + status REPLIED değil) → bu süpürge
   * onu KAPATMAZ. updateMany where'ine status=REPLIED tekrar konularak DB
   * seviyesinde de garanti edilir.
   */
  async autoCloseResolvedCancellationTickets(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - RESOLVED_CANCEL_CLOSE_MS);
    const candidates = await this.prisma.supportMessage.findMany({
      where: {
        status: SupportMessageStatus.REPLIED,
        category: 'iptal',
        updatedAt: { lte: cutoff },
        // Yalnız siparişi GERÇEKTEN iptal olmuş talepler (oto-onay veya elle
        // iptal sonrası). Siparişi iptal OLMAYAN iptal talepleri (ör. admin
        // "iptal edemiyoruz" yanıtı) bu hızlı kapatmaya GİRMEZ.
        order: { is: { status: 'cancelled' } },
      },
      select: { id: true },
    });
    if (candidates.length === 0) {
      return { success: true, data: { closed: 0 } };
    }
    const result = await this.prisma.supportMessage.updateMany({
      where: {
        id: { in: candidates.map((c) => c.id) },
        status: SupportMessageStatus.REPLIED,
      },
      data: { status: SupportMessageStatus.ARCHIVED },
    });
    if (result.count > 0) {
      this.logger.log(
        `Auto-closed ${result.count} resolved cancellation ticket(s) (REPLIED + sipariş iptal, >5dk)`,
      );
    }
    return { success: true, data: { closed: result.count } };
  }

  /**
   * Order ilişkisinden müşteri-yüzlü SAFE snapshot üretir.
   * Maliyet/tedarikçi/komisyon bilgilerini ASLA içermez (cost/profit
   * confidentiality — tedarikçi adı, costPrice, kâr farkı vs. müşteriye
   * çıkmaz). Yalnız son müşteri ismi, kargo, ürün adı/görseli ve müşterinin
   * gördüğü birim fiyat döner.
   */
  private buildSafeOrderSnapshot(
    order:
      | {
          id: string;
          humanOrderNo: string;
          endCustomerName: string | null;
          customerName: string;
          marketplace: string | null;
          cargoCompany: string | null;
          cargoBarcode: string | null;
          total: Prisma.Decimal;
          currency: string;
          createdAt: Date;
          items: Array<{
            id: string;
            productName: string;
            productSlug: string;
            qty: number;
            unitPrice: Prisma.Decimal;
            product: {
              id: string;
              name: string;
              slug: string;
              images: Array<{ url: string; position: number }>;
            } | null;
          }>;
        }
      | null
      | undefined,
  ) {
    if (!order) return null;
    return {
      orderId: order.id,
      humanOrderNo: order.humanOrderNo,
      recipientName: order.endCustomerName ?? order.customerName,
      marketplace: order.marketplace,
      cargoCompany: order.cargoCompany,
      cargoBarcode: order.cargoBarcode,
      total: order.total.toString(),
      currency: order.currency,
      createdAt: order.createdAt,
      items: order.items.map((it) => ({
        id: it.id,
        name: it.product?.name ?? it.productName,
        slug: it.product?.slug ?? it.productSlug,
        qty: it.qty,
        unitPrice: it.unitPrice.toString(),
        imageUrl: it.product?.images?.[0]?.url ?? null,
      })),
    };
  }

  async update(
    id: string,
    dto: UpdateSupportMessageDto,
    actor?: { id: string; tenantId: string; name?: string | null; email?: string | null } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.supportMessage.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        adminNote: true,
        status: true,
        customerId: true,
        body: true,
        orderNumber: true,
        category: true,
        createdAt: true,
      },
    });
    if (!existing) throw new NotFoundException('support message not found');

    const data: Prisma.SupportMessageUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.adminNote !== undefined) data.adminNote = dto.adminNote;

    // Admin bir not kaydettiğinde ve talep hâlâ NEW kalacaksa otomatik READ yap
    // → "Yeni" badge'inden düşer (kullanıcı: not yazınca yeni olarak görmeyeyim).
    // REPLIED YAPMA: REPLIED müşteriye e-posta + thread mesajı tetikler; burada
    // yalnız iç admin notu var. Müşteriye açık yanıt admin'in EXPLICIT aksiyonudur.
    const savingNote =
      dto.adminNote !== undefined && dto.adminNote.trim().length > 0;
    const effectiveStatus = dto.status ?? existing.status;
    if (savingNote && effectiveStatus === 'NEW') {
      data.status = 'READ';
    }

    const updated = await this.prisma.supportMessage.update({
      where: { id },
      data,
    });

    // Sohbet thread'ini + müşterinin açılış mesajını garanti et (yalnız açılış;
    // admin notu aşağıdaki bridge ile ayrıca eklenir → includeAdminReply:false
    // ile çift-yazım önlenir). Böylece yanıt/kapatma/okuma sonrası dönen kayıt
    // daima conversationId taşır ve chat görünür kalır. Non-fatal.
    if (existing.customerId) {
      await this.ensureConversationForTicket(id, {
        includeAdminReply: false,
      }).catch((err) =>
        this.logger.warn(
          `[support.update] conversation ensure failed ticket=${id}: ${(err as Error).message}`,
        ),
      );
    }

    const replyBody = dto.adminNote ?? existing.adminNote ?? null;
    if (dto.status === 'REPLIED' && replyBody && existing.email) {
      void this.mail
        .sendSupportReply({
          to: existing.email,
          recipientName: existing.name,
          subject: existing.subject ?? 'Destek Talebiniz',
          body: replyBody,
          originalMessage: existing.body,
          orderNumber: existing.orderNumber,
          category: existing.category,
          createdAt: existing.createdAt,
        })
        .catch((e) =>
          this.logger.error('support reply mail failed', e as Error),
        );
    }

    // Talep REPLIED'a alındığında bu talebe ait okunmamış admin bildirimleri
    // otomatik okundu işaretle. Müşteri girişli ticket'lerde conversation
    // bridge'i postMessage üzerinden zaten yapıyor; burada özellikle anonim
    // iletişim formu (conversation yok) bildirimleri için de güvence.
    if (dto.status === 'REPLIED') {
      void this.prisma.notification
        .updateMany({
          where: {
            readAt: null,
            role: 'ADMIN',
            OR: [
              { data: { path: ['messageId'], equals: existing.id } },
              { data: { path: ['supportTicketId'], equals: existing.id } },
            ],
          },
          data: { readAt: new Date() },
        })
        .catch((e) =>
          this.logger.warn(
            `[support.update] auto-resolve notifications failed id=${existing.id} err=${(e as Error).message}`,
          ),
        );
    }

    // Backward-compat bridge: an admin reply (status → REPLIED with a
    // non-empty adminNote) is also posted as an ADMIN thread message so the
    // customer sees it inside the two-way chat. Only for customer-owned
    // tickets that have a customerId (anonymous contact-form tickets have no
    // conversation). Non-fatal: never break the admin update if threading
    // fails. Keeps the existing email behavior untouched.
    const bridgeNote = dto.adminNote?.trim();
    if (dto.status === 'REPLIED' && bridgeNote && existing.customerId && actor) {
      const customerId = existing.customerId;
      const tenantId = actor.tenantId;
      const actorUserId = actor.id;
      void (async () => {
        try {
          const conversation =
            await this.conversations.getOrCreateForSupportTicket({
              tenantId,
              supportTicketId: existing.id,
              customerId,
            });
          await this.conversations.postMessage({
            conversationId: conversation.id,
            senderType: ConversationSenderType.ADMIN,
            senderUserId: actorUserId,
            body: bridgeNote,
            // OLD endpoint already sent sendSupportReply above; suppress to
            // avoid duplicate mail.
            suppressMail: true,
          });
        } catch (err) {
          this.logger.error(
            `[support.update] admin reply bridge failed ticket=${existing.id}`,
            err as Error,
          );
        }
      })();
    }

    if (actor) {
      void (async () => {
        try {
          const adminLabel = actor.name?.trim() || actor.email || 'Admin';
          const changeBits: string[] = [];
          if (dto.status !== undefined && dto.status !== existing.status) {
            changeBits.push(`durum ${existing.status} → ${dto.status}`);
          }
          if (dto.adminNote !== undefined && dto.adminNote !== existing.adminNote) {
            changeBits.push('admin notu güncellendi');
          }
          const changeText = changeBits.length ? ` (${changeBits.join(', ')})` : '';
          const isReply = dto.status === 'REPLIED' && dto.adminNote !== undefined;
          const action = isReply ? 'ADMIN_SUPPORT_REPLY' : 'ADMIN_SUPPORT_UPDATE';
          const summary = isReply
            ? `${adminLabel} ${existing.name} (${existing.email}) destek talebine yanıt verdi`
            : `${adminLabel} ${existing.name} destek talebini güncelledi${changeText}`;
          await this.audit.record({
            action,
            summary,
            actor: {
              type: 'admin',
              id: actor.id,
              name: actor.name ?? null,
              email: actor.email ?? null,
              tenantId: actor.tenantId,
            },
            target: {
              id: existing.id,
              type: 'support_message',
              label: existing.name,
            },
            before: { status: existing.status, adminNote: existing.adminNote },
            after: { status: updated.status, adminNote: updated.adminNote },
            req: req ?? null,
          });
        } catch (e) {
          this.logger.warn(
            `Failed to record ADMIN_SUPPORT_UPDATE audit: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      })();
    }

    // Zenginleştirilmiş kaydı döndür (conversationId + tedarikçi/kargo künyesi
    // dahil). Ham `updated` satırı conversationId taşımadığı için frontend
    // markAsRead/yanıt/kapatma sonrası chat'i kaybediyordu — bu düzeltir.
    return this.findOne(id);
  }

  /**
   * Soft-delete: mark as ARCHIVED so admins can recover.
   * Pass `?hard=true` to genuinely delete the row.
   */
  async remove(
    id: string,
    hard = false,
    actor?: { id: string; tenantId: string; name?: string | null; email?: string | null } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.supportMessage.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, subject: true, status: true },
    });
    if (!existing) throw new NotFoundException('support message not found');

    if (hard) {
      // Best-effort storage cleanup before deleting the row. The FK
      // ON DELETE CASCADE removes the attachment rows automatically, so
      // we read keys first and then unlink them in storage.
      if (this.storage) {
        const attachments = await this.prisma.supportMessageAttachment.findMany(
          { where: { ticketId: id }, select: { storageKey: true } },
        );
        for (const att of attachments) {
          try {
            await this.storage.delete(att.storageKey);
          } catch (err) {
            this.logger.warn(
              `support storage delete failed key=${att.storageKey}: ${(err as Error).message}`,
            );
          }
        }
      }
      await this.prisma.supportMessage.delete({ where: { id } });
      this.recordRemoveAudit(existing, actor, req, true);
      return { success: true, data: { deleted: true, archived: false } };
    }

    const archived = await this.prisma.supportMessage.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    this.recordRemoveAudit(existing, actor, req, false);
    return { success: true, data: { deleted: false, archived: true, item: archived } };
  }

  private recordRemoveAudit(
    existing: { id: string; name: string; email: string | null; subject: string | null; status: SupportMessageStatus },
    actor: { id: string; tenantId: string; name?: string | null; email?: string | null } | null | undefined,
    req: Request | null | undefined,
    hard: boolean,
  ) {
    if (!actor) return;
    void (async () => {
      try {
        const adminLabel = actor.name?.trim() || actor.email || 'Admin';
        const verb = hard ? 'sildi' : 'arşivledi';
        const action = hard ? 'ADMIN_SUPPORT_DELETE' : 'ADMIN_SUPPORT_ARCHIVE';
        await this.audit.record({
          action,
          summary: `${adminLabel} ${existing.name} destek talebini ${verb}`,
          actor: {
            type: 'admin',
            id: actor.id,
            name: actor.name ?? null,
            email: actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: { id: existing.id, type: 'support_message', label: existing.name },
          extra: {
            email: existing.email,
            subject: existing.subject,
            previousStatus: existing.status,
            mode: hard ? 'hard' : 'soft',
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record support remove audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();
  }
}

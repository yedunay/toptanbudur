import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Conversation,
  ConversationMessage,
  ConversationSenderType,
  ConversationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import { detectMedia } from '../common/utils/image-magic-bytes';
import { maskNameToInitials } from './name-mask.util';

/**
 * In-memory representation of a multipart file accepted by the controllers.
 * Mirrors Multer's shape but kept narrow so the service does not depend on any
 * specific upload middleware (same pattern as SupportMessagesService).
 */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

export type ConversationViewer =
  | { kind: 'admin' }
  | { kind: 'customer'; customerId: string };

const MAX_ATTACHMENTS = 5;
// Foto + video kabulü (2026-08-02): iPhone HEIC ve videolar reddedildiği
// için bayiler ek yükleyemiyordu. nginx client_max_body_size ile senkron tut.
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/** "DEALER_BUYER" / "DEALER_SELLER" → karşı taraf gönderen tipi. */
const RETURN_COUNTERPART: Record<string, ConversationSenderType> = {
  DEALER_BUYER: 'DEALER_SELLER',
  DEALER_SELLER: 'DEALER_BUYER',
};

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: IFileStorage,
  ) {}

  // ---------------------------------------------------------------------------
  // get-or-create
  // ---------------------------------------------------------------------------

  async getOrCreateForSupportTicket(params: {
    tenantId: string;
    supportTicketId: string;
    customerId: string;
  }): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { supportTicketId: params.supportTicketId },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        tenantId: params.tenantId,
        type: ConversationType.SUPPORT,
        supportTicketId: params.supportTicketId,
        buyerCustomerId: params.customerId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // postMessage
  // ---------------------------------------------------------------------------

  async postMessage(params: {
    conversationId: string;
    senderType: ConversationSenderType;
    senderCustomerId?: string | null;
    senderUserId?: string | null;
    body?: string | null;
    files?: UploadedFile[];
    /**
     * SupportMessagesService.update bridge çağrısı buradan true geçer; çünkü
     * eski PATCH endpoint zaten `sendSupportReply` ile mail atıyor. Çift mail
     * önlemek için flag.
     */
    suppressMail?: boolean;
    /**
     * Talep OLUŞTURULURKEN atılan tohum mesajı buradan true geçer; çünkü
     * ticket create akışı zaten "[Admin] Yeni destek talebi" maili atıyor.
     * Admin tarafına ikinci "Talebe yeni mesaj" maili gitmesin.
     */
    suppressAdminMail?: boolean;
  }): Promise<ConversationMessage> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: params.conversationId },
    });
    if (!conversation) throw new NotFoundException('conversation not found');

    const body = (params.body ?? '').trim();
    const files = params.files ?? [];

    if (body.length === 0 && files.length === 0) {
      throw new ForbiddenException('Mesaj boş olamaz (metin veya görsel gerekli).');
    }

    // Validate attachments (magic-byte) BEFORE persisting anything.
    type ValidatedAttachment = {
      original: UploadedFile;
      mimetype: string;
      extension: string;
    };
    if (files.length > MAX_ATTACHMENTS) {
      throw new ForbiddenException(
        `En fazla ${MAX_ATTACHMENTS} adet dosya yükleyebilirsiniz.`,
      );
    }
    const validated: ValidatedAttachment[] = files.map((file) => {
      if (file.size > MAX_FILE_BYTES) {
        throw new ForbiddenException(
          `Dosya boyutu 100 MB sınırını aşıyor: ${file.originalname}`,
        );
      }
      const detected = detectMedia(file.buffer);
      if (!detected) {
        throw new ForbiddenException(
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
      throw new ForbiddenException('Dosya depolama servisi yapılandırılmamış.');
    }

    const now = new Date();
    const isFromAdmin = params.senderType === ConversationSenderType.ADMIN;

    // Unread reset semantics: when a sender posts, THEIR own side is implicitly
    // read; the recipient side stays unread (timestamp null) for new message.
    const message = await this.prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        senderType: params.senderType,
        senderCustomerId: params.senderCustomerId ?? null,
        senderUserId: params.senderUserId ?? null,
        body,
        // Sender'ın kendi tarafı okunmuş sayılır.
        readByAdminAt: isFromAdmin ? now : null,
        readByCounterpartyAt: isFromAdmin ? null : now,
      },
    });

    // Persist attachments after the message exists so the FK is valid.
    if (validated.length > 0 && this.storage) {
      for (const att of validated) {
        const fileId = randomUUID();
        const key = `conversation-messages/${message.id}/${fileId}.${att.extension}`;
        try {
          await this.storage.upload(key, att.original.buffer, att.mimetype);
          await this.prisma.conversationMessageAttachment.create({
            data: {
              messageId: message.id,
              storageKey: key,
              filename: att.original.originalname.slice(0, 255),
              mimetype: att.mimetype,
              size: att.original.size,
            },
          });
        } catch (err) {
          this.logger.error(
            `conversation attachment upload failed message=${message.id} key=${key}`,
            err as Error,
          );
        }
      }
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });

    // Admin SUPPORT sohbetine yanıt yazdığında müşteriye mail gönder. Eski
    // PATCH endpoint bridge ile çağırırken suppressMail:true geçer (orada
    // ayrıca sendSupportReply çağrılıyor; çift mail önleme).
    if (
      isFromAdmin &&
      conversation.type === ConversationType.SUPPORT &&
      conversation.supportTicketId &&
      !params.suppressMail &&
      body.length > 0
    ) {
      void this.sendSupportReplyMail(conversation.supportTicketId, body).catch(
        (e) =>
          this.logger.error(
            `[conversations.postMessage] support reply mail failed: ${(e as Error).message}`,
            e as Error,
          ),
      );
    }

    // Admin yanıt verdiğinde bu sohbete/talebe ait okunmamış admin
    // bildirimlerini otomatik okundu işaretle — kullanıcı zaten yanıtladı,
    // bildirim merkezinde asılı kalmasın.
    if (isFromAdmin) {
      void this.resolveAdminNotificationsForConversation(conversation).catch(
        (e) =>
          this.logger.warn(
            `[conversations.postMessage] auto-resolve notifications failed: ${(e as Error).message}`,
          ),
      );
    }

    // SUPPORT ticket status otomasyonu:
    //  - Admin yazınca NEW/READ → REPLIED.
    //  - Müşteri yazınca NEW DIŞINDAKİ her statü (READ/REPLIED/ARCHIVED) → NEW:
    //    yeni müşteri mesajı, cevaplanmış/kapatılmış talebi bile yeniden
    //    "Beklemede" yapar ki admin "Sipariş Talepleri" listesinde görsün.
    if (
      conversation.type === ConversationType.SUPPORT &&
      conversation.supportTicketId
    ) {
      const ticketId = conversation.supportTicketId;
      const targetStatus = isFromAdmin ? 'REPLIED' : 'NEW';
      void this.prisma.supportMessage
        .updateMany({
          where: {
            id: ticketId,
            status: isFromAdmin ? { in: ['NEW', 'READ'] } : { not: 'NEW' },
          },
          data: { status: targetStatus },
        })
        .then((r) => {
          if (r.count === 0) {
            this.logger.debug(
              `[conversations.postMessage] ticket=${ticketId} statü reset 0 satır (zaten ${targetStatus})`,
            );
          }
        })
        .catch((e) =>
          this.logger.warn(
            `[conversations.postMessage] support status auto-update failed ticket=${ticketId}: ${(e as Error).message}`,
          ),
        );
    }

    void this.emitForMessage(
      conversation,
      params.senderType,
      body,
      validated.length,
      params.suppressAdminMail === true,
    ).catch(
      (e) =>
        this.logger.warn(
          `[conversations.postMessage] notification emit failed: ${(e as Error).message}`,
        ),
    );

    return message;
  }

  /**
   * Admin yanıt yazdığında bu sohbete (ve varsa bağlı support ticket'a) ait
   * okunmamış admin bildirimlerini otomatik okundu işaretler. `data` JSON
   * payload'ı `conversationId`, `supportTicketId` veya legacy
   * `support.message` bildirimlerindeki `messageId` üzerinden eşlenir.
   */
  private async resolveAdminNotificationsForConversation(
    conversation: Conversation,
  ): Promise<void> {
    const now = new Date();
    const orFilters: Prisma.NotificationWhereInput[] = [
      { data: { path: ['conversationId'], equals: conversation.id } },
    ];
    if (conversation.supportTicketId) {
      // Yeni conversation.message bildirimleri supportTicketId taşır.
      orFilters.push({
        data: { path: ['supportTicketId'], equals: conversation.supportTicketId },
      });
      // Eski support.message bildirimlerinde SupportMessage.id "messageId"
      // alanında tutuluyor — aynı talebe ait olanları da işaretle.
      orFilters.push({
        data: { path: ['messageId'], equals: conversation.supportTicketId },
      });
    }
    await this.prisma.notification.updateMany({
      where: {
        readAt: null,
        role: 'ADMIN',
        OR: orFilters,
      },
      data: { readAt: now },
    });
  }

  /**
   * SUPPORT sohbetinde admin yanıtı için müşteriye mail. SupportMessage'tan
   * email/ad/konuyu okur, sendSupportReply çağırır.
   */
  private async sendSupportReplyMail(
    supportTicketId: string,
    body: string,
  ): Promise<void> {
    const ticket = await this.prisma.supportMessage.findUnique({
      where: { id: supportTicketId },
      select: {
        email: true,
        name: true,
        subject: true,
        body: true,
        orderNumber: true,
        category: true,
        createdAt: true,
      },
    });
    if (!ticket?.email) return;
    await this.mail.sendSupportReply({
      to: ticket.email,
      recipientName: ticket.name,
      subject: ticket.subject ?? 'Destek Talebiniz',
      body,
      originalMessage: ticket.body,
      orderNumber: ticket.orderNumber,
      category: ticket.category,
      createdAt: ticket.createdAt,
    });
  }

  /**
   * Karşı tarafa (ve iade sohbetlerinde admin'e) bildirim gönderir.
   * SUPPORT: müşteri yazarsa admin'e; admin yazarsa müşteriye (push yok — sadece
   * okunmamış sayacıyla görür).
   * DEALER_RETURN_ORDER: her mesajda admin'e bildirim; karşı taraf bayi
   * okunmamış sayacından görür.
   */
  private async emitForMessage(
    conversation: Conversation,
    senderType: ConversationSenderType,
    body: string,
    attachmentCount: number,
    suppressAdminMail = false,
  ): Promise<void> {
    const preview =
      body.length > 0
        ? body.slice(0, 140)
        : `${attachmentCount} görsel`;

    const isReturn = conversation.type === ConversationType.DEALER_RETURN_ORDER;
    // SUPPORT sohbeti bir destek talebine bağlıysa, talebin türüne göre doğru
    // admin sayfasına yönlendir: sipariş destek talebi → talep detay drawer'ı
    // (/orders/talepler?ticketId=...), aksi halde genel mesaj listesi. Talebin
    // kind/orderId'si conversation üzerinde tutulmadığı için tek seferlik lookup
    // yapıyoruz. (Aynı lookup admin mailindeki gönderen/konu bilgisini de besler.)
    let supportLink: string | null = null;
    let ticketInfo: {
      name: string | null;
      email: string | null;
      subject: string | null;
      orderNumber: string | null;
    } | null = null;
    if (!isReturn && conversation.supportTicketId) {
      const ticket = await this.prisma.supportMessage
        .findUnique({
          where: { id: conversation.supportTicketId },
          select: {
            kind: true,
            orderId: true,
            name: true,
            email: true,
            subject: true,
            orderNumber: true,
          },
        })
        .catch(() => null);
      if (ticket) {
        ticketInfo = {
          name: ticket.name ?? null,
          email: ticket.email ?? null,
          subject: ticket.subject ?? null,
          orderNumber: ticket.orderNumber ?? null,
        };
      }
      const isOrderTicket =
        ticket?.kind === 'order' || Boolean(ticket?.orderId);
      supportLink = isOrderTicket
        ? `/orders/talepler?ticketId=${conversation.supportTicketId}`
        : `/mesajlar?source=SUPPORT&conversationId=${conversation.id}`;
    }
    const link = isReturn
      ? // İade (DEALER_RETURN_ORDER) sohbeti Konuşmalar sayfasında görülür;
        // ?conversationId ile ilgili sohbet otomatik açılır. ESKİ '/orders/iadeler'
        // route'u yoktu → '/orders/:id' (id='iadeler') ile hatalı sipariş detayı açıyordu.
        `/konusmalar?conversationId=${conversation.id}`
      : (supportLink ?? `/mesajlar?conversationId=${conversation.id}`);

    // Admin'e bildirim: iade sohbetlerinde her mesajda; support'ta müşteri
    // yazdığında.
    const notifyAdmin =
      isReturn || senderType !== ConversationSenderType.ADMIN;
    if (notifyAdmin) {
      // Kendi try/catch'inde: bildirim yazımı (Notification insert) geçici
      // hata verirse aşağıdaki admin maili yine de gitsin — iki kanal
      // birbirinden gerçekten bağımsız.
      try {
        await this.notifications.emit({
          type: 'conversation.message',
          severity: 'info',
          title: isReturn ? 'Yeni iade mesajı' : 'Yeni sohbet mesajı',
          body: preview,
          link,
          data: {
            conversationId: conversation.id,
            conversationType: conversation.type,
            orderId: conversation.orderId,
            supportTicketId: conversation.supportTicketId,
          },
          audience: { role: 'ADMIN' },
        });
      } catch (e) {
        this.logger.warn(
          `[conversations] notification emit failed conv=${conversation.id}: ${(e as Error).message}`,
        );
      }
    }

    // Müşteri/bayi yazdıysa admin tarafına MAİL de düşer (patron kararı
    // 2026-08-01: müşteriden gelen her mesaj mail olarak da gitmeli).
    // Talep oluşturmadaki tohum mesajı hariç — onun "Yeni destek talebi"
    // maili zaten support-messages.create'ten gidiyor.
    if (!suppressAdminMail && senderType !== ConversationSenderType.ADMIN) {
      await this.sendAdminConversationMail(
        conversation,
        senderType,
        body,
        attachmentCount,
        ticketInfo,
        isReturn,
      );
    }
  }

  /**
   * Müşteri/bayi mesajı için admin tarafına mail. Bildirimden bağımsız
   * try/catch — mail hatası sohbet akışını ve in-app bildirimi bozmaz.
   */
  private async sendAdminConversationMail(
    conversation: Conversation,
    senderType: ConversationSenderType,
    body: string,
    attachmentCount: number,
    ticketInfo: {
      name: string | null;
      email: string | null;
      subject: string | null;
      orderNumber: string | null;
    } | null,
    isReturn: boolean,
  ): Promise<void> {
    try {
      const emails = await this.adminNotifier.resolveAdminEmails(
        conversation.tenantId,
        OPS_NOTIFY_ROLES,
      );
      if (emails.length === 0) return;

      let senderName = 'Bayi';
      let senderEmail: string | null = null;
      let subject: string | null = null;
      let humanOrderNo: string | null = null;

      if (!isReturn && ticketInfo) {
        senderName = ticketInfo.name?.trim() || senderName;
        senderEmail = ticketInfo.email ?? null;
        subject = ticketInfo.subject ?? null;
        humanOrderNo = ticketInfo.orderNumber ?? null;
      } else if (isReturn) {
        const customerId =
          senderType === ConversationSenderType.DEALER_SELLER
            ? conversation.sellerCustomerId
            : conversation.buyerCustomerId;
        if (customerId) {
          const cust = await this.prisma.customer
            .findUnique({
              where: { id: customerId },
              select: { name: true, email: true },
            })
            .catch(() => null);
          if (cust) {
            senderName = cust.name?.trim() || senderName;
            senderEmail = cust.email ?? null;
          }
        }
        if (conversation.orderId) {
          const ord = await this.prisma.order
            .findUnique({
              where: { id: conversation.orderId },
              select: { humanOrderNo: true },
            })
            .catch(() => null);
          humanOrderNo = ord?.humanOrderNo ?? null;
        }
      }

      await this.mail.sendAdminConversationMessage({
        to: emails,
        kind: isReturn ? 'return' : 'support',
        senderName,
        senderEmail,
        subject,
        humanOrderNo,
        message: body.length > 0 ? body : `${attachmentCount} görsel eki`,
        adminUrl: null,
      });
    } catch (e) {
      this.logger.warn(
        `[conversations] admin mail failed conv=${conversation.id}: ${(e as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // listMessages
  // ---------------------------------------------------------------------------

  async listMessages(params: {
    conversationId: string;
    viewer: ConversationViewer;
  }) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: params.conversationId },
    });
    if (!conversation) throw new NotFoundException('conversation not found');

    await this.assertViewerAccess(conversation, params.viewer);

    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            mimetype: true,
            size: true,
            storageKey: true,
            createdAt: true,
          },
        },
      },
    });

    // Resolve display labels (masked for cross-dealer customer viewers).
    const labeler = await this.buildSenderLabeler(conversation, params.viewer);

    const enriched = await Promise.all(
      messages.map(async (m) => {
        const attachments = await this.attachUrls(m.attachments ?? []);
        // Hide internal storage keys from customer responses.
        const safeAttachments =
          params.viewer.kind === 'customer'
            ? attachments.map(({ storageKey: _omit, ...rest }) => rest)
            : attachments;
        const mine =
          params.viewer.kind === 'admin'
            ? m.senderType === 'ADMIN'
            : m.senderCustomerId === params.viewer.customerId;
        return {
          id: m.id,
          conversationId: m.conversationId,
          senderType: m.senderType,
          senderLabel: labeler(m.senderType),
          body: m.body,
          mine,
          readByAdminAt: m.readByAdminAt,
          readByCounterpartyAt: m.readByCounterpartyAt,
          createdAt: m.createdAt,
          attachments: safeAttachments,
        };
      }),
    );

    // Admin viewer için zengin bağlam (müşteri tarafına ASLA gönderilmez —
    // tedarikçi adı/maliyet bilgisi sızdırılmaz; bu blok yalnızca admin için).
    const adminContext =
      params.viewer.kind === 'admin'
        ? await this.buildAdminContext(conversation)
        : null;

    return {
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          type: conversation.type,
          orderId: conversation.orderId,
          supportTicketId: conversation.supportTicketId,
          lastMessageAt: conversation.lastMessageAt,
          ...(adminContext ? { context: adminContext } : {}),
        },
        messages: enriched,
      },
    };
  }

  /**
   * Bir gönderen tipini, viewer'a göre görünür etikete çevirir. Müşteri,
   * iade sohbetinde karşı taraf bayinin adını maskeli (Y.E.D.) görür; admin tam
   * adı görür. SUPPORT'ta müşteri admin'i "Destek" olarak görür.
   */
  private async buildSenderLabeler(
    conversation: Conversation,
    viewer: ConversationViewer,
  ): Promise<(senderType: ConversationSenderType) => string> {
    if (conversation.type === ConversationType.SUPPORT) {
      const customerName = await this.resolveCustomerName(
        conversation.buyerCustomerId,
      );
      return (senderType) => {
        if (senderType === ConversationSenderType.ADMIN) return 'Destek';
        // Müşteri tarafı: admin tam adı görür, müşteri kendini görür.
        if (viewer.kind === 'admin') return customerName ?? 'Bayi';
        return 'Siz';
      };
    }

    // DEALER_RETURN_ORDER
    const [buyerName, sellerName] = await Promise.all([
      this.resolveCustomerName(conversation.buyerCustomerId),
      this.resolveCustomerName(conversation.sellerCustomerId),
    ]);

    const maskFor = (
      senderCustomerId: string | null,
      fullName: string | null,
    ): string => {
      const safe = fullName ?? 'Bayi';
      if (viewer.kind === 'admin') return safe;
      // Müşteri viewer: kendisi tam görünür, karşı taraf maskeli.
      if (
        senderCustomerId &&
        viewer.customerId === senderCustomerId
      ) {
        return safe;
      }
      return maskNameToInitials(safe) || 'Bayi';
    };

    return (senderType) => {
      switch (senderType) {
        case ConversationSenderType.ADMIN:
          return 'Destek';
        case ConversationSenderType.DEALER_BUYER:
          return maskFor(conversation.buyerCustomerId, buyerName);
        case ConversationSenderType.DEALER_SELLER:
          return maskFor(conversation.sellerCustomerId, sellerName);
        default:
          return 'Bayi';
      }
    };
  }

  // ---------------------------------------------------------------------------
  // markRead
  // ---------------------------------------------------------------------------

  async markRead(params: {
    conversationId: string;
    viewer: ConversationViewer;
  }): Promise<{ success: true; updated: number }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: params.conversationId },
    });
    if (!conversation) throw new NotFoundException('conversation not found');

    await this.assertViewerAccess(conversation, params.viewer);

    const now = new Date();
    if (params.viewer.kind === 'admin') {
      // Admin, admin-olmayan (karşı taraf) mesajları okur.
      const res = await this.prisma.conversationMessage.updateMany({
        where: {
          conversationId: conversation.id,
          senderType: { not: ConversationSenderType.ADMIN },
          readByAdminAt: null,
        },
        data: { readByAdminAt: now },
      });
      return { success: true, updated: res.count };
    }

    // Customer viewer: kendi gönderdikleri hariç okunmamışları okundu yap.
    const res = await this.prisma.conversationMessage.updateMany({
      where: {
        conversationId: conversation.id,
        // Sadece kendisinin OLMADIĞI mesajları okundu işaretle.
        NOT: { senderCustomerId: params.viewer.customerId },
        readByCounterpartyAt: null,
      },
      data: { readByCounterpartyAt: now },
    });
    return { success: true, updated: res.count };
  }

  // ---------------------------------------------------------------------------
  // unread counts
  // ---------------------------------------------------------------------------

  async unreadCountForCustomer(customerId: string): Promise<number> {
    // Müşterinin katıldığı sohbetler.
    const convoIds = await this.customerConversationIds(customerId);
    if (convoIds.length === 0) return 0;
    return this.prisma.conversationMessage.count({
      where: {
        conversationId: { in: convoIds },
        readByCounterpartyAt: null,
        // Müşterinin kendi mesajları sayılmaz.
        NOT: { senderCustomerId: customerId },
        senderType: { not: ConversationSenderType.CUSTOMER },
      },
    });
  }

  async unreadCountForAdmin(): Promise<number> {
    return this.prisma.conversationMessage.count({
      where: {
        senderType: { not: ConversationSenderType.ADMIN },
        readByAdminAt: null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // lists
  // ---------------------------------------------------------------------------

  async listForCustomer(customerId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [
          { buyerCustomerId: customerId },
          { sellerCustomerId: customerId },
        ],
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const data = await Promise.all(
      conversations.map(async (c) => {
        const unread = await this.prisma.conversationMessage.count({
          where: {
            conversationId: c.id,
            readByCounterpartyAt: null,
            NOT: { senderCustomerId: customerId },
            senderType: { not: ConversationSenderType.CUSTOMER },
          },
        });
        const participantLabel = await this.counterpartyLabelForCustomer(
          c,
          customerId,
        );
        return {
          id: c.id,
          type: c.type,
          orderId: c.orderId,
          supportTicketId: c.supportTicketId,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          participantLabel,
          unread: unread > 0,
          unreadCount: unread,
        };
      }),
    );

    return { success: true, data };
  }

  async listForAdmin(filter?: { type?: ConversationType }) {
    const where: Prisma.ConversationWhereInput = {};
    if (filter?.type) where.type = filter.type;

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const data = await Promise.all(
      conversations.map(async (c) => {
        const unread = await this.prisma.conversationMessage.count({
          where: {
            conversationId: c.id,
            senderType: { not: ConversationSenderType.ADMIN },
            readByAdminAt: null,
          },
        });
        const [buyerName, sellerName, orderInfo, ticketSubject] =
          await Promise.all([
            this.resolveCustomerName(c.buyerCustomerId),
            this.resolveCustomerName(c.sellerCustomerId),
            c.orderId
              ? this.prisma.order.findUnique({
                  where: { id: c.orderId },
                  select: { humanOrderNo: true },
                })
              : Promise.resolve(null),
            c.supportTicketId
              ? this.prisma.supportMessage.findUnique({
                  where: { id: c.supportTicketId },
                  select: { subject: true },
                })
              : Promise.resolve(null),
          ]);
        return {
          id: c.id,
          type: c.type,
          orderId: c.orderId,
          orderCode: orderInfo?.humanOrderNo ?? null,
          supportTicketId: c.supportTicketId,
          subject: ticketSubject?.subject ?? null,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          // Admin tam adları görür.
          buyerName,
          sellerName,
          unread: unread > 0,
          unreadCount: unread,
        };
      }),
    );

    return { success: true, data };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /**
   * Müşteri viewer bir sohbete mesaj gönderirken doğru senderType'ı belirler ve
   * katılımcı erişimini doğrular. SUPPORT → CUSTOMER; iade → alıcıysa
   * DEALER_BUYER, satıcıysa DEALER_SELLER. Katılımcı değilse Forbidden.
   */
  async resolveCustomerSenderType(
    conversationId: string,
    customerId: string,
  ): Promise<ConversationSenderType> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('conversation not found');
    await this.assertViewerAccess(conversation, {
      kind: 'customer',
      customerId,
    });

    if (conversation.type === ConversationType.SUPPORT) {
      return ConversationSenderType.CUSTOMER;
    }
    if (conversation.buyerCustomerId === customerId) {
      return ConversationSenderType.DEALER_BUYER;
    }
    if (conversation.sellerCustomerId === customerId) {
      return ConversationSenderType.DEALER_SELLER;
    }
    // assertViewerAccess zaten yukarıda geçti; buraya düşmez.
    throw new ForbiddenException('Bu sohbete erişiminiz yok.');
  }

  /** Bir müşterinin katılımcı olduğu sohbet id'leri. */
  private async customerConversationIds(customerId: string): Promise<string[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        OR: [
          { buyerCustomerId: customerId },
          { sellerCustomerId: customerId },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Müşteri viewer'ın bu sohbete erişimi var mı? buyer/seller (iade) veya ticket
   * sahibi (support buyerCustomerId). Yoksa ForbiddenException.
   */
  private async assertViewerAccess(
    conversation: Conversation,
    viewer: ConversationViewer,
  ): Promise<void> {
    if (viewer.kind === 'admin') return;
    const isParticipant =
      conversation.buyerCustomerId === viewer.customerId ||
      conversation.sellerCustomerId === viewer.customerId;
    if (!isParticipant) {
      throw new ForbiddenException('Bu sohbete erişiminiz yok.');
    }
  }

  /** Karşı tarafın müşteri için gösterilecek etiketi (maskeli/Destek). */
  private async counterpartyLabelForCustomer(
    conversation: Conversation,
    customerId: string,
  ): Promise<string> {
    if (conversation.type === ConversationType.SUPPORT) {
      return 'Destek';
    }
    // İade: karşı taraf bayinin adı maskeli.
    const otherId =
      conversation.buyerCustomerId === customerId
        ? conversation.sellerCustomerId
        : conversation.buyerCustomerId;
    const name = await this.resolveCustomerName(otherId);
    return maskNameToInitials(name ?? 'Bayi') || 'Bayi';
  }

  private async resolveCustomerName(
    customerId: string | null,
  ): Promise<string | null> {
    if (!customerId) return null;
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    return c?.name ?? null;
  }

  /**
   * Admin paneli için sohbete bağlı tüm bağlamı (müşteri, sipariş, ürün,
   * tedarikçi, kargo, iade) tek seferde toparlar. Müşteri viewer'a ASLA
   * dönülmez (tedarikçi adı/maliyet bilgisi sızdırma riski).
   */
  private async buildAdminContext(conversation: Conversation) {
    type CustomerInfo = {
      id: string | null;
      name: string;
      phone: string | null;
      email: string | null;
    };
    type OrderInfo = {
      id: string;
      code: string;
      status: string;
      supplierOrderNo: string | null;
      marketplace: string | null;
      cargoCompany: string | null;
      cargoBarcode: string | null;
      trackingNumber: string | null;
    };
    type ProductInfo = {
      id: string | null;
      name: string;
      slug: string | null;
      barcode: string | null;
      sku: string | null;
      supplierOrderNo: string | null;
    };
    type SupplierInfo = { id: string; name: string };

    const ctx: {
      subject: string | null;
      kind: string | null;
      category: string | null;
      ticketStatus: string | null;
      customer: CustomerInfo | null;
      buyer: CustomerInfo | null;
      seller: CustomerInfo | null;
      order: OrderInfo | null;
      product: ProductInfo | null;
      supplier: SupplierInfo | null;
      shipping: {
        marketplace: string | null;
        carrier: string | null;
        trackingCode: string | null;
      } | null;
    } = {
      subject: null,
      kind: null,
      category: null,
      ticketStatus: null,
      customer: null,
      buyer: null,
      seller: null,
      order: null,
      product: null,
      supplier: null,
      shipping: null,
    };

    if (conversation.supportTicketId) {
      const ticket = await this.prisma.supportMessage.findUnique({
        where: { id: conversation.supportTicketId },
        include: { customer: true, order: true },
      });
      if (ticket) {
        ctx.subject = ticket.subject ?? null;
        ctx.kind = ticket.kind ?? null;
        ctx.category = ticket.category ?? null;
        ctx.ticketStatus = ticket.status;
        ctx.shipping = {
          marketplace: ticket.marketplace ?? null,
          carrier: ticket.carrier ?? null,
          trackingCode: ticket.trackingCode ?? null,
        };
        if (ticket.customer) {
          ctx.customer = {
            id: ticket.customer.id,
            name: ticket.customer.name,
            phone: ticket.customer.phone ?? null,
            email: ticket.customer.email,
          };
        } else {
          ctx.customer = {
            id: null,
            name: ticket.name,
            phone: null,
            email: ticket.email,
          };
        }
        if (ticket.order) {
          ctx.order = {
            id: ticket.order.id,
            code: ticket.order.humanOrderNo,
            status: ticket.order.status,
            supplierOrderNo: ticket.order.supplierOrderNo ?? null,
            marketplace: ticket.order.marketplace ?? null,
            cargoCompany: ticket.order.cargoCompany ?? null,
            cargoBarcode: ticket.order.cargoBarcode ?? null,
            trackingNumber: ticket.order.trackingNumber ?? null,
          };
        }
      }
    }

    if (!ctx.order && conversation.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: conversation.orderId },
        include: {
          customer: true,
          items: {
            include: {
              product: { include: { supplier: true } },
              supplierOverride: true,
            },
            take: 1,
          },
        },
      });
      if (order) {
        ctx.order = {
          id: order.id,
          code: order.humanOrderNo,
          status: order.status,
          supplierOrderNo: order.supplierOrderNo ?? null,
          marketplace: order.marketplace ?? null,
          cargoCompany: order.cargoCompany ?? null,
          cargoBarcode: order.cargoBarcode ?? null,
          trackingNumber: order.trackingNumber ?? null,
        };
        if (order.customer && !ctx.customer) {
          ctx.customer = {
            id: order.customer.id,
            name: order.customer.name,
            phone: order.customer.phone ?? null,
            email: order.customer.email,
          };
        }
        const firstItem = order.items[0];
        if (firstItem) {
          const supplier =
            firstItem.supplierOverride ?? firstItem.product?.supplier ?? null;
          ctx.product = {
            id: firstItem.productId,
            name: firstItem.productName,
            slug: firstItem.productSlug,
            barcode:
              firstItem.supplierBarcodeOverride ??
              firstItem.supplierBarcode ??
              firstItem.product?.barcode ??
              null,
            sku:
              firstItem.supplierSkuOverride ?? firstItem.supplierSku ?? null,
            supplierOrderNo: firstItem.supplierOrderNo ?? null,
          };
          if (supplier) {
            ctx.supplier = { id: supplier.id, name: supplier.name };
          }
        }
      }
    }

    if (conversation.type === ConversationType.DEALER_RETURN_ORDER) {
      if (conversation.buyerCustomerId) {
        const buyer = await this.prisma.customer.findUnique({
          where: { id: conversation.buyerCustomerId },
          select: { id: true, name: true, phone: true, email: true },
        });
        if (buyer) {
          ctx.buyer = {
            id: buyer.id,
            name: buyer.name,
            phone: buyer.phone ?? null,
            email: buyer.email,
          };
          if (!ctx.customer) ctx.customer = ctx.buyer;
        }
      }
      if (conversation.sellerCustomerId) {
        const seller = await this.prisma.customer.findUnique({
          where: { id: conversation.sellerCustomerId },
          select: { id: true, name: true, phone: true, email: true },
        });
        if (seller) {
          ctx.seller = {
            id: seller.id,
            name: seller.name,
            phone: seller.phone ?? null,
            email: seller.email,
          };
        }
      }
    }

    return ctx;
  }

  /** Storage anahtarlarını imzalı URL'lere çevirir (support ile aynı desen). */
  private async attachUrls(
    rows: Array<{
      id: string;
      filename: string;
      mimetype: string;
      size: number;
      storageKey: string;
      createdAt: Date;
    }>,
  ) {
    if (!this.storage || rows.length === 0) {
      return rows.map((r) => ({ ...r, url: null as string | null }));
    }
    const storage = this.storage;
    return Promise.all(
      rows.map(async (r) => {
        try {
          const url = await storage.getSignedUrl(r.storageKey, 600);
          return { ...r, url };
        } catch (err) {
          this.logger.warn(
            `attachment url generation failed key=${r.storageKey}: ${(err as Error).message}`,
          );
          return { ...r, url: null as string | null };
        }
      }),
    );
  }
}

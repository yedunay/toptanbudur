import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuditService } from '../audit/audit.service';
import { markOrderPaid } from '../admin/orders/mark-order-paid.helper';

function formatTry(amount: number | Prisma.Decimal): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return `₺${n.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function customerLabel(c: { name?: string | null; email?: string | null } | null | undefined): string {
  if (!c) return 'müşteri';
  return c.name?.trim() || c.email?.trim() || 'müşteri';
}

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected'] as const;
type CariStatus = (typeof ALLOWED_STATUSES)[number];

// Cari (vadeli) ödeme talebi sadece henüz tamamlanmamış / iptal edilmemiş
// siparişler için açılabilir. Reddedilmiş, iptal edilmiş, iade edilmiş veya
// zaten ödenmiş siparişlere talep oluşturulamaz.
// Not: `pending` OrderStatus'u kaldırıldıktan sonra yeni sipariş varsayılan
// olarak `paid` durumunda yaratılır; cari onay süreci `cariApprovalStatus`
// üzerinden takip edilir.
const CARI_REQUESTABLE_ORDER_STATUSES = [
  'paid',
  'preparing',
] as const;
type CariRequestableOrderStatus =
  (typeof CARI_REQUESTABLE_ORDER_STATUSES)[number];

@Injectable()
export class CariPaymentsService {
  private readonly logger = new Logger(CariPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly settings: AppSettingsService,
    private readonly audit: AuditService,
  ) {}

  async requestForOrder(
    customerId: string,
    orderId: string,
    note?: string,
    req?: Request | null,
  ) {
    // §2.1 — VADELİ (açık-hesap) AKIŞI KALDIRILDI (2026-06-24 kararı).
    // Yeni vadeli talep oluşturma customer-cari-payments.controller seviyesinde
    // 410 Gone ile engellenir; bu metoda artık ulaşılmaz. Mevcut PENDING
    // talepler admin tarafından reddedilebilir (decide korunur). Detay:
    // cariBalance/CariLedger'a hiç yazmadığı için mutabakatta görünmüyordu.
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        tenantId: true,
        total: true,
        currency: true,
        humanOrderNo: true,
        customerEmail: true,
        customerName: true,
        paymentType: true,
        cariApprovalStatus: true,
        status: true,
      },
    });
    if (!order) throw new NotFoundException('order not found');

    // C-18: Reddedilmiş / iptal edilmiş / iade edilmiş / ödenmiş siparişlere
    // cari ödeme talebi açılması yasak. `requestForOrder` yalnızca akış halindeki
    // (paid/preparing) siparişler için izin verir.
    if (
      !CARI_REQUESTABLE_ORDER_STATUSES.includes(
        order.status as CariRequestableOrderStatus,
      )
    ) {
      throw new BadRequestException(
        'cari payment cannot be requested for this order status',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent duplicate cari payment creation.
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE
      `;
      const existing = await tx.cariPayment.findUnique({
        where: { orderId: order.id },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('cari payment already requested for this order');
      }

      const payment = await tx.cariPayment.create({
        data: {
          orderId: order.id,
          customerId,
          amount: order.total,
          status: 'pending',
          note: note ?? null,
        },
        select: {
          id: true,
          status: true,
          amount: true,
          requestedAt: true,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentType: 'cari',
          cariApprovalStatus: 'pending',
        },
      });
      return payment;
    });

    if (order.customerEmail) {
      void this.mail
        .sendCariRequestReceived({
          to: order.customerEmail,
          customerName: order.customerName ?? '',
          humanOrderNo: order.humanOrderNo,
          amount: Number(order.total),
          currency: order.currency,
        })
        .catch((e) =>
          this.logger.error('cari request mail failed', e as Error),
        );
    }

    // Fire-and-forget admin bildirimi. CariPayment sipariş bazlı tenant-scoped.
    void (async () => {
      const emails = await this.adminNotifier.resolveAdminEmails(
        order.tenantId,
        OPS_NOTIFY_ROLES,
      );
      if (emails.length === 0) {
        this.logger.warn(
          `[cari.payment.create] admin notification skipped — tenant=${order.tenantId} mail alıcısı yok cariPaymentId=${created.id}`,
        );
        return;
      }
      await this.mail.sendAdminNewCariPaymentRequest({
        to: emails,
        customerName: order.customerName ?? '(bilinmiyor)',
        customerEmail: order.customerEmail ?? null,
        humanOrderNo: order.humanOrderNo ?? null,
        amount: Number(order.total),
        currency: order.currency,
        adminUrl: null,
      });
    })().catch((e) =>
      this.logger.warn(
        `[cari.payment.create] admin mail failed cariPaymentId=${created.id} err=${(e as Error).message}`,
      ),
    );

    void (async () => {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { name: true, email: true },
        });
        const cLabel = customerLabel(customer);
        const orderLabel = order.humanOrderNo ?? order.id;
        const amountText = formatTry(Number(order.total));
        await this.audit.record({
          action: 'CARI_PAYMENT_REQUEST_CREATE',
          summary: `${cLabel} #${orderLabel} siparişi için ${amountText} cari (vadeli) ödeme talebi oluşturdu`,
          actor: {
            type: 'customer',
            id: customerId,
            name: customer?.name ?? null,
            email: customer?.email ?? null,
            tenantId: order.tenantId,
          },
          target: {
            id: created.id,
            type: 'cari_payment',
            label: `#${orderLabel}`,
          },
          extra: {
            orderId: order.id,
            humanOrderNo: order.humanOrderNo,
            amount: Number(order.total),
            currency: order.currency,
            note: note ?? null,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record CARI_PAYMENT_REQUEST_CREATE audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return {
      success: true,
      data: {
        id: created.id,
        status: created.status,
        amount: Number(created.amount),
        requestedAt: created.requestedAt,
      },
    };
  }

  async listForAdmin(tenantId: string, status?: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where: Prisma.CariPaymentWhereInput = { order: { tenantId } };
    if (status) {
      if (!ALLOWED_STATUSES.includes(status as CariStatus)) {
        throw new BadRequestException('invalid status filter');
      }
      where.status = status;
    }

    const [total, rows] = await Promise.all([
      this.prisma.cariPayment.count({ where }),
      this.prisma.cariPayment.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          status: true,
          amount: true,
          requestedAt: true,
          decidedAt: true,
          note: true,
          order: {
            select: {
              id: true,
              humanOrderNo: true,
              total: true,
              currency: true,
              createdAt: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        status: p.status,
        amount: Number(p.amount),
        requestedAt: p.requestedAt,
        decidedAt: p.decidedAt,
        note: p.note,
        order: {
          id: p.order.id,
          humanOrderNo: p.order.humanOrderNo,
          total: Number(p.order.total),
          currency: p.order.currency,
          createdAt: p.order.createdAt,
        },
        customer: p.customer,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeSize,
        totalPages: Math.ceil(total / safeSize),
      },
    };
  }

  async decide(
    cariPaymentId: string,
    decidedByUserId: string,
    tenantId: string,
    decision: 'approved' | 'rejected',
    note?: string,
    actorEmail?: string | null,
    req?: Request | null,
  ) {
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new BadRequestException('decision must be approved or rejected');
    }

    const existing = await this.prisma.cariPayment.findFirst({
      where: { id: cariPaymentId, order: { tenantId } },
      select: {
        id: true,
        status: true,
        amount: true,
        order: {
          select: {
            id: true,
            humanOrderNo: true,
            customerEmail: true,
            customerName: true,
            currency: true,
            status: true,
            paidAt: true,
            customerId: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            companyTitle: true,
            vergiNo: true,
            vergiDairesi: true,
            tcKimlik: true,
            email: true,
            phone: true,
            contactPhone: true,
            companyAddress: true,
            addresses: {
              where: { isDefault: true },
              take: 1,
              select: {
                line1: true,
                city: true,
                district: true,
                postalCode: true,
              },
            },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('cari payment not found');
    if (existing.status !== 'pending') {
      throw new ConflictException('cari payment already decided');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cp = await tx.cariPayment.update({
        where: { id: cariPaymentId },
        data: {
          status: decision,
          decidedAt: new Date(),
          decidedByUserId,
          note: note ?? undefined,
        },
        select: {
          id: true,
          status: true,
          decidedAt: true,
          note: true,
          amount: true,
        },
      });

      const orderUpdate: Prisma.OrderUpdateInput = { cariApprovalStatus: decision };
      if (decision === 'approved' && existing.order.status !== 'paid' && !existing.order.paidAt) {
        orderUpdate.status = 'paid';
      }
      await tx.order.update({
        where: { id: existing.order.id },
        data: orderUpdate,
      });

      if (decision === 'approved' && existing.order.status !== 'paid' && !existing.order.paidAt && existing.customer) {
        const addr = existing.customer.addresses?.[0] ?? null;
        await markOrderPaid({
          tx,
          settings: this.settings,
          orderId: existing.order.id,
          customer: existing.customer,
          customerAddress: addr,
        });
      }

      return cp;
    });

    const email = existing.order.customerEmail;
    if (email) {
      const payload = {
        to: email,
        customerName: existing.order.customerName ?? '',
        humanOrderNo: existing.order.humanOrderNo,
        amount: Number(existing.amount),
        currency: existing.order.currency,
        note: note ?? null,
      };
      const sender =
        decision === 'approved'
          ? this.mail.sendCariApproved(payload)
          : this.mail.sendCariRejected(payload);
      void sender.catch((e) =>
        this.logger.error('cari decision mail failed', e as Error),
      );
    }

    void (async () => {
      try {
        const admin = await this.prisma.user
          .findUnique({
            where: { id: decidedByUserId },
            select: { name: true, email: true },
          })
          .catch(() => null);
        const adminLabel =
          admin?.name?.trim() || admin?.email?.trim() || actorEmail || 'admin';
        const cLabel = customerLabel(existing.customer);
        const orderLabel = existing.order.humanOrderNo ?? existing.order.id;
        const amountText = formatTry(Number(existing.amount));
        const action =
          decision === 'approved'
            ? 'CARI_PAYMENT_APPROVE'
            : 'CARI_PAYMENT_REJECT';
        const summary =
          decision === 'approved'
            ? `${adminLabel} ${cLabel} müşterisinin #${orderLabel} siparişi için ${amountText} cari ödeme talebini onayladı`
            : `${adminLabel} ${cLabel} müşterisinin #${orderLabel} siparişi için ${amountText} cari ödeme talebini reddetti${
                note ? ` — sebep: ${note}` : ''
              }`;

        await this.audit.record({
          action,
          summary,
          actor: {
            type: 'admin',
            id: decidedByUserId,
            name: admin?.name ?? null,
            email: admin?.email ?? actorEmail ?? null,
            tenantId,
          },
          target: {
            id: cariPaymentId,
            type: 'cari_payment',
            label: `#${orderLabel}`,
          },
          extra: {
            orderId: existing.order.id,
            humanOrderNo: existing.order.humanOrderNo,
            customerId: existing.customer?.id ?? null,
            customerName: existing.customer?.name ?? null,
            amount: Number(existing.amount),
            currency: existing.order.currency,
            note: note ?? null,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record cari decision audit: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    })();

    return {
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        decidedAt: updated.decidedAt,
        note: updated.note,
        amount: Number(updated.amount),
      },
    };
  }
}

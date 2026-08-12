import { Global, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { Subject } from 'rxjs';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType =
  | 'order.new'
  | 'order.status'
  | 'lead.new'
  | 'stock.low'
  | 'support.message'
  | 'conversation.message'
  | 'cari.topup.requested'
  | 'customer.vacation'
  | 'house_stock.reserved'
  | 'supplier.balance.low'
  | 'bot.failed'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAudience {
  /** Specific user — wins over `role` if both provided */
  userId?: string | null;
  /** Role-wide fanout (e.g. all OWNERs+ADMINs) */
  role?: 'OWNER' | 'ADMIN' | null;
}

export interface EmitNotificationInput {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  link?: string | null;
  data?: Record<string, unknown> | null;
  audience: NotificationAudience;
}

export interface BroadcastPayload {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  audience: { userId: string | null; role: string | null };
}

/**
 * Admin Bildirim Merkezi — `emit()` 3 kanaldan birden yayar:
 *   1. DB'ye yazılır (geçmiş + sayma için)
 *   2. SSE stream üzerinden anında broadcast'lenir (`/admin/notifications/stream`)
 *   3. Hedef kullanıcının PushSubscription'larına web-push gönderir
 *
 * `audience.userId` verilmezse `audience.role` üzerinden fanout — tüm OWNER ve
 * ADMIN kullanıcılarına ayrı satır yazmaz, tek bir role-targeted satır yazılır
 * ve subscription'lar da rol bazlı çekilir.
 */
@Global()
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly stream$ = new Subject<BroadcastPayload>();
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY') ?? '';
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY') ?? '';
    const subject =
      this.config.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@toptanbudur.com';

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.vapidConfigured = true;
        this.logger.log('VAPID web-push configured');
      } catch (err) {
        this.logger.warn(
          `Failed to configure VAPID: ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.warn(
        'VAPID keys not set — browser push disabled (SSE still works)',
      );
    }
  }

  getVapidPublicKey(): string | null {
    return this.vapidConfigured
      ? (this.config.get<string>('VAPID_PUBLIC_KEY') ?? null)
      : null;
  }

  /** SSE consumers subscribe to this Subject. */
  getStream(): Subject<BroadcastPayload> {
    return this.stream$;
  }

  async emit(input: EmitNotificationInput): Promise<BroadcastPayload> {
    const severity: NotificationSeverity = input.severity ?? 'info';
    const userId = input.audience.userId ?? null;
    const role = userId ? null : (input.audience.role ?? 'ADMIN');

    const created = await this.prisma.notification.create({
      data: {
        userId,
        role,
        type: input.type,
        severity,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        data: (input.data as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });

    const payload: BroadcastPayload = {
      id: created.id,
      type: input.type,
      severity,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      data: input.data ?? null,
      createdAt: created.createdAt.toISOString(),
      audience: { userId, role },
    };

    // 2. Broadcast on SSE stream (consumers filter by audience client-side / in controller)
    this.stream$.next(payload);

    // 3. Fan out to web-push subscriptions
    this.dispatchPush(payload).catch((err) => {
      this.logger.warn(`Push dispatch failed: ${(err as Error).message}`);
    });

    return payload;
  }

  private async dispatchPush(payload: BroadcastPayload): Promise<void> {
    if (!this.vapidConfigured) return;

    // Hedef kullanıcıları belirle. ADMIN hedefi OWNER'ı da kapsar (admin-tier
    // aynı bildirimi alır); OWNER hedefi yalnızca OWNER'lar.
    let userIds: string[] = [];
    if (payload.audience.userId) {
      userIds = [payload.audience.userId];
    } else if (payload.audience.role) {
      const roles: Role[] =
        payload.audience.role === 'ADMIN'
          ? (['ADMIN', 'OWNER'] as Role[])
          : ([payload.audience.role] as Role[]);
      const users = await this.prisma.user.findMany({
        where: { role: { in: roles } },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    }
    if (userIds.length === 0) return;

    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      link: payload.link,
      severity: payload.severity,
      type: payload.type,
      id: payload.id,
    });

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
            { TTL: 60 * 60 * 24 },
          );
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsed: new Date() },
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410 → subscription expired, remove it
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          } else {
            this.logger.warn(
              `Push send failed (${status ?? 'no-status'}): ${(err as Error).message}`,
            );
          }
        }
      }),
    );
  }
}

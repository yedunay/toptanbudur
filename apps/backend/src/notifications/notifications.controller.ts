import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import type { Subscription } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

class SubscribePushDto {
  @IsString()
  @MinLength(10)
  endpoint!: string;

  @IsString()
  @MinLength(10)
  p256dh!: string;

  @IsString()
  @MinLength(10)
  auth!: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

class ListNotificationsDto {
  @IsOptional()
  @IsIn(['unread', 'all'])
  filter?: 'unread' | 'all';
}

/**
 * Admin-tier rolleri ortak ses sahnesinde paylaşır: OWNER hem ADMIN'e
 * gönderilenleri hem kendi OWNER hedefli olanları görür; ADMIN ise sadece
 * ADMIN ses sahnesini. Böylece `audience: { role: 'ADMIN' }` ile yayılan
 * sipariş/destek/iade bildirimleri OWNER kullanıcısında da görünür.
 */
function audienceRolesFor(role: string): string[] {
  if (role === 'OWNER') return ['OWNER', 'ADMIN'];
  if (role === 'ADMIN') return ['ADMIN'];
  return [role];
}

/**
 * Bildirim merkezinde gösterilmeyen tipler. Yeni sipariş bildirimi
 * sipariş listesinde zaten görüldüğü için bildirim olarak yayınlanmaz;
 * geçmişte yazılmış kayıtlar da bu filtre ile gizlenir.
 */
const HIDDEN_NOTIFICATION_TYPES = ['order.new'] as const;

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('bildirimler')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Sayfa açılışında — son 50 bildirim + okunmamış sayısı */
  @Get()
  async list(
    @Query() query: ListNotificationsDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const filter = query.filter ?? 'all';
    const audienceRoles = audienceRolesFor(req.user.role);
    const audienceOr = [
      { userId: req.user.id },
      { userId: null, role: { in: audienceRoles } },
    ];
    const typeExclusion = { type: { notIn: [...HIDDEN_NOTIFICATION_TYPES] } };
    const where = {
      OR: audienceOr,
      ...typeExclusion,
      ...(filter === 'unread' ? { readAt: null } : {}),
    };
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({
        where: { OR: audienceOr, ...typeExclusion, readAt: null },
      }),
    ]);
    return {
      success: true,
      data: items.map((n) => ({
        id: n.id,
        type: n.type,
        severity: n.severity,
        title: n.title,
        body: n.body,
        link: n.link,
        data: n.data,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: { unreadCount },
    };
  }

  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new BadRequestException('Notification not found');
    if (n.userId && n.userId !== req.user.id) {
      throw new BadRequestException('Not your notification');
    }
    if (
      !n.userId &&
      n.role &&
      !audienceRolesFor(req.user.role).includes(n.role)
    ) {
      throw new BadRequestException('Not in your audience');
    }
    if (!n.readAt) {
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      });
    }
    return { success: true };
  }

  @Patch('mark-all-read')
  async markAllRead(@Req() req: Request & { user: RequestUser }) {
    const audienceRoles = audienceRolesFor(req.user.role);
    const result = await this.prisma.notification.updateMany({
      where: {
        OR: [
          { userId: req.user.id },
          { userId: null, role: { in: audienceRoles } },
        ],
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { success: true, data: { count: result.count } };
  }

  /** Server-Sent Events stream — yeni bildirim geldiğinde anında push. */
  @Get('stream')
  stream(
    @Req() req: Request & { user: RequestUser },
    @Res() res: Response,
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('hello', { userId: req.user.id, ts: Date.now() });

    const audienceRoles = audienceRolesFor(req.user.role);
    const sub: Subscription = this.notifications.getStream().subscribe({
      next: (payload) => {
        const inAudience =
          (payload.audience.userId && payload.audience.userId === req.user.id) ||
          (!payload.audience.userId &&
            !!payload.audience.role &&
            audienceRoles.includes(payload.audience.role));
        if (inAudience) send('notification', payload);
      },
    });

    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(ping);
      sub.unsubscribe();
      res.end();
    });
  }

  @Get('vapid-public-key')
  getVapidKey() {
    const key = this.notifications.getVapidPublicKey();
    return { success: true, data: { key } };
  }

  @Post('push/subscribe')
  async subscribePush(
    @Body() dto: SubscribePushDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId: req.user.id,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent ?? null,
      },
      update: {
        userId: req.user.id,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent ?? null,
        lastUsed: new Date(),
      },
    });
    return { success: true };
  }

  @Delete('push/subscribe')
  async unsubscribePush(
    @Body() body: { endpoint: string },
    @Req() req: Request & { user: RequestUser },
  ) {
    if (!body.endpoint) {
      throw new BadRequestException('endpoint required');
    }
    await this.prisma.pushSubscription
      .deleteMany({
        where: { endpoint: body.endpoint, userId: req.user.id },
      })
      .catch(() => undefined);
    return { success: true };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { buildRequestMeta } from '../common/utils/request-meta';

/**
 * Loglar sayfası üç sekmeye ayrılır. Kovayı çağıran açıkça verebilir; vermezse
 * `deriveLogCategory()` actorType + action prefix'inden türetir.
 */
export type AuditLogCategory = 'ADMIN' | 'BIRFATURA' | 'CUSTOMER';

export interface AuditLogInput {
  actorId?: string | null;
  actorType: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  tenantId?: string | null;
  /**
   * Log kovası. Verilmezse actorType + action'dan otomatik türetilir
   * (bkz. deriveLogCategory). Tedarikçi bakiye değişikliği gibi özel
   * call-site'lar ADMIN olarak doğru kovaya düşsün diye açıkça verebilir.
   */
  logCategory?: AuditLogCategory;
}

/**
 * Log kovasını türet:
 * - action 'birfatura' veya 'invoice' içeriyorsa (büyük/küçük harf fark etmez)
 *   → BIRFATURA. BirFatura olayları artık 'admin log'a karışmaz.
 * - actorType 'customer' veya 'public' → CUSTOMER.
 * - aksi (admin/system) → ADMIN.
 */
export function deriveLogCategory(
  actorType: string,
  action: string,
): AuditLogCategory {
  const a = (action ?? '').toLowerCase();
  if (a.includes('birfatura') || a.includes('invoice')) return 'BIRFATURA';
  const t = (actorType ?? '').toLowerCase();
  if (t === 'customer' || t === 'public') return 'CUSTOMER';
  return 'ADMIN';
}

/**
 * Standart semantic log payload — UI tarafında "Loglar" sayfasında insan
 * okuyabilen bir özet göstermek için kullanılır. `summary` Türkçe tam cümle
 * olmalı (örn. "Ahmet Yıldız tedarikçi 'Karaca' bilgilerini güncelledi").
 *
 * `before` / `after` mevcut alanların eski/yeni değerlerini içerebilir; detay
 * paneli bunları diff olarak gösterir. `extra` herhangi bir ek bilgiyi
 * taşıyabilir (örn. tutar, miktar, hedef adı).
 */
export interface SemanticLogInput {
  action: string;
  summary: string;
  actor: {
    type: 'admin' | 'customer' | 'system' | 'public';
    id?: string | null;
    name?: string | null;
    email?: string | null;
    tenantId?: string | null;
  };
  target?: {
    id?: string | null;
    type?: string | null;
    label?: string | null;
  } | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  extra?: Record<string, unknown> | null;
  req?: Request | null;
  /**
   * Açıkça kova belirtmek için. Verilmezse actor.type + action'dan türetilir.
   */
  logCategory?: AuditLogCategory;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'currentPassword',
  'newPassword',
  'apiKey',
  'authToken',
  'refreshToken',
]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      const logCategory =
        input.logCategory ??
        deriveLogCategory(input.actorType, input.action);
      await this.prisma.auditLog.create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          target: input.target ?? null,
          metadata: (input.metadata ?? null) as never,
          tenantId: input.tenantId ?? null,
          logCategory,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Yüksek seviyeli, standartlaştırılmış audit kaydı. Loglar sayfası bunların
   * `summary`'sini birinci sınıf insan-okur sütun olarak gösterir. Eski generic
   * `${method} ${path}` aksiyon biçiminin yerini alır.
   */
  async record(input: SemanticLogInput): Promise<void> {
    const meta = input.req ? buildRequestMeta(input.req) : null;
    const metadata: Record<string, unknown> = {
      summary: input.summary,
      actorName: input.actor.name ?? null,
      email: input.actor.email ?? null,
    };
    if (input.target?.label) metadata.targetLabel = input.target.label;
    if (input.target?.type) metadata.targetType = input.target.type;
    if (input.before !== undefined && input.before !== null) {
      metadata.before = redact(input.before);
    }
    if (input.after !== undefined && input.after !== null) {
      metadata.after = redact(input.after);
    }
    if (input.extra !== undefined && input.extra !== null) {
      metadata.extra = redact(input.extra);
    }
    if (meta) {
      metadata.ip = meta.ip;
      metadata.userAgent = meta.userAgent;
      metadata.deviceType = meta.deviceType;
    }

    await this.log({
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: input.action,
      target: input.target?.id ?? null,
      metadata,
      tenantId: input.actor.tenantId ?? null,
      // Açık kova verilmezse log() actorType + action'dan türetir.
      logCategory: input.logCategory,
    });
  }
}

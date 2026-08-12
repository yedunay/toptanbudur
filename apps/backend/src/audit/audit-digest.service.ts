import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDayIstanbul } from '../birfatura/consolidation/trt-date';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Verilen anın Europe/Istanbul takvim gününü `YYYY-MM-DD` olarak döner. */
function istanbulDateStr(d: Date): string {
  // en-CA → "YYYY-MM-DD" formatı; tek call ile TR civil tarihi verir.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

interface DigestRow {
  action: string;
  target: string | null;
  createdAt: Date;
  metadata: unknown;
}

export interface DigestResult {
  date: string;
  actorCount: number;
  totalEvents: number;
  recipients: string[];
  delivered: 'smtp' | 'file' | 'noop';
  filePath?: string;
}

@Injectable()
export class AuditDigestService {
  private readonly logger = new Logger(AuditDigestService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 23:00 Europe/Istanbul daily
  @Cron('0 23 * * *', { timeZone: 'Europe/Istanbul' })
  async dailyDigest(): Promise<void> {
    try {
      const result = await this.runDigest();
      this.logger.log(
        `Daily digest: ${result.totalEvents} events / ${result.actorCount} actors -> ${result.delivered}`,
      );
    } catch (err) {
      this.logger.error(
        `Daily digest failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * #41: Digest'in tenant kapsamı — AdminNotifierService.resolveDefaultTenantId
   * ile aynı kural (DEFAULT_TENANT_SLUG, yoksa ilk tenant). Bağımlılık eklemeden
   * (audit.module MailModule import etmiyor) burada birebir tekrarlanır.
   */
  private async resolveDefaultTenantId(): Promise<string | null> {
    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'acme';
    const bySlug = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (bySlug) return bySlug.id;
    const first = await this.prisma.tenant.findFirst({ select: { id: true } });
    return first?.id ?? null;
  }

  async runDigest(): Promise<DigestResult> {
    // #41: Gün sınırını sunucu yerel saati (UTC) yerine Europe/Istanbul gün
    // başlangıcına göre hesapla — "bugün" TR takvimine göre 00:00–24:00 olmalı.
    const now = new Date();
    const start = startOfDayIstanbul(now);
    const end = new Date(start.getTime() + DAY_MS);

    // #41: Multi-tenant sızıntıyı önle — digest yalnız varsayılan tenant'ın
    // (DEFAULT_TENANT_SLUG, yoksa ilk tenant) loglarını kapsasın. tenantId
    // çözülemezse filtre uygulanmaz (eski davranış: tüm loglar).
    const tenantId = await this.resolveDefaultTenantId();

    const logs = await this.prisma.auditLog.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        ...(tenantId ? { tenantId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const actorIds = Array.from(
      new Set(logs.map((l) => l.actorId).filter((v): v is string => !!v)),
    );
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const grouped = new Map<string, DigestRow[]>();
    for (const l of logs) {
      const key = l.actorId
        ? userMap.get(l.actorId)?.email ?? `actor:${l.actorId}`
        : `unknown:${l.actorType}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({
        action: l.action,
        target: l.target,
        createdAt: l.createdAt,
        metadata: l.metadata,
      });
    }

    // dateStr — TR takvim günü (start zaten Istanbul 00:00'ın UTC karşılığı).
    const dateStr = istanbulDateStr(now);
    const html = this.buildHtml(dateStr, grouped);

    const setting = await this.prisma.auditLogSetting.findUnique({
      where: { id: 'default' },
    });
    const recipients = setting?.emails ?? [];

    const result: DigestResult = {
      date: dateStr,
      actorCount: grouped.size,
      totalEvents: logs.length,
      recipients,
      delivered: 'noop',
    };

    if (recipients.length === 0) {
      this.logger.warn('No digest recipients configured; skipping send.');
      const filePath = `/tmp/digest-${dateStr}.html`;
      fs.writeFileSync(filePath, html, 'utf8');
      result.delivered = 'file';
      result.filePath = filePath;
      return result;
    }

    // #42: Eski kod SMTP_USER/SMTP_PASS/SMTP_FROM env'lerini okuyordu; bu
    // adlar projede TANIMLI DEĞİL (MailService 'info' hesabı için
    // SMTP_HOST/SMTP_PORT/SMTP_INFO_USER/SMTP_INFO_PASS/SMTP_INFO_FROM_NAME
    // kullanıyor). Yanlış env adları yüzünden mail HİÇ gönderilmiyor, hep
    // /tmp'ye düşüyordu. Doğru env adlarına ('info' hesabı kredensiyalleri)
    // hizalandı; from = "<isim>" <kullanıcı> formatı (MailService ile aynı).
    //
    // NOT: İdeali AuditDigestService'in MailService.sendHtml({account:'info'})
    // ucuna delege etmesidir; bu, audit.module.ts'e MailModule import'u
    // gerektirir (bu oturumun sahip olduğu dosyalar dışında). Modül değişikliği
    // yapılmadan, env adı uyumsuzluğu yerinde düzeltilerek aynı sonuç (info
    // hesabından gönderim) sağlandı.
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ?? '465';
    const user = process.env.SMTP_INFO_USER;
    const pass = process.env.SMTP_INFO_PASS;
    const fromName = process.env.SMTP_INFO_FROM_NAME ?? 'Toptan Budur';

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP info-account env vars missing; writing digest to /tmp instead of sending email.',
      );
      const filePath = `/tmp/digest-${dateStr}.html`;
      fs.writeFileSync(filePath, html, 'utf8');
      result.delivered = 'file';
      result.filePath = filePath;
      return result;
    }

    const from = `"${fromName}" <${user}>`;

    try {
      const transport = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
      });
      await transport.sendMail({
        from,
        to: recipients.join(', '),
        subject: `[Toptan Budur] Admin Audit Digest – ${dateStr}`,
        html,
      });
      result.delivered = 'smtp';
      return result;
    } catch (err) {
      this.logger.error(
        `SMTP send failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      const filePath = `/tmp/digest-${dateStr}.html`;
      fs.writeFileSync(filePath, html, 'utf8');
      result.delivered = 'file';
      result.filePath = filePath;
      return result;
    }
  }

  /**
   * Bugünkü aktiviteyi pano için özetler — Faz 6 "Bugün ne oldu?" görseli.
   * Aktör başına grup, action histogramı, son 10 olay ve şüpheli pattern
   * tespiti (kısa aralıkta tekrarlayan DELETE / yetkisiz erişim denemesi).
   */
  async todaySummary(): Promise<{
    date: string;
    totalEvents: number;
    actorCount: number;
    byAction: Array<{ action: string; count: number }>;
    byActor: Array<{
      actorId: string | null;
      actorType: string | null;
      email: string | null;
      name: string | null;
      count: number;
    }>;
    recent: Array<{
      id: string;
      action: string;
      target: string | null;
      actorEmail: string | null;
      actorName: string | null;
      actorType: string | null;
      createdAt: string;
      summary: string | null;
    }>;
    suspicious: Array<{
      kind: 'rapid_delete' | 'auth_failures' | 'permission_denied';
      actorId: string | null;
      email: string | null;
      count: number;
      windowMinutes: number;
      sample: string[];
    }>;
  }> {
    // Gün sınırı sunucu yerel saatine değil İstanbul gününe göre hesaplanır
    // (Türkiye sabit UTC+3, 2016'dan beri DST yok — kod tabanının geri kalanıyla
    // tutarlı). Yarı-açık aralık [start, end): ertesi gün 00:00 İstanbul.
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const start = new Date(`${dateStr}T00:00:00.000+03:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const logs = await this.prisma.auditLog.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
    });

    const actorIds = Array.from(
      new Set(logs.map((l) => l.actorId).filter((v): v is string => !!v)),
    );
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const actionCounts = new Map<string, number>();
    const actorCounts = new Map<
      string,
      { actorId: string | null; actorType: string | null; count: number }
    >();
    for (const l of logs) {
      actionCounts.set(l.action, (actionCounts.get(l.action) ?? 0) + 1);
      const key = l.actorId ?? `anon:${l.actorType ?? 'unknown'}`;
      const prev = actorCounts.get(key);
      if (prev) prev.count += 1;
      else
        actorCounts.set(key, {
          actorId: l.actorId,
          actorType: l.actorType,
          count: 1,
        });
    }

    const byAction = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const byActor = Array.from(actorCounts.values())
      .map((a) => {
        const u = a.actorId ? userMap.get(a.actorId) : null;
        return {
          actorId: a.actorId,
          actorType: a.actorType,
          email: u?.email ?? null,
          name: u?.name ?? null,
          count: a.count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const recent = logs.slice(0, 10).map((l) => {
      const meta =
        l.metadata && typeof l.metadata === 'object'
          ? (l.metadata as Record<string, unknown>)
          : {};
      const u = l.actorId ? userMap.get(l.actorId) : null;
      return {
        id: l.id,
        action: l.action,
        target: l.target,
        actorEmail: u?.email ?? (meta.email as string | undefined) ?? null,
        actorName: u?.name ?? (meta.actorName as string | undefined) ?? null,
        actorType: l.actorType,
        createdAt: l.createdAt.toISOString(),
        summary: (meta.summary as string | undefined) ?? null,
      };
    });

    const suspicious = this.detectSuspicious(logs, userMap);

    return {
      date: dateStr,
      totalEvents: logs.length,
      actorCount: actorCounts.size,
      byAction,
      byActor,
      recent,
      suspicious,
    };
  }

  private detectSuspicious(
    logs: Array<{
      id: string;
      action: string;
      actorId: string | null;
      actorType: string | null;
      target: string | null;
      createdAt: Date;
      metadata: unknown;
    }>,
    userMap: Map<string, { id: string; email: string; name: string | null }>,
  ): Array<{
    kind: 'rapid_delete' | 'auth_failures' | 'permission_denied';
    actorId: string | null;
    email: string | null;
    count: number;
    windowMinutes: number;
    sample: string[];
  }> {
    const out: ReturnType<typeof this.detectSuspicious> = [];
    const RAPID_DELETE_THRESHOLD = 5;
    const RAPID_WINDOW_MIN = 10;

    const deleteByActor = new Map<
      string,
      Array<{ id: string; createdAt: Date; action: string }>
    >();
    for (const l of logs) {
      if (!/DELETE|delete|remove|REMOVE/.test(l.action) || !l.actorId) continue;
      if (!deleteByActor.has(l.actorId)) deleteByActor.set(l.actorId, []);
      deleteByActor.get(l.actorId)!.push({
        id: l.id,
        createdAt: l.createdAt,
        action: l.action,
      });
    }
    for (const [actorId, rows] of deleteByActor.entries()) {
      if (rows.length < RAPID_DELETE_THRESHOLD) continue;
      const sorted = rows.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (let i = 0; i + RAPID_DELETE_THRESHOLD - 1 < sorted.length; i++) {
        const window =
          sorted[i + RAPID_DELETE_THRESHOLD - 1].createdAt.getTime() -
          sorted[i].createdAt.getTime();
        if (window <= RAPID_WINDOW_MIN * 60_000) {
          const u = userMap.get(actorId);
          out.push({
            kind: 'rapid_delete',
            actorId,
            email: u?.email ?? null,
            count: sorted.length,
            windowMinutes: RAPID_WINDOW_MIN,
            sample: sorted.slice(0, 5).map((r) => `${r.action}@${r.id}`),
          });
          break;
        }
      }
    }

    const authFails = logs.filter((l) =>
      /AUTH_FAIL|LOGIN_FAIL|UNAUTHORIZED|401/.test(l.action),
    );
    if (authFails.length >= 3) {
      out.push({
        kind: 'auth_failures',
        actorId: null,
        email: null,
        count: authFails.length,
        windowMinutes: 24 * 60,
        sample: authFails
          .slice(0, 5)
          .map((l) => l.action + (l.target ? `@${l.target}` : '')),
      });
    }

    const permDenied = logs.filter((l) => /403|FORBIDDEN|DENIED/.test(l.action));
    if (permDenied.length >= 3) {
      out.push({
        kind: 'permission_denied',
        actorId: null,
        email: null,
        count: permDenied.length,
        windowMinutes: 24 * 60,
        sample: permDenied
          .slice(0, 5)
          .map((l) => l.action + (l.target ? `@${l.target}` : '')),
      });
    }

    return out;
  }

  private buildHtml(date: string, grouped: Map<string, DigestRow[]>): string {
    const escape = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const sections: string[] = [];
    for (const [actor, rows] of grouped.entries()) {
      const tableRows = rows
        .map((r) => {
          const meta =
            r.metadata && typeof r.metadata === 'object'
              ? (r.metadata as Record<string, unknown>)
              : {};
          const status = meta.statusCode ?? '';
          return `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escape(r.createdAt.toISOString())}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${escape(r.action)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escape(r.target ?? '—')}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${escape(String(status))}</td>
          </tr>`;
        })
        .join('');
      sections.push(`<section style="margin:24px 0;">
        <h2 style="margin:0 0 8px 0;font-size:16px;color:#111;">${escape(actor)} <span style="color:#888;font-weight:400;">(${rows.length})</span></h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;">
          <thead><tr style="background:#f5f5f7;">
            <th align="left" style="padding:6px 10px;">Zaman (UTC)</th>
            <th align="left" style="padding:6px 10px;">Action</th>
            <th align="left" style="padding:6px 10px;">Target</th>
            <th align="right" style="padding:6px 10px;">HTTP</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>`);
    }

    const total = Array.from(grouped.values()).reduce((n, rs) => n + rs.length, 0);

    return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;background:#fafafa;padding:24px;">
      <div style="max-width:880px;margin:0 auto;">
        <h1 style="font-size:20px;margin:0 0 4px 0;">Toptan Budur Admin Audit Digest</h1>
        <p style="margin:0;color:#666;">${escape(date)} · ${grouped.size} aktör · ${total} olay</p>
        ${sections.length === 0 ? '<p style="margin-top:24px;color:#666;">Bugün yönetici işlemi kaydedilmedi.</p>' : sections.join('')}
      </div>
    </body></html>`;
  }
}

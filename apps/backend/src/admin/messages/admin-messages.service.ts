import { Injectable } from '@nestjs/common';
import { Prisma, FormType, FormStatus, SupportMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListMessagesDto,
  MessageSource,
} from './dto/list-messages.dto';
import { trDateRange } from '../../common/utils/tr-time';

export interface UnifiedMessage {
  id: string;
  source: MessageSource;
  type: string | null;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  notes: string | null;
  createdAt: Date;
}

@Injectable()
export class AdminMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMessagesDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
    const dateRange = trDateRange(query.dateFrom, query.dateTo);

    // Source filtresi -> hangi tabloları sorgulamak gerekiyor.
    const includeForm =
      !query.source || query.source !== 'SUPPORT';
    const includeSupport =
      !query.source || query.source === 'SUPPORT';

    // Form tablosundan source eşlemesi:
    let formTypeFilter: FormType | undefined;
    if (query.source === 'FORM_CONTACT') formTypeFilter = 'CONTACT';
    else if (query.source === 'FORM_APPLICATION') formTypeFilter = 'APPLICATION';
    else if (query.source === 'FORM_CALLBACK') formTypeFilter = 'CALLBACK';
    else if (query.source === 'FORM_INTEGRATION') formTypeFilter = 'INTEGRATION';

    const formWhere: Prisma.FormWhereInput = {};
    if (formTypeFilter) formWhere.type = formTypeFilter;
    if (query.status) {
      // Form.status enum: NEW | HANDLED | ARCHIVED — geçersiz değer girerse
      // Prisma hata fırlatır; bunun yerine yalnızca eşleşeni uygula.
      const allowed: FormStatus[] = ['NEW', 'HANDLED', 'ARCHIVED'];
      if (allowed.includes(query.status as FormStatus)) {
        formWhere.status = query.status as FormStatus;
      }
    }
    if (dateRange) formWhere.createdAt = dateRange;

    const supportWhere: Prisma.SupportMessageWhereInput = {};
    if (query.status) {
      const allowed: SupportMessageStatus[] = ['NEW', 'READ', 'REPLIED', 'ARCHIVED'];
      if (allowed.includes(query.status as SupportMessageStatus)) {
        supportWhere.status = query.status as SupportMessageStatus;
      }
    }
    if (dateRange) supportWhere.createdAt = dateRange;

    const oversize = page * pageSize + pageSize;
    const forms = includeForm
      ? await this.prisma.form.findMany({
          where: formWhere,
          orderBy: { createdAt: 'desc' },
          take: oversize,
        })
      : [];
    const supportMessages = includeSupport
      ? await this.prisma.supportMessage.findMany({
          where: supportWhere,
          orderBy: { createdAt: 'desc' },
          take: oversize,
        })
      : [];

    const merged: UnifiedMessage[] = [];
    for (const f of forms) {
      const source: MessageSource =
        f.type === 'CONTACT'
          ? 'FORM_CONTACT'
          : f.type === 'APPLICATION'
            ? 'FORM_APPLICATION'
            : f.type === 'INTEGRATION'
              ? 'FORM_INTEGRATION'
              : 'FORM_CALLBACK';
      merged.push({
        id: f.id,
        source,
        type: f.type,
        name: f.name,
        email: f.email,
        phone: f.phone,
        subject: f.subject,
        message: f.message,
        status: f.status,
        notes: f.notes,
        createdAt: f.createdAt,
      });
    }
    for (const s of supportMessages) {
      merged.push({
        id: s.id,
        source: 'SUPPORT',
        type: null,
        name: s.name,
        email: s.email,
        phone: null,
        subject: s.subject,
        message: s.body,
        status: s.status,
        notes: s.adminNote,
        createdAt: s.createdAt,
      });
    }

    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const data = merged.slice(start, start + pageSize);

    return {
      success: true,
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        // total burada o sayfanın çekilebilen üst sınırı kadardır; tam global
        // sayım için ileride tek bir SQL UNION ile zenginleştirilebilir.
        approximate: true,
      },
    };
  }
}

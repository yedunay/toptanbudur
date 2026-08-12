import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLeadDto } from './dto/create-lead.dto';
import { normalizeTrPhone } from '../common/utils/phone';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateLeadDto,
    ip: string | undefined,
    req?: Request | null,
  ) {
    const telefon = normalizeTrPhone(dto.telefon) ?? dto.telefon;

    const lead = await this.prisma.lead.create({
      data: {
        ad: dto.ad,
        telefon,
        eposta: dto.eposta,
        mesaj: dto.mesaj,
        ip: ip ?? null,
      },
      select: { id: true },
    });

    void (async () => {
      try {
        const emailPart = dto.eposta ? ` (${dto.eposta})` : '';
        await this.audit.record({
          action: 'LEAD_CREATE',
          summary: `${dto.ad}${emailPart} geri arama talebi gönderdi`,
          actor: {
            type: 'public',
            name: dto.ad,
            email: dto.eposta ?? null,
          },
          target: { id: lead.id, type: 'lead', label: dto.ad },
          extra: {
            telefon,
            mesaj: dto.mesaj ?? null,
            ip: ip ?? null,
          },
          req: req ?? null,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to record LEAD_CREATE audit: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
    })();

    return { success: true, data: { id: lead.id } };
  }
}

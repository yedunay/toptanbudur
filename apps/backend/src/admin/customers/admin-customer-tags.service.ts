import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTO_TAGS } from './admin-customers.service';

/**
 * Müşteri (bayi) MANUEL etiketleri — YALNIZ ADMIN. CRUD; tenant-scope'lu.
 * Otomatik (sistem) etiketleri buradan yönetilmez — onlar `admin-customers`
 * içinde veriden hesaplanır. list() UI'ın filtre menüsü için oto-etiket
 * tanımlarını da döndürür.
 */
@Injectable()
export class AdminCustomerTagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const tags = await this.prisma.customerTag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { customers: true } },
      },
    });
    return {
      success: true,
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        customerCount: t._count.customers,
      })),
      autoTags: Object.values(AUTO_TAGS),
    };
  }

  async create(tenantId: string, dto: { name: string; color: string }) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Etiket adı boş olamaz.');
    try {
      const tag = await this.prisma.customerTag.create({
        data: { tenantId, name, color: dto.color },
        select: { id: true, name: true, color: true },
      });
      return { success: true, tag };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Bu isimde bir etiket zaten var.');
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: { name?: string; color?: string },
  ) {
    await this.requireTag(tenantId, id);
    const data: Prisma.CustomerTagUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Etiket adı boş olamaz.');
      data.name = name;
    }
    if (dto.color !== undefined) data.color = dto.color;
    try {
      const tag = await this.prisma.customerTag.update({
        where: { id },
        data,
        select: { id: true, name: true, color: true },
      });
      return { success: true, tag };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Bu isimde bir etiket zaten var.');
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    await this.requireTag(tenantId, id);
    // m2m join (_CustomerTags) FK ON DELETE CASCADE ile temizlenir.
    await this.prisma.customerTag.delete({ where: { id } });
    return { success: true };
  }

  private async requireTag(tenantId: string, id: string) {
    const tag = await this.prisma.customerTag.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!tag) throw new NotFoundException('Etiket bulunamadı.');
  }
}

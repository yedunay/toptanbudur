import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';

const SLUG_OPTS = { lower: true, strict: true, trim: true } as const;
const PATH_SEP = ' > ';

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  productCount: number;
  children: CategoryNode[];
}

@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Tüm tenant kategorilerini ağaç olarak döner. Manuel ürün ekleme akışındaki
  // dropdown ve Kategoriler yönetim sayfası aynı endpoint'i kullanır.
  async tree(tenantId: string): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        path: true,
        depth: true,
      },
    });
    const counts = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { tenantId, categoryId: { not: null } },
      _count: { _all: true },
    });
    const countMap = new Map<string, number>();
    for (const c of counts) {
      if (c.categoryId) countMap.set(c.categoryId, c._count._all);
    }
    const byId = new Map<string, CategoryNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        name: r.name,
        slug: r.slug,
        path: r.path,
        depth: r.depth,
        productCount: countMap.get(r.id) ?? 0,
        children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id);
      if (!node) continue;
      if (r.parentId && byId.has(r.parentId)) {
        byId.get(r.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateCategoryDto,
  ): Promise<{ id: string; name: string; path: string; depth: number }> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Kategori adı boş olamaz.');
    }

    let parentId: string | null = null;
    let parentPath = '';
    let depth = 0;

    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, tenantId },
        select: { id: true, path: true, depth: true },
      });
      if (!parent) {
        throw new NotFoundException('Üst kategori bulunamadı.');
      }
      parentId = parent.id;
      parentPath = parent.path;
      depth = parent.depth + 1;
    }

    const path = parentPath ? `${parentPath}${PATH_SEP}${name}` : name;

    const dup = await this.prisma.category.findFirst({
      where: { tenantId, path },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('Bu isimde bir kategori zaten mevcut.');
    }

    const baseSlug = slugify(name, SLUG_OPTS) || 'kategori';
    let slug = baseSlug;
    // Slug aynı tenant içinde unique değil ama yine de okunabilir tutmak için
    // çakışma kontrolü yapıyoruz; çakışırsa kısa hex eki ekliyoruz.
    const existingSlug = await this.prisma.category.findFirst({
      where: { tenantId, slug },
      select: { id: true },
    });
    if (existingSlug) {
      slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
    }

    try {
      const created = await this.prisma.category.create({
        data: { tenantId, parentId, name, slug, path, depth },
        select: { id: true, name: true, path: true, depth: true },
      });
      await this.audit.log({
        actorType: 'ADMIN',
        actorId,
        action: 'category.create',
        target: `Category:${created.id}`,
        metadata: { name, path, parentId },
        tenantId,
      });
      return created;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Bu isimde bir kategori zaten mevcut.');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<{ id: string; name: string; path: string; depth: number }> {
    const current = await this.prisma.category.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, path: true, depth: true, parentId: true },
    });
    if (!current) {
      throw new NotFoundException('Kategori bulunamadı.');
    }
    if (dto.name === undefined) {
      return {
        id: current.id,
        name: current.name,
        path: current.path,
        depth: current.depth,
      };
    }
    const newName = dto.name.trim();
    if (!newName) {
      throw new BadRequestException('Kategori adı boş olamaz.');
    }
    if (newName === current.name) {
      return {
        id: current.id,
        name: current.name,
        path: current.path,
        depth: current.depth,
      };
    }

    // Yeni path: parent path + " > " + newName. Alt ağaçtaki tüm path'ler
    // eski prefix ile değişmek zorunda — tek transaction içinde rename.
    const parentPath = current.path.includes(PATH_SEP)
      ? current.path.slice(0, current.path.lastIndexOf(PATH_SEP))
      : '';
    const newPath = parentPath ? `${parentPath}${PATH_SEP}${newName}` : newName;

    if (newPath === current.path) {
      return {
        id: current.id,
        name: current.name,
        path: current.path,
        depth: current.depth,
      };
    }

    const oldPathPrefix = `${current.path}${PATH_SEP}`;
    const newPathPrefix = `${newPath}${PATH_SEP}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const conflict = await tx.category.findFirst({
        where: { tenantId, path: newPath, id: { not: current.id } },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(
          'Bu isimde başka bir kategori zaten mevcut.',
        );
      }
      const descendants = await tx.category.findMany({
        where: { tenantId, path: { startsWith: oldPathPrefix } },
        select: { id: true, path: true },
      });
      const updated = await tx.category.update({
        where: { id: current.id },
        data: { name: newName, path: newPath },
        select: { id: true, name: true, path: true, depth: true },
      });
      for (const d of descendants) {
        const rest = d.path.slice(oldPathPrefix.length);
        await tx.category.update({
          where: { id: d.id },
          data: { path: `${newPathPrefix}${rest}` },
        });
      }
      return updated;
    });

    await this.audit.log({
      actorType: 'ADMIN',
      actorId,
      action: 'category.update',
      target: `Category:${result.id}`,
      metadata: {
        oldName: current.name,
        newName: result.name,
        oldPath: current.path,
        newPath: result.path,
      },
      tenantId,
    });
    return result;
  }

  async remove(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<{ id: string }> {
    const current = await this.prisma.category.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, path: true },
    });
    if (!current) {
      throw new NotFoundException('Kategori bulunamadı.');
    }
    const childCount = await this.prisma.category.count({
      where: { tenantId, parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Alt kategorisi olan bir kategori silinemez. Önce alt kategorileri silin veya taşıyın.',
      );
    }
    // Üründeki categoryId FK `onDelete: SetNull` — ürünler kalır, kategori
    // referansı temizlenir.
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({
      actorType: 'ADMIN',
      actorId,
      action: 'category.delete',
      target: `Category:${id}`,
      metadata: { name: current.name, path: current.path },
      tenantId,
    });
    return { id };
  }
}

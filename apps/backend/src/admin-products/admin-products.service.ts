import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import {
  detectImage,
  type AllowedImageExt,
  type AllowedImageMime,
} from '../common/utils/image-magic-bytes';
import { generateUniqueInternalCode } from '../common/utils/internal-code';
import { generatePublicBarcode } from '../common/utils/public-barcode';
import {
  ensureManualSupplier,
  MANUAL_EXTERNAL_PREFIX,
} from '../common/utils/manual-supplier';
import { computeNameKey } from '../common/utils/name-key';
import { ProductDedupService } from '../product-core/product-dedup.service';
import { snapshotSupplierBeforeProductDelete } from '../profitability/supplier-attribution.util';
import {
  AdminProductListQueryDto,
  BulkDeleteDto,
  BulkUpdateDto,
  CreateManualProductDto,
  UpdateProductDto,
} from './dto';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const SLUG_OPTS = { lower: true, strict: true, trim: true } as const;
const MANUAL_EXTERNAL_SUFFIX_LEN = 8;
const MAX_MANUAL_IMAGES = 10;
const MAX_MANUAL_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ManualProductImageInput {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

@Injectable()
export class AdminProductsService {
  private readonly logger = new Logger(AdminProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly productDedup: ProductDedupService,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: IFileStorage,
  ) {}

  async list(tenantId: string, query: AdminProductListQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    const where: Prisma.ProductWhereInput = { tenantId };

    if (query.q) {
      // Tek arama kutusu: ad, marka, SKU (externalCode), barkod ve public barkod
      // — admin tarafında "61xxx", "TBDR...", numerik SKU ya da kısmi ürün adı
      // hepsi aynı q parametresine yazılır. Case-insensitive contains.
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { brand: { contains: query.q, mode: 'insensitive' } },
        { externalCode: { contains: query.q, mode: 'insensitive' } },
        { barcode: { contains: query.q, mode: 'insensitive' } },
        { publicBarcode: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    if (query.brand) {
      where.brand = { equals: query.brand, mode: 'insensitive' };
    }

    // Tedarikçi filtresi — UI tablosunda "Tedarikçi" dropdown'ı bu key ile
    // çağırır. Boş string gelirse filtre uygulanmaz.
    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }

    if (query.inStock) {
      where.stock = { gt: 0 };
    }

    if (query.categorySlug) {
      const cat = await this.prisma.category.findFirst({
        where: { tenantId, slug: query.categorySlug },
        select: { id: true, path: true },
      });
      if (!cat) {
        return {
          data: [],
          meta: { total: 0, page, pageSize, totalPages: 0 },
        };
      }
      const descendants = await this.prisma.category.findMany({
        where: {
          tenantId,
          OR: [{ id: cat.id }, { path: { startsWith: `${cat.path} > ` } }],
        },
        select: { id: true },
      });
      where.categoryId = { in: descendants.map((d) => d.id) };
    }

    const productSelect = {
      id: true,
      slug: true,
      externalCode: true,
      internalCode: true,
      name: true,
      brand: true,
      model: true,
      barcode: true,
      publicBarcode: true,
      costPrice: true,
      price: true,
      currency: true,
      stock: true,
      // Override durumu: manual* set ise UI "feed kilidi açık" gösterir;
      // feed* ham feed değeri (kilidi açınca geri dönecek değer).
      manualPrice: true,
      manualStock: true,
      feedPrice: true,
      feedStock: true,
      active: true,
      updatedAt: true,
      supplier: { select: { id: true, name: true } },
      category: { select: { name: true, slug: true, path: true } },
      images: {
        orderBy: { position: 'asc' as const },
        take: 1,
        select: { url: true },
      },
    };

    // Out-of-stock products always last regardless of filter.
    const inStockWhere: Prisma.ProductWhereInput = {
      ...where,
      stock: query.inStock ? (where.stock as Prisma.IntFilter) : { gt: 0 },
    };
    const outOfStockWhere: Prisma.ProductWhereInput = { ...where, stock: 0 };

    const [inCount, outCount] = await Promise.all([
      this.prisma.product.count({ where: inStockWhere }),
      query.inStock
        ? Promise.resolve(0)
        : this.prisma.product.count({ where: outOfStockWhere }),
    ]);
    const total = inCount + outCount;

    const offset = (page - 1) * pageSize;
    const inSliceStart = Math.min(offset, inCount);
    const inSliceTake = Math.max(0, Math.min(pageSize, inCount - offset));
    const outSliceStart = Math.max(0, offset - inCount);
    const outSliceTake = pageSize - inSliceTake;

    const [inRows, outRows] = await Promise.all([
      inSliceTake > 0
        ? this.prisma.product.findMany({
            where: inStockWhere,
            orderBy: { updatedAt: 'desc' },
            skip: inSliceStart,
            take: inSliceTake,
            select: productSelect,
          })
        : Promise.resolve([]),
      outSliceTake > 0
        ? this.prisma.product.findMany({
            where: outOfStockWhere,
            orderBy: { updatedAt: 'desc' },
            skip: outSliceStart,
            take: outSliceTake,
            select: productSelect,
          })
        : Promise.resolve([]),
    ]);
    const rows = [...inRows, ...outRows];

    const data = rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      sku: p.internalCode ?? p.externalCode,
      externalCode: p.externalCode,
      internalCode: p.internalCode,
      name: p.name,
      brand: p.brand,
      model: p.model,
      // Admin orijinal barcode + publicBarcode'u her ikisini de görür.
      barcode: p.barcode,
      publicBarcode: p.publicBarcode,
      costPrice: Number(p.costPrice),
      price: Number(p.price),
      currency: p.currency,
      stock: p.stock,
      // Override alanları: null = feed yönetiyor; sayı = manuel override.
      manualPrice: p.manualPrice != null ? Number(p.manualPrice) : null,
      manualStock: p.manualStock,
      feedPrice: p.feedPrice != null ? Number(p.feedPrice) : null,
      feedStock: p.feedStock,
      isActive: p.active,
      updatedAt: p.updatedAt,
      supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
      supplierId: p.supplier?.id ?? null,
      supplierName: p.supplier?.name ?? null,
      categoryName: p.category?.name ?? null,
      categorySlug: p.category?.slug ?? null,
      categoryPath: p.category?.path ?? null,
      imageUrl: p.images[0]?.url ?? null,
    }));

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(tenantId: string, productId: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      // feedPrice/feedStock: override temizlenince geri yazılacak efektif değer.
      // price/stock: feed* henüz NULL (backfill öncesi) ise fallback.
      select: {
        id: true,
        name: true,
        feedPrice: true,
        feedStock: true,
        price: true,
        stock: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('product not found');
    }

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      // nameKey, name ile senkron — auto-route eşleştirme anahtarı.
      data.nameKey = computeNameKey(dto.name);
    }
    // price/stock: null = feed moduna dön (manuel override'ı temizle, efektif
    // değeri feed değerine sıfırla); sayı = manuel override (efektif = manuel).
    // manual* admin'in pinlediği değer; price/stock daima efektif değer kalır.
    if (dto.price !== undefined) {
      data.manualPrice = dto.price === null ? null : new Prisma.Decimal(dto.price);
      data.price =
        dto.price === null
          ? (existing.feedPrice ?? existing.price)
          : new Prisma.Decimal(dto.price);
    }
    if (dto.stock !== undefined) {
      data.manualStock = dto.stock;
      const eff = dto.stock === null ? (existing.feedStock ?? existing.stock) : dto.stock;
      data.stock = eff;
      data.marketplaceListed = eff > 0;
    }
    if (dto.isActive !== undefined) data.active = dto.isActive;

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data,
      select: {
        id: true,
        slug: true,
        name: true,
        price: true,
        currency: true,
        stock: true,
        manualPrice: true,
        manualStock: true,
        feedPrice: true,
        feedStock: true,
        active: true,
        updatedAt: true,
      },
    });

    // Stok/fiyat/isim/aktiflik değişimi aynı isimdeki ürünlerin kazananını
    // (isCanonical) değiştirebilir → hedefli recompute. Ör. stoğu 0'a çekilen
    // canonical, stoklu kardeşine devreder; tekrar stok girince geri alınır.
    // İsim değiştiyse hem eski hem yeni nameKey grubu etkilenir. Hata yutulur
    // (kayıt zaten işlendi; sonraki tam recompute düzeltir).
    try {
      await this.productDedup.recomputeCanonicalForKeys(tenantId, [
        computeNameKey(updated.name),
        computeNameKey(existing.name),
      ]);
    } catch (e) {
      this.logger.warn(
        `canonical recompute after product update failed (id=${productId}): ${(e as Error).message}`,
      );
    }

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      price: Number(updated.price),
      currency: updated.currency,
      stock: updated.stock,
      manualPrice: updated.manualPrice != null ? Number(updated.manualPrice) : null,
      manualStock: updated.manualStock,
      feedPrice: updated.feedPrice != null ? Number(updated.feedPrice) : null,
      feedStock: updated.feedStock,
      isActive: updated.active,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Admin panelden elle ürün ekler. XML feed bağlı değildir (feedId=null);
   * supplier "Manuel Ürünler" tenant başına bir kez oluşturulur. Stok kodu
   * (internalCode), public barkod ve externalCode burada üretilir; sync
   * süreci feedId filtresi nedeniyle bu kayıtlara hiçbir zaman dokunmaz.
   *
   * Görseller önce magic-byte ile doğrulanır, sonra storage'a yazılır;
   * yalnız başarılı yüklenenler ProductImage olarak kaydedilir. DB write
   * tek transaction içindedir, görsel yüklemeleri ürün yaratıldıktan
   * sonra yapılır (storage upload transaction içinde tutulmamalı).
   */
  async createManual(
    tenantId: string,
    actorId: string,
    dto: CreateManualProductDto,
    images: ManualProductImageInput[],
  ) {
    if (!this.storage) {
      throw new BadRequestException(
        'Dosya depolama servisi yapılandırılmamış.',
      );
    }
    if (images.length === 0) {
      throw new BadRequestException('En az 1 ürün görseli zorunludur.');
    }
    if (images.length > MAX_MANUAL_IMAGES) {
      throw new BadRequestException(
        `En fazla ${MAX_MANUAL_IMAGES} görsel yükleyebilirsiniz.`,
      );
    }

    type ValidatedImage = {
      input: ManualProductImageInput;
      mimetype: AllowedImageMime;
      extension: AllowedImageExt;
    };
    const validated: ValidatedImage[] = images.map((img) => {
      if (img.size > MAX_MANUAL_IMAGE_BYTES) {
        throw new BadRequestException(
          `Görsel boyutu 5 MB sınırını aşıyor: ${img.originalname}`,
        );
      }
      const detected = detectImage(img.buffer);
      if (!detected) {
        throw new BadRequestException(
          `Geçersiz görsel türü (yalnız JPEG/PNG/WEBP): ${img.originalname}`,
        );
      }
      return {
        input: img,
        mimetype: detected.mimetype,
        extension: detected.extension,
      };
    });

    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, tenantId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException('Geçersiz kategori.');
      }
    }

    const supplier = await ensureManualSupplier(this.prisma, tenantId);

    const internalCode = await generateUniqueInternalCode(this.prisma);
    const publicBarcode = await this.generateUniquePublicBarcode();
    const externalCode = await this.generateUniqueManualExternalCode(
      tenantId,
      supplier.id,
    );
    const slug = await this.ensureUniqueManualSlug(tenantId, dto.name);

    const price = new Prisma.Decimal(dto.price.toFixed(2));
    const costPrice =
      dto.costPrice !== undefined
        ? new Prisma.Decimal(dto.costPrice.toFixed(2))
        : price;
    const taxRate =
      dto.taxRate !== undefined
        ? new Prisma.Decimal(dto.taxRate.toFixed(2))
        : new Prisma.Decimal(10);
    const isActive = dto.isActive ?? true;

    const contentHash = createHash('sha256')
      .update(
        [
          'manual',
          dto.name.trim().toLowerCase(),
          price.toFixed(2),
          internalCode,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 32);

    const created = await this.prisma.product.create({
      data: {
        tenantId,
        supplierId: supplier.id,
        feedId: null,
        categoryId: dto.categoryId ?? null,
        externalCode,
        slug,
        name: dto.name.trim(),
        nameKey: computeNameKey(dto.name.trim()),
        brand: dto.brand?.trim() || null,
        model: dto.model?.trim() || null,
        description: dto.description?.trim() || null,
        barcode: null,
        publicBarcode,
        internalCode,
        costPrice,
        price,
        // Manuel ürünün feed kaynağı yok; feed* alanlarını yaratım değerine
        // eşitle ki invariant (feed* daima feed-yönetimli değeri tutar) tüm
        // ürünlerde uniform olsun ve override temizlenince ?? fallback'e
        // muhtaç kalmadan doğru efektif değere dönülsün.
        feedPrice: price,
        currency: 'TRY',
        taxRate,
        stock: dto.stock,
        feedStock: dto.stock,
        active: isActive,
        marketplaceListed: isActive,
        contentHash,
        // Manuel ürün admin tarafından girildiği için isim/açıklama
        // dondurulmuş kabul edilir — sync hiçbir zaman dokunmasa da
        // bu bayrak ileride normalize edici batch'in dokunmaması için
        // savunma sağlar.
        contentNormalizedAt: new Date(),
        isCanonical: true,
      },
      select: { id: true },
    });

    const persistedImages: Array<{ id: string; url: string }> = [];
    for (let i = 0; i < validated.length; i++) {
      const img = validated[i];
      const fileId = randomUUID();
      const key = `manual-products/${created.id}/${fileId}.${img.extension}`;
      try {
        const result = await this.storage.upload(
          key,
          img.input.buffer,
          img.mimetype,
        );
        // DURABLE url: ProductImage.url is persisted and rendered on the
        // storefront/admin for the product's lifetime. The short-lived
        // upload() url would 403 ~10 min later ("görseller silindi"). Store a
        // long-lived public url instead (re-signed from the stable key).
        const url = await this.storage.getPublicUrl(result.key);
        const row = await this.prisma.productImage.create({
          data: {
            productId: created.id,
            url,
            position: i,
          },
          select: { id: true, url: true },
        });
        persistedImages.push(row);
      } catch (err) {
        this.logger.error(
          `manual product image upload failed product=${created.id} key=${key}`,
          err as Error,
        );
      }
    }

    if (persistedImages.length === 0) {
      // Hiç görsel yüklenemediyse ürün boş kalır; veriyi tutarlı tutmak
      // için ürünü siliyoruz ve kullanıcıya 4xx dönüyoruz.
      await this.prisma.product.delete({ where: { id: created.id } });
      throw new BadRequestException(
        'Görseller yüklenemedi. Lütfen tekrar deneyin.',
      );
    }

    void this.audit.log({
      actorType: 'admin',
      actorId,
      action: 'product.manual.create',
      target: created.id,
      tenantId,
      metadata: {
        internalCode,
        externalCode,
        imageCount: persistedImages.length,
        categoryId: dto.categoryId ?? null,
      },
    });

    return {
      id: created.id,
      slug,
      internalCode,
      publicBarcode,
      externalCode,
      name: dto.name.trim(),
      imageCount: persistedImages.length,
    };
  }

  private async generateUniquePublicBarcode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generatePublicBarcode();
      const exists = await this.prisma.product.findUnique({
        where: { publicBarcode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new Error('publicBarcode generation exceeded retry budget');
  }

  private async generateUniqueManualExternalCode(
    tenantId: string,
    supplierId: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomBytes(MANUAL_EXTERNAL_SUFFIX_LEN)
        .toString('hex')
        .toUpperCase()
        .slice(0, MANUAL_EXTERNAL_SUFFIX_LEN);
      const candidate = `${MANUAL_EXTERNAL_PREFIX}${suffix}`;
      const exists = await this.prisma.product.findFirst({
        where: { tenantId, supplierId, externalCode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new Error('manual externalCode generation exceeded retry budget');
  }

  private async ensureUniqueManualSlug(
    tenantId: string,
    name: string,
  ): Promise<string> {
    const base =
      slugify(name, SLUG_OPTS).slice(0, 180) || `manual-${Date.now()}`;
    const exists = await this.prisma.product.findFirst({
      where: { tenantId, slug: base },
      select: { id: true },
    });
    if (!exists) return base;
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`.slice(0, 200);
  }

  async bulkUpdate(
    tenantId: string,
    dto: BulkUpdateDto,
    actor?: { id: string },
  ) {
    const data: Prisma.ProductUpdateManyMutationInput = {};
    // price/stock: null = feed moduna dön (manuel override temizle); sayı =
    // manuel override. manual* admin'in pinlediği değer; price/stock efektif.
    if (dto.patch.price !== undefined) {
      if (dto.patch.price === null) {
        data.manualPrice = null;
      } else {
        const dec = new Prisma.Decimal(dto.patch.price);
        data.manualPrice = dec;
        data.price = dec;
      }
    }
    if (dto.patch.stock !== undefined) {
      if (dto.patch.stock === null) {
        data.manualStock = null;
      } else {
        data.manualStock = dto.patch.stock;
        data.stock = dto.patch.stock;
        data.marketplaceListed = dto.patch.stock > 0;
      }
    }
    if (dto.patch.isActive !== undefined) data.active = dto.patch.isActive;

    if (Object.keys(data).length === 0) {
      return { updated: 0 };
    }

    try {
      const result = await this.prisma.product.updateMany({
        where: { id: { in: dto.ids }, tenantId },
        data,
      });

      // Feed moduna dönüş: efektif değeri feed değerine (feed* yoksa mevcut
      // price/stock) sıfırla. updateMany kolon-kolon atama yapamaz → raw COALESCE.
      // manualPrice/manualStock yukarıda zaten null'landı; guard yine de güvenli.
      if (dto.patch.price === null) {
        await this.prisma.$executeRaw`
          UPDATE "Product"
          SET "price" = COALESCE("feedPrice", "price")
          WHERE "tenantId" = ${tenantId}
            AND "id" IN (${Prisma.join(dto.ids)})
            AND "manualPrice" IS NULL`;
      }
      if (dto.patch.stock === null) {
        await this.prisma.$executeRaw`
          UPDATE "Product"
          SET "stock" = COALESCE("feedStock", "stock"),
              "marketplaceListed" = (COALESCE("feedStock", "stock") > 0)
          WHERE "tenantId" = ${tenantId}
            AND "id" IN (${Prisma.join(dto.ids)})
            AND "manualStock" IS NULL`;
      }

      // Toplu stok/fiyat/aktiflik değişimi sonrası etkilenen isim gruplarının
      // canonical kazananını yeniden hesapla (hedefli — yalnız bu ürünlerin
      // nameKey'leri). Stok=0'a çekilen canonical, stoklu kardeşine devreder.
      if (result.count > 0) {
        try {
          const affected = await this.prisma.product.findMany({
            where: { id: { in: dto.ids }, tenantId },
            select: { nameKey: true, name: true },
          });
          await this.productDedup.recomputeCanonicalForKeys(
            tenantId,
            affected.map((p) => p.nameKey ?? computeNameKey(p.name)),
          );
        } catch (e) {
          this.logger.warn(
            `canonical recompute after bulk update failed: ${(e as Error).message}`,
          );
        }
      }

      if (actor && result.count > 0) {
        void this.audit.log({
          actorType: 'admin',
          actorId: actor.id,
          tenantId,
          action: 'product.bulk.update',
          target: `${result.count} ürün`,
          metadata: {
            requested: dto.ids.length,
            updated: result.count,
            patch: dto.patch,
          },
        });
      }
      return { updated: result.count };
    } catch (err) {
      this.logger.error('bulk update failed', err as Error);
      throw err;
    }
  }

  async bulkDelete(
    tenantId: string,
    dto: BulkDeleteDto,
    actor: { id: string },
  ) {
    try {
      // SAVUNMA HATTI: silmeden ÖNCE bu ürünlere bağlı kalemlerin tedarikçi
      // snapshot'ını doldur (henüz yoksa) → silindikten sonra karlılık/cari
      // doğru tedarikçiye atfeder.
      await snapshotSupplierBeforeProductDelete(this.prisma, {
        id: { in: dto.ids },
        tenantId,
      });
      const result = await this.prisma.product.deleteMany({
        where: { id: { in: dto.ids }, tenantId },
      });
      if (result.count > 0) {
        void this.audit.log({
          actorType: 'admin',
          actorId: actor.id,
          tenantId,
          action: 'product.bulk.delete',
          target: `${result.count} ürün`,
          metadata: {
            requested: dto.ids.length,
            deleted: result.count,
          },
        });
      }
      return { deleted: result.count };
    } catch (err) {
      this.logger.error('bulk delete failed', err as Error);
      throw err;
    }
  }
}

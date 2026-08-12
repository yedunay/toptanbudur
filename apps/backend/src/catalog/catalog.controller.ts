import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CatalogService } from './catalog.service';
import {
  CatalogCountQueryDto,
  CategoryTreeQueryDto,
  ProductListQueryDto,
  TenantSlugQueryDto,
} from './dto';

// Public katalog GET endpoint'leri throttler'dan muaf — Next.js (storefront +
// landing) bunları SSR'de revalidate=60 ile cache'liyor ve burst pattern
// kategori sidebar / sayım yüklemesi gibi normal davranışlar global limite
// (10 req/sn) takıldığında 429 ve domino etkisiyle nginx 502 üretiyordu.
// DDoS koruması nginx katmanında (limit_req_zone tb_general 30r/s) zaten var.
@SkipThrottle()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /**
   * Opsiyonel cookie-auth: yalnızca `ADMIN_DISCOUNT` müşteri için dedup'suz
   * (tüm aynı-isimli varyant) liste açılır. Bu durumda yanıt müşteriye özel
   * olduğundan `Cache-Control: private, no-store` set edilir — paylaşımlı
   * cache (Caddy/CDN) dedup'suz listeyi başka müşteriye servis etmesin.
   * Cookie yoksa / `STANDARD` ise `false` döner ve public/cache'li davranış
   * aynen korunur (normal müşteri hiç etkilenmez).
   */
  private async resolveVariantVisibility(
    req: Request,
    res: Response,
  ): Promise<boolean> {
    const status = await this.catalog.resolveCustomerStatus(req.headers.cookie);
    const includeAllVariants = status === 'ADMIN_DISCOUNT';
    if (includeAllVariants) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    return includeAllVariants;
  }

  @Get('categories')
  categories(@Query() q: CategoryTreeQueryDto) {
    return this.catalog.getCategoryTree(q);
  }

  /// V3: DOĞRU (canonical/Trendyol) kategori ağacı — storefront gezinmesi için.
  /// getCategoryTree ile aynı DTO; mevcut /categories'e dokunmaz.
  @Get('categories/correct')
  correctCategories(@Query() q: CategoryTreeQueryDto) {
    return this.catalog.getCanonicalCategoryTree(q);
  }

  @Get('products')
  async products(
    @Query() q: ProductListQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const includeAllVariants = await this.resolveVariantVisibility(req, res);
    return this.catalog.listProducts(q, includeAllVariants);
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string, @Query() q: TenantSlugQueryDto) {
    return this.catalog.getProductDetail(slug, q.tenantSlug);
  }

  @Get('brands')
  async brands(
    @Query() q: TenantSlugQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const includeAllVariants = await this.resolveVariantVisibility(req, res);
    return this.catalog.listBrands(q.tenantSlug, includeAllVariants);
  }

  /**
   * Public ürün adedi. Auth yok — yalnızca toplam sayı görünür, içerik değil.
   * `activeOnly` query default `true`; `false` verildiğinde pasifler de dahil.
   * `ADMIN_DISCOUNT` müşteride dedup'suz sayım liste ile tutarlı olur.
   */
  @Get('count')
  async count(
    @Query() q: CatalogCountQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const activeOnly = q.activeOnly !== false;
    const includeAllVariants = await this.resolveVariantVisibility(req, res);
    return this.catalog.getProductCount(q.tenantSlug, activeOnly, includeAllVariants);
  }
}

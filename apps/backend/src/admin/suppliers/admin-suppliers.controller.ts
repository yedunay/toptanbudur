import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AuditService } from '../../audit/audit.service';
import { AdminSuppliersService } from './admin-suppliers.service';
import { CreateSupplierDto, CreateSupplierFeedDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto, UpdateSupplierFeedDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { BrandMappingsBulkDto } from './dto/brand-mapping.dto';
import { TextRulesBulkDto } from './dto/text-rules.dto';
import { CategoryActiveDto } from './dto/category-active.dto';
import { CategoryPricingDto } from './dto/category-pricing.dto';

type AdminReq = Request & { user: RequestUser };

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('suppliers')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/suppliers')
export class AdminSuppliersController {
  constructor(
    private readonly service: AdminSuppliersService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: AdminReq) {
    return {
      type: 'admin' as const,
      id: req.user.id,
      email: req.user.email,
      name: req.user.email,
      tenantId: req.user.tenantId,
    };
  }

  @Get()
  list(@Query() query: SupplierQueryDto, @Req() req: AdminReq) {
    return this.service.list(req.user.tenantId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.findOne(req.user.tenantId, id);
  }

  @Post()
  async create(@Body() dto: CreateSupplierDto, @Req() req: AdminReq) {
    const result = await this.service.create(req.user.tenantId, dto, {
      id: req.user.id,
      email: req.user.email,
    });
    await this.audit.record({
      action: 'SUPPLIER_CREATE',
      summary: `${req.user.email} '${dto.name}' tedarikçisini oluşturdu`,
      actor: this.actor(req),
      target: { id: result.data.id, type: 'supplier', label: dto.name },
      after: { name: dto.name },
      req,
    });
    return result;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: AdminReq,
  ) {
    const { data: before } = await this.service.findOne(req.user.tenantId, id);
    const result = await this.service.update(req.user.tenantId, id, dto);
    await this.audit.record({
      action: 'SUPPLIER_UPDATE',
      summary: `${req.user.email} '${before.name}' tedarikçisinin bilgilerini güncelledi`,
      actor: this.actor(req),
      target: { id, type: 'supplier', label: before.name },
      before: { name: before.name, active: before.active },
      after: dto as unknown as Record<string, unknown>,
      req,
    });
    return result;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AdminReq) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .then((r) => r.data)
      .catch(() => null);
    const result = await this.service.remove(req.user.tenantId, id);
    await this.audit.record({
      action: 'SUPPLIER_DELETE',
      summary: `${req.user.email} '${before?.name ?? id}' tedarikçisini sildi`,
      actor: this.actor(req),
      target: { id, type: 'supplier', label: before?.name ?? null },
      before: before ? { name: before.name } : null,
      req,
    });
    return result;
  }

  @Post(':id/sync')
  @HttpCode(202)
  async sync(@Param('id') id: string, @Req() req: AdminReq) {
    const result = await this.service.enqueueSync(req.user.tenantId, id);
    const supplier = await this.service
      .findOne(req.user.tenantId, id)
      .then((r) => r.data)
      .catch(() => null);
    await this.audit.record({
      action: 'SUPPLIER_SYNC_TRIGGER',
      summary: `${req.user.email} '${supplier?.name ?? id}' tedarikçisi için XML senkronizasyonu başlattı`,
      actor: this.actor(req),
      target: { id, type: 'supplier', label: supplier?.name ?? null },
      req,
    });
    return result;
  }

  @Get(':id/feeds')
  listFeeds(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.listFeeds(req.user.tenantId, id);
  }

  @Post(':id/feeds')
  async createFeed(
    @Param('id') id: string,
    @Body() dto: CreateSupplierFeedDto,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.createFeed(req.user.tenantId, id, dto);
    const feedId =
      (result as { data?: { id?: string } })?.data?.id ?? id;
    await this.audit.record({
      action: 'SUPPLIER_FEED_CREATE',
      summary: `${req.user.email} tedarikçi için '${dto.name}' XML feed'i ekledi`,
      actor: this.actor(req),
      target: { id: feedId, type: 'supplier-feed', label: dto.name },
      after: { name: dto.name, feedUrl: dto.feedUrl },
      req,
    });
    return result;
  }

  @Patch(':id/feeds/:feedId')
  async updateFeed(
    @Param('id') id: string,
    @Param('feedId') feedId: string,
    @Body() dto: UpdateSupplierFeedDto,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.updateFeed(req.user.tenantId, id, feedId, dto);
    await this.audit.record({
      action: 'SUPPLIER_FEED_UPDATE',
      summary: `${req.user.email} XML feed bilgilerini güncelledi`,
      actor: this.actor(req),
      target: { id: feedId, type: 'supplier-feed' },
      after: dto as unknown as Record<string, unknown>,
      req,
    });
    return result;
  }

  @Delete(':id/feeds/:feedId')
  @HttpCode(200)
  async deleteFeed(
    @Param('id') id: string,
    @Param('feedId') feedId: string,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.deleteFeed(req.user.tenantId, id, feedId);
    await this.audit.record({
      action: 'SUPPLIER_FEED_DELETE',
      summary: `${req.user.email} XML feed'i sildi`,
      actor: this.actor(req),
      target: { id: feedId, type: 'supplier-feed' },
      req,
    });
    return result;
  }

  @Get(':id/feeds/:feedId/detect-currencies')
  detectFeedCurrencies(
    @Param('id') id: string,
    @Param('feedId') feedId: string,
    @Req() req: AdminReq,
  ) {
    return this.service.detectFeedCurrencies(req.user.tenantId, id, feedId);
  }

  @Post(':id/feeds/:feedId/sync')
  @HttpCode(202)
  async syncFeed(
    @Param('id') id: string,
    @Param('feedId') feedId: string,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.enqueueFeedSync(req.user.tenantId, id, feedId);
    await this.audit.record({
      action: 'SUPPLIER_FEED_SYNC',
      summary: `${req.user.email} bir XML feed için manuel senkronizasyon başlattı`,
      actor: this.actor(req),
      target: { id: feedId, type: 'supplier-feed' },
      req,
    });
    return result;
  }

  @Post(':id/sync-categories')
  async syncCategories(@Param('id') id: string, @Req() req: AdminReq) {
    const result = await this.service.triggerCategorySync(req.user.tenantId, id);
    await this.audit.record({
      action: 'SUPPLIER_CATEGORY_SYNC',
      summary: `${req.user.email} tedarikçi kategori senkronizasyonu başlattı`,
      actor: this.actor(req),
      target: { id, type: 'supplier' },
      req,
    });
    return result;
  }

  @Get(':supplierId/categories')
  listCategories(@Param('supplierId') supplierId: string, @Req() req: AdminReq) {
    return this.service.listCategories(req.user.tenantId, supplierId);
  }

  /// V3: tedarikçinin DOĞRU (canonical) kategorileri + ürün sayıları (salt-okunur).
  @Get(':supplierId/canonical-categories')
  listCanonicalCategories(
    @Param('supplierId') supplierId: string,
    @Req() req: AdminReq,
  ) {
    return this.service.listCanonicalCategories(req.user.tenantId, supplierId);
  }

  /// V3: belirli doğru kategorideki tedarikçi ürünleri (?path=...).
  @Get(':supplierId/canonical-categories/products')
  listCanonicalCategoryProducts(
    @Param('supplierId') supplierId: string,
    @Query('path') path: string,
    @Req() req: AdminReq,
  ) {
    return this.service.listCanonicalCategoryProducts(
      req.user.tenantId,
      supplierId,
      path,
    );
  }

  @Patch(':supplierId/categories/:categoryCode')
  async setCategoryActive(
    @Param('supplierId') supplierId: string,
    @Param('categoryCode') categoryCode: string,
    @Body() dto: CategoryActiveDto,
    @Req() req: AdminReq,
  ) {
    const decoded = decodeURIComponent(categoryCode);
    const result = await this.service.setCategoryActive(
      req.user.tenantId,
      supplierId,
      decoded,
      dto.isActive,
    );
    await this.audit.record({
      action: 'SUPPLIER_CATEGORY_TOGGLE',
      summary: `${req.user.email} '${decoded}' kategorisini ${
        dto.isActive ? 'aktif' : 'pasif'
      } hale getirdi`,
      actor: this.actor(req),
      target: { id: supplierId, type: 'supplier-category', label: decoded },
      after: { isActive: dto.isActive },
      req,
    });
    return result;
  }

  @Patch(':supplierId/categories/:categoryCode/pricing')
  async setCategoryPricing(
    @Param('supplierId') supplierId: string,
    @Param('categoryCode') categoryCode: string,
    @Body() dto: CategoryPricingDto,
    @Req() req: AdminReq,
  ) {
    const decoded = decodeURIComponent(categoryCode);
    const result = await this.service.setCategoryPricing(
      req.user.tenantId,
      supplierId,
      decoded,
      {
        marginPercentOverride: dto.marginPercentOverride,
        extraCostTryOverride: dto.extraCostTryOverride,
        profitTypeOverride: dto.profitTypeOverride,
        profitTiers: dto.profitTiers,
      },
    );
    await this.audit.record({
      action: 'SUPPLIER_CATEGORY_PRICING',
      summary: `${req.user.email} '${decoded}' kategorisi için fiyatlandırma override ayarladı (marj=${
        dto.marginPercentOverride ?? 'global'
      }, ek kâr=${dto.extraCostTryOverride ?? 'global'})`,
      actor: this.actor(req),
      target: { id: supplierId, type: 'supplier-category', label: decoded },
      after: {
        marginPercentOverride: dto.marginPercentOverride ?? null,
        extraCostTryOverride: dto.extraCostTryOverride ?? null,
      },
      req,
    });
    return result;
  }

  @Get(':id/products')
  listProducts(
    @Param('id') id: string,
    @Req() req: AdminReq,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('categoryPath') categoryPath?: string,
    @Query('sourceBrand') sourceBrand?: string,
  ) {
    return this.service.listProducts(
      req.user.tenantId,
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
      q,
      categoryPath,
      sourceBrand,
    );
  }

  @Get(':id/brands')
  listBrands(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.listBrands(req.user.tenantId, id);
  }

  @Put(':id/brands')
  async upsertBrands(
    @Param('id') id: string,
    @Body() dto: BrandMappingsBulkDto,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.upsertBrandMappings(req.user.tenantId, id, dto);
    const count = Array.isArray(dto.mappings) ? dto.mappings.length : 0;
    await this.audit.record({
      action: 'SUPPLIER_BRAND_MAPPING_UPSERT',
      summary: `${req.user.email} ${count} marka eşleştirmesini kaydetti`,
      actor: this.actor(req),
      target: { id, type: 'supplier-brand' },
      extra: { count },
      req,
    });
    return result;
  }

  @Delete(':id/brands/:source')
  async deleteBrand(
    @Param('id') id: string,
    @Param('source') source: string,
    @Req() req: AdminReq,
  ) {
    const decoded = decodeURIComponent(source);
    const result = await this.service.deleteBrandMapping(req.user.tenantId, id, decoded);
    await this.audit.record({
      action: 'SUPPLIER_BRAND_MAPPING_DELETE',
      summary: `${req.user.email} '${decoded}' marka eşleştirmesini sildi`,
      actor: this.actor(req),
      target: { id, type: 'supplier-brand', label: decoded },
      req,
    });
    return result;
  }

  @Get(':id/text-rules')
  listTextRules(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.listTextRules(req.user.tenantId, id);
  }

  @Put(':id/text-rules')
  async upsertTextRules(
    @Param('id') id: string,
    @Body() dto: TextRulesBulkDto,
    @Req() req: AdminReq,
  ) {
    const result = await this.service.upsertTextRules(req.user.tenantId, id, dto);
    const count = Array.isArray(dto.rules) ? dto.rules.length : 0;
    await this.audit.record({
      action: 'SUPPLIER_TEXT_RULES_UPSERT',
      summary: `${req.user.email} ${count} metin kuralını kaydetti`,
      actor: this.actor(req),
      target: { id, type: 'supplier-text-rule' },
      extra: { count },
      req,
    });
    return result;
  }
}

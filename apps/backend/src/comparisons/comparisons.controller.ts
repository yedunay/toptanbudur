import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { ComparisonsService } from './comparisons.service';
import { CheaperHintDto, CreateCompetitorDto, ManualMatchDto, MatchDecisionDto, UpdateCompetitorDto } from './dto/comparison.dto';

type Req2 = Request & { user: RequestUser };

/** "a,b,c" → ['a','b','c'] (boş = tüm rakipler). */
function parseIds(ids?: string): string[] {
  return (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Karşılaştırmalar — 'comparisons' sayfa izniyle korunur. Prefix 'admin/comparisons'.
 * Faz 2: rakip/tedarikçi CRUD + XML sync + onay kuyruğu + onayla/reddet.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('comparisons')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/comparisons')
export class ComparisonsController {
  constructor(private readonly service: ComparisonsService) {}

  @Get('overview')
  overview(@Req() req: Req2) {
    return this.service.overview(req.user.tenantId);
  }

  @Get('opportunities')
  opportunities(@Req() req: Req2, @Query('take') take?: string) {
    return this.service.opportunities(req.user.tenantId, Number(take) || 40);
  }

  @Get('competitors')
  list(@Req() req: Req2) {
    return this.service.listCompetitors(req.user.tenantId);
  }

  @Post('competitors')
  create(@Req() req: Req2, @Body() dto: CreateCompetitorDto) {
    return this.service.createCompetitor(req.user.tenantId, dto);
  }

  @Patch('competitors/:id')
  update(@Req() req: Req2, @Param('id') id: string, @Body() dto: UpdateCompetitorDto) {
    return this.service.updateCompetitor(req.user.tenantId, id, dto);
  }

  @Delete('competitors/:id')
  remove(@Req() req: Req2, @Param('id') id: string) {
    return this.service.deleteCompetitor(req.user.tenantId, id);
  }

  @Post('competitors/:id/sync')
  sync(@Req() req: Req2, @Param('id') id: string) {
    return this.service.sync(req.user.tenantId, id);
  }

  @Get('pending')
  pending(
    @Req() req: Req2,
    @Query('ids') ids?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('sort') sort?: string,
  ) {
    return this.service.listPending(
      req.user.tenantId, parseIds(ids), Number(take) || 50, Number(skip) || 0,
      sort === 'conf_asc' ? 'conf_asc' : 'conf_desc',
    );
  }

  @Get('approved')
  approved(
    @Req() req: Req2,
    @Query('ids') ids?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.service.listApproved(req.user.tenantId, parseIds(ids), Number(take) || 60, Number(skip) || 0);
  }

  @Patch('matches/:matchId')
  decide(@Req() req: Req2, @Param('matchId') matchId: string, @Body() dto: MatchDecisionDto) {
    return this.service.decide(req.user.tenantId, matchId, dto.status, req.user.id);
  }

  @Get('missing')
  missing(
    @Req() req: Req2,
    @Query('ids') ids?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.service.listMissing(req.user.tenantId, parseIds(ids), Number(take) || 50, Number(skip) || 0);
  }

  @Post('competitor-products/:cpId/manual-match')
  manualMatch(@Req() req: Req2, @Param('cpId') cpId: string, @Body() dto: ManualMatchDto) {
    return this.service.manualMatch(req.user.tenantId, cpId, dto.code, req.user.id);
  }

  @Get('competitors/:id/supplier-eval')
  supplierEval(@Req() req: Req2, @Param('id') id: string) {
    return this.service.supplierEval(req.user.tenantId, id);
  }

  @Get('competitors/:id/supplier-analysis')
  supplierAnalysis(
    @Req() req: Req2,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('priceStatus') priceStatus?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('q') q?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.service.supplierAnalysis(req.user.tenantId, id, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 100,
      priceStatus, stockStatus, q, sortBy, sortDir,
    });
  }

  @Get('competitors/:id/supplier-analysis-export')
  async supplierAnalysisExport(@Req() req: Req2, @Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.service.supplierAnalysisExcel(req.user.tenantId, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── "Daha ucuz tedarikçi" manuel işaret (Siparişlerde uyarı etiketi) ──
  @Get('cheaper-hints')
  cheaperHints(@Req() req: Req2) {
    return this.service.listCheaperHints(req.user.tenantId);
  }

  @Post('cheaper-hint')
  setCheaperHint(@Req() req: Req2, @Body() dto: CheaperHintDto) {
    return this.service.setCheaperHint(req.user.tenantId, dto, req.user.id);
  }

  @Delete('cheaper-hint/:productId')
  removeCheaperHint(@Req() req: Req2, @Param('productId') productId: string) {
    return this.service.removeCheaperHint(req.user.tenantId, productId);
  }

  @Get('price-compare')
  priceCompare(
    @Req() req: Req2,
    @Query('customerId') customerId: string,
    @Query('competitorId') competitorId?: string,
    @Query('q') q?: string,
  ) {
    return this.service.priceCompare(req.user.tenantId, customerId, competitorId || undefined, q || undefined);
  }
}

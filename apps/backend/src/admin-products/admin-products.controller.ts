import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RolesGuard } from '../auth/roles.guard';
import {
  AdminProductsService,
  type ManualProductImageInput,
} from './admin-products.service';
import {
  AdminProductListQueryDto,
  BulkDeleteDto,
  BulkUpdateDto,
  CreateManualProductDto,
  UpdateProductDto,
} from './dto';

const MAX_MANUAL_IMAGES = 10;
const MAX_MANUAL_IMAGE_BYTES = 5 * 1024 * 1024;

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('products')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  list(
    @Query() query: AdminProductListQueryDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.products.list(req.user.tenantId, query);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.products.update(req.user.tenantId, id, dto);
  }

  @Post('bulk-update')
  bulkUpdate(
    @Body() dto: BulkUpdateDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.products.bulkUpdate(req.user.tenantId, dto, {
      id: req.user.id,
    });
  }

  @Post('bulk-delete')
  bulkDelete(
    @Body() dto: BulkDeleteDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.products.bulkDelete(req.user.tenantId, dto, {
      id: req.user.id,
    });
  }

  // Manuel ürün oluşturma. Multipart/form-data: scalar alanlar `Body`,
  // görseller `images[]` (en fazla 10 dosya × 5 MB). DTO transform Type
  // dekoratörleri ile string'leri sayı/boolean'a çevirir.
  @Post('manual')
  @HttpCode(201)
  @UseInterceptors(
    FilesInterceptor('images', MAX_MANUAL_IMAGES, {
      limits: { fileSize: MAX_MANUAL_IMAGE_BYTES, files: MAX_MANUAL_IMAGES },
    }),
  )
  async createManual(
    @Body() dto: CreateManualProductDto,
    @UploadedFiles() files: MulterFile[] | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) {
      throw new BadRequestException('En az 1 ürün görseli yüklemelisiniz.');
    }
    if (list.length > MAX_MANUAL_IMAGES) {
      throw new BadRequestException(
        `En fazla ${MAX_MANUAL_IMAGES} görsel yükleyebilirsiniz.`,
      );
    }
    const images: ManualProductImageInput[] = list.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
    }));
    return this.products.createManual(
      req.user.tenantId,
      req.user.id,
      dto,
      images,
    );
  }
}

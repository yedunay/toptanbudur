import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import {
  AdminPopupsService,
  MAX_POPUP_IMAGE_BYTES,
  MAX_POPUP_VIDEO_BYTES,
  type PopupActor,
} from './admin-popups.service';
import { CreatePopupDto } from './dto/create-popup.dto';
import { UpdatePopupDto } from './dto/update-popup.dto';

/** Multer dosya tipi — admin-users controller'ı ile birebir aynı yerel arayüz. */
interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard)
@Controller('admin/popups')
export class AdminPopupsController {
  constructor(private readonly service: AdminPopupsService) {}

  private actorOf(req: Request & { user: RequestUser }): PopupActor {
    return {
      id: req.user.id,
      tenantId: req.user.tenantId,
      email: req.user.email,
    };
  }

  @Get()
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  list(@Req() req: Request & { user: RequestUser }) {
    return this.service.list(req.user.tenantId);
  }

  @Get(':id')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  get(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.service.get(req.user.tenantId, id);
  }

  @Post()
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  create(
    @Body() dto: CreatePopupDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.create(req.user.tenantId, dto, this.actorOf(req), req);
  }

  @Patch(':id')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePopupDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.update(
      req.user.tenantId,
      id,
      dto,
      this.actorOf(req),
      req,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  remove(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.service.remove(req.user.tenantId, id, this.actorOf(req), req);
  }

  @Post(':id/image')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_POPUP_IMAGE_BYTES, files: 1 },
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    if (!file) throw new BadRequestException('Görsel seçilmedi');
    return this.service.uploadImage(
      req.user.tenantId,
      id,
      this.actorOf(req),
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      req,
    );
  }

  @Delete(':id/image')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  deleteImage(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.deleteImage(
      req.user.tenantId,
      id,
      this.actorOf(req),
      req,
    );
  }

  /**
   * Blok medyası yükleme (görsel VEYA video). Tek alan: `file`. Tür sihirli
   * baytlarla doğrulanır; görsel ≤ 8 MB, video ≤ 30 MB. Döner { key, url, kind }
   * — admin bu anahtarı içerik bloğuna yerleştirir.
   */
  @Post(':id/media')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('popup')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_POPUP_VIDEO_BYTES, files: 1 },
    }),
  )
  uploadMedia(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    if (!file) throw new BadRequestException('Dosya seçilmedi');
    return this.service.uploadMedia(
      req.user.tenantId,
      id,
      this.actorOf(req),
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      req,
    );
  }
}

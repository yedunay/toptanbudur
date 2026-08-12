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
import { AdminUsersService, MAX_PROFILE_PHOTO_BYTES } from './admin-users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Kullanıcı CRUD'u (OWNER/ADMIN). Profil fotoğrafı route'ları biraz farklı:
 *  - `/me/photo` → JWT'li herkes (MEMBER dahil) kendi fotoğrafını yönetir
 *  - `/:id/photo` → sadece OWNER/ADMIN başkasının fotoğrafını değiştirebilir
 * Bu yüzden controller'ı tek `@Roles` ile bloklayamayız; method-level guard'lar
 * kullanıyoruz.
 */
@UseGuards(JwtAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  list(@Req() req: Request & { user: RequestUser }) {
    return this.service.list(req.user.tenantId);
  }

  @Post()
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  create(
    @Body() dto: CreateUserDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.create(
      req.user.tenantId,
      dto,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
        role: req.user.role,
      },
      req,
    );
  }

  @Patch(':id')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.update(
      req.user.tenantId,
      id,
      dto,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
        role: req.user.role,
      },
      req,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.remove(
      req.user.tenantId,
      id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }

  // --- Profil fotoğrafı ---

  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
    }),
  )
  uploadOwnPhoto(
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    if (!file) throw new BadRequestException('Fotoğraf seçilmedi');
    return this.service.uploadPhoto(
      req.user.tenantId,
      req.user.id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
        email: req.user.email,
      },
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      req,
    );
  }

  @Delete('me/photo')
  deleteOwnPhoto(@Req() req: Request & { user: RequestUser }) {
    return this.service.deletePhoto(
      req.user.tenantId,
      req.user.id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
        email: req.user.email,
      },
      req,
    );
  }

  @Post(':id/photo')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
    }),
  )
  uploadUserPhoto(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    if (!file) throw new BadRequestException('Fotoğraf seçilmedi');
    return this.service.uploadPhoto(
      req.user.tenantId,
      id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
        email: req.user.email,
      },
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      req,
    );
  }

  @Delete(':id/photo')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  deleteUserPhoto(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.deletePhoto(
      req.user.tenantId,
      id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
        email: req.user.email,
      },
      req,
    );
  }

  // --- Oturum yönetimi & güvenlik ---

  @Get(':id/sessions')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  listSessions(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.listSessions(req.user.tenantId, id);
  }

  @Delete(':id/sessions')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  revokeAllSessions(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.revokeAllSessions(
      req.user.tenantId,
      id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }

  @Post(':id/force-password-reset')
  @UseGuards(RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN')
  @RequirePage('ayarlar_kullanicilar')
  forcePasswordReset(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.forcePasswordReset(
      req.user.tenantId,
      id,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }
}

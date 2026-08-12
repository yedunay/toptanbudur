import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { AdminMessagesService } from './admin-messages.service';
import { ListMessagesDto } from './dto/list-messages.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('mesajlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/messages')
export class AdminMessagesController {
  constructor(private readonly service: AdminMessagesService) {}

  @Get()
  list(@Query() query: ListMessagesDto) {
    return this.service.list(query);
  }
}

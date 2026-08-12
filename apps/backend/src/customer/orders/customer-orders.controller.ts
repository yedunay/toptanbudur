import {
  Controller,
  Get,
  Header,
  HttpException,
  InternalServerErrorException,
  Logger,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import { CustomerOrdersExportService } from './customer-orders-export.service';
import { CustomerOrdersService } from './customer-orders.service';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';

@UseGuards(CustomerJwtGuard)
@Controller('me/orders')
export class CustomerOrdersController {
  private readonly logger = new Logger(CustomerOrdersController.name);

  constructor(
    private readonly service: CustomerOrdersService,
    private readonly exportService: CustomerOrdersExportService,
  ) {}

  @Get()
  list(
    @Query() query: ListOrdersQueryDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.list(req.customer!.id, query);
  }

  @Get('summary')
  summary(@Req() req: RequestWithCustomer) {
    return this.service.summary(req.customer!.id);
  }

  @Get('dashboard')
  dashboard(@Req() req: RequestWithCustomer) {
    return this.service.dashboard(req.customer!.id);
  }

  @Get('export.xlsx')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('Cache-Control', 'no-store')
  async export(
    @Query() query: ListOrdersQueryDto,
    @Req() req: RequestWithCustomer,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      const { buffer, filename } = await this.exportService.export(
        req.customer!.id,
        query,
      );
      const safeFilename = filename.replace(/[\r\n"]/g, '');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
      );
      res.setHeader('Content-Length', String(buffer.byteLength));
      return new StreamableFile(Readable.from(buffer));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `[orders-export] failed for customer=${req.customer?.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        'Excel dosyası hazırlanamadı. Lütfen birazdan tekrar deneyin.',
      );
    }
  }

  @Get('check-cargo-barcode')
  checkCargoBarcode(
    @Query('barcode') barcode: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.checkCargoBarcode(req.customer!.id, barcode ?? '');
  }

  @Get(':id/receipt')
  receipt(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return this.service.getReceiptForCustomer(req.customer!.id, id);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return this.service.detail(req.customer!.id, id);
  }
}

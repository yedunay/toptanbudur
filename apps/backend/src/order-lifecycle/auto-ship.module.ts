import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AutoShipService } from './auto-ship.service';
import { AutoShipController } from './auto-ship.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AutoShipController],
  providers: [AutoShipService],
  exports: [AutoShipService],
})
export class AutoShipModule {}

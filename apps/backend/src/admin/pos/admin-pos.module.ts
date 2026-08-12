import { Module } from '@nestjs/common';
import { PaytrModule } from '../../payments/paytr/paytr.module';
import { ToslaModule } from '../../payments/tosla/tosla.module';
import { AdminPosController } from './admin-pos.controller';
import { AdminPosService } from './admin-pos.service';

@Module({
  imports: [PaytrModule, ToslaModule],
  controllers: [AdminPosController],
  providers: [AdminPosService],
  exports: [AdminPosService],
})
export class AdminPosModule {}

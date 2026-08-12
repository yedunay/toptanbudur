import { Module } from '@nestjs/common';
import { AdminMuhasebeController } from './admin-muhasebe.controller';
import { AdminMuhasebeService } from './admin-muhasebe.service';

@Module({
  controllers: [AdminMuhasebeController],
  providers: [AdminMuhasebeService],
  exports: [AdminMuhasebeService],
})
export class AdminMuhasebeModule {}

import { Module } from '@nestjs/common';
import { DealerController } from './dealer.controller';
import { DealerService } from './dealer.service';
import { MailModule } from '../mail/mail.module';
import { BayiNumberService } from '../receipts/bayi-number.service';

@Module({
  imports: [MailModule],
  controllers: [DealerController],
  // BayiNumberService stateless'tir (yalnız `bayi_no_seq` çağırır); ReceiptsModule
  // onu dışa açmadığı için burada doğrudan sağlanır — CariTopupNumberService'in
  // ReceiptsModule'de çoğaltıldığı desenin aynısı. Aynı sequence üzerinde çalışır.
  providers: [DealerService, BayiNumberService],
  exports: [DealerService],
})
export class DealerModule {}

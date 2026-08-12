import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController, AdminFormsController } from './forms.controller';
import { DealerModule } from '../dealer/dealer.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [DealerModule, MailModule],
  controllers: [FormsController, AdminFormsController],
  providers: [FormsService],
})
export class FormsModule {}

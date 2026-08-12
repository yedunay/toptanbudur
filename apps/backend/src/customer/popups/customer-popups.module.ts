import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../../customer-auth/customer-auth.module';
import { CustomerPopupsController } from './customer-popups.controller';
import { CustomerPopupsService } from './customer-popups.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerPopupsController],
  providers: [CustomerPopupsService],
})
export class CustomerPopupsModule {}

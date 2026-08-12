import { Global, Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { AppSettingsController } from './app-settings.controller';
import { PublicPricingController } from './public-pricing.controller';

@Global()
@Module({
  providers: [AppSettingsService],
  controllers: [AppSettingsController, PublicPricingController],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}

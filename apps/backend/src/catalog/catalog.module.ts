import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';

// CustomerAuthModule, opsiyonel cookie-auth için gereken `JwtService`'i (export
// edilen `JwtModule` üzerinden) sağlar. Public katalog yine anonim erişime
// açıktır; doğrulama yalnızca `ADMIN_DISCOUNT` müşteriyi tanımak için yapılır.
@Module({
  imports: [CustomerAuthModule],
  providers: [CatalogService],
  controllers: [CatalogController],
})
export class CatalogModule {}

import { Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageController } from './storage.controller';
import { StoragePublicController } from './storage-public.controller';
import { LocalStorageService } from './local-storage.service';
import { R2StorageService } from './r2-storage.service';
import { StorageUrlHealService } from './storage-url-heal.service';
import { STORAGE_SERVICE } from './storage.constants';
import type { IFileStorage } from './storage.interface';

/**
 * Storage module. Tüm uploadlar (destek talepleri, iade talepleri, sipariş
 * PDF) `STORAGE_SERVICE` token üzerinden IFileStorage'a gider; somut sınıfa
 * bağımlı değildir, böylece `STORAGE_DRIVER=r2` ile call-site'lara
 * dokunmadan provider değişebilir.
 *
 * Driver selection:
 *   STORAGE_DRIVER=local  (default) → LocalStorageService writes to disk
 *   STORAGE_DRIVER=r2               → R2StorageService (Cloudflare R2 via
 *                                     @aws-sdk/client-s3); requires R2_*
 *                                     env vars or constructor throws.
 *
 * Not: Eski `StorageService` (doğrudan MinIO/S3 PUT signer) kaldırıldı —
 * önceden yalnız OrdersService.uploadPdf() kullanıyordu ve bucket'ın
 * dışarıdan oluşturulmuş olmasını gerektiriyordu (init script yoktu, bu
 * yüzden PDF yüklemeleri sürekli `NoSuchBucket` ile başarısız oluyordu).
 * PDF artık IFileStorage üzerinden gider.
 */
const fileStorageProvider: Provider = {
  provide: STORAGE_SERVICE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IFileStorage => {
    const driver = (config.get<string>('STORAGE_DRIVER') ?? 'local')
      .toLowerCase()
      .trim();
    if (driver === 'r2') {
      return new R2StorageService(config);
    }
    return new LocalStorageService(config);
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [StorageController, StoragePublicController],
  // R2StorageService eager provider olarak DEĞİL, yalnızca fileStorageProvider
  // factory'si içinde STORAGE_DRIVER=r2 iken new'lenir. Eager bırakılırsa
  // local modda R2_* env'i olmadan constructor patlar ve uygulama açılmaz.
  providers: [
    LocalStorageService,
    fileStorageProvider,
    StorageUrlHealService,
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}

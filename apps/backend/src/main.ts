import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { turkishExceptionFactory } from './common/validation/turkish-validation-pipe';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';

async function bootstrap() {
  // bufferLogs delays log emission until useLogger swaps in nestjs-pino,
  // so early bootstrap logs go through the structured pipeline instead of
  // being silently dropped by the default Nest logger.
  // bodyParser limit: order PDF upload uses base64 JSON body (max 10 MB raw
  // PDF -> ~13.3 MB encoded). Default Express limit (100 KB) would reject it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  // Nginx (reverse proxy) arkasında çalışıyoruz; gerçek istemci IP'si
  // `X-Forwarded-For` başlığında gelir. `trust proxy=1` ile Express bu başlığı
  // değerlendirip `req.ip`'yi doğru istemci IP'sine ayarlar. Bu, ThrottlerGuard
  // ve per-IP login deneme sayacının her isteği aynı (proxy) IP'siyle
  // karıştırmamasını sağlar.
  app.set('trust proxy', 1);
  // Reject oversized JSON bodies before the parser reads them. Multipart
  // uploads (foto/iade/destek/konuşma ekleri) ve PDF upload route'u kendi
  // limitlerini Multer/route seviyesinde uyguluyor — bu guard JSON-only
  // taşıyan payload'ları sınırlamak içindir. Aksi takdirde iade pazarına
  // 4-8 görsel (max 40 MB) yükleyen müşteri 413 alıyor.
  const PDF_UPLOAD_PATH = '/api/orders/upload-pdf';
  const BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MB for JSON / urlencoded
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentType = String(req.headers['content-type'] ?? '');
    const isMultipart = contentType.toLowerCase().startsWith('multipart/');
    if (isMultipart) {
      next();
      return;
    }
    const cl = parseInt(req.headers['content-length'] ?? '0', 10);
    if (req.path !== PDF_UPLOAD_PATH && cl > BODY_LIMIT_BYTES) {
      res.status(413).json({ message: 'Request entity too large', limit: '1mb' });
      return;
    }
    next();
  });
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: turkishExceptionFactory,
    }),
  );

  // Multer dosya boyutu/dosya sayısı vb. limit hataları yakalanmazsa NestJS
  // bunları 500 olarak döner ve müşteri "İstek başarısız" görür. Filter
  // MulterError'ları 400 + Türkçe mesaja çevirir.
  app.useGlobalFilters(new MulterExceptionFilter());

  app.use(cookieParser());

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.use(helmet());

  // Destek talebi ekleri artık StorageController üzerinden HMAC-imzalı
  // `/api/storage/<key>?exp&sig` URL'leriyle servis ediliyor — eski
  // `/uploads/...` statik route'u kaldırıldı çünkü herkese açık erişim
  // veriyordu (#H-1). STORAGE_DRIVER=r2 olduğunda controller 404 döner ve
  // istemci doğrudan R2 presigned URL'sini kullanır.
  // path-to-regexp v6 sözdizimi: `xml/(.*)` legacy route uyarısı veriyordu.
  // RequestMethod.ALL + `path: 'xml/*splat'` formuna geçince warn temizleniyor.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'xml/*splat', method: RequestMethod.ALL }],
  });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  app.get(Logger).log(`Backend running on :${port}/api`, 'Bootstrap');
}
void bootstrap();

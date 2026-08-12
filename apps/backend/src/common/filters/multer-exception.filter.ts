import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// multer 2.1.1 ships its own MulterError class but no separate @types/multer
// is installed in this workspace; tip-toe around the type lookup with a
// `require` + minimal interface so we get the runtime constructor for the
// @Catch decorator without pulling in extra dev dependencies.
interface MulterErrorShape extends Error {
  code: string;
  field?: string;
}
type MulterErrorCtor = new (...args: unknown[]) => MulterErrorShape;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multerModule = require('multer') as { MulterError: MulterErrorCtor };
const MulterError = multerModule.MulterError;

/**
 * Multer dosya yüklemede limit aştığında (örn. 5 MB üzeri görsel,
 * 10 MB üzeri PDF, izin verilen dosya sayısı aşılırsa) `MulterError`
 * fırlatır. NestJS bu hatayı yakalamaz → istemciye 500 düşer ve kullanıcı
 * generic "İstek başarısız" görür. Bu filter MulterError'ı 400'e çevirir
 * ve hangi limit aşıldığını Türkçe açıklar.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterExceptionFilter.name);

  catch(exception: MulterErrorShape, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const message = this.translate(exception);
    this.logger.warn(
      `multer rejected upload code=${exception.code} field=${exception.field ?? '-'}`,
    );
    res.status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      code: exception.code,
      message,
    });
  }

  private translate(err: MulterErrorShape): string {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return 'Dosya boyutu limitini aşıyor (en fazla 5 MB).';
      case 'LIMIT_FILE_COUNT':
        return 'Yüklenebilecek dosya sayısı aşıldı.';
      case 'LIMIT_UNEXPECTED_FILE':
        return `Beklenmeyen dosya alanı: ${err.field ?? 'bilinmiyor'}.`;
      case 'LIMIT_PART_COUNT':
        return 'Form alan sayısı çok fazla.';
      case 'LIMIT_FIELD_KEY':
        return 'Form alan adı çok uzun.';
      case 'LIMIT_FIELD_VALUE':
        return 'Form alan değeri çok uzun.';
      case 'LIMIT_FIELD_COUNT':
        return 'Form alan sayısı limitini aştı.';
      default:
        return 'Dosya yüklenemedi (geçersiz istek).';
    }
  }
}

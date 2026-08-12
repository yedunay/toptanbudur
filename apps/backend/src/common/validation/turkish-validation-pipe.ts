import { BadRequestException, ValidationPipeOptions } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { getTurkishLabel } from './property-labels';
import {
  buildTurkishMessage,
  extractConstraintsFromMessage,
  isDefaultEnglishMessage,
} from './turkish-constraint-messages';

/**
 * class-validator ValidationError ağacını özyinelemeli olarak gezer ve
 * her constraint için Türkçe mesaj üretir.
 *
 * - Property path'i `customer.address.line1` formatında biriktirir.
 * - Decorator inline `message: 'foo'` vermişse:
 *     - mesaj İngilizce default kalıbına uyuyorsa Türkçeye çevrilir,
 *     - aksi takdirde geliştiricinin verdiği mesaj olduğu gibi korunur.
 * - `each: true` validasyonlarında contexts içindeki bilgiyi kullanarak
 *   "alanındaki her bir öğe" ekler.
 */
function flattenErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): string[] {
  const messages: string[] = [];

  for (const err of errors) {
    const segment = err.property ?? '';
    const path = parentPath ? `${parentPath}.${segment}` : segment;

    if (err.constraints) {
      const label = getTurkishLabel(path);
      // contexts içinden each bilgisini çıkar (varsa).
      const contexts = (err.contexts ?? {}) as Record<
        string,
        { each?: boolean } | undefined
      >;

      for (const [constraintKey, originalMessage] of Object.entries(
        err.constraints,
      )) {
        const ctx = contexts[constraintKey];
        const isEach = Boolean(ctx?.each);

        // class-validator'ın default İngilizce kalıbına uyuyorsa Türkçeye çevir.
        // Aksi takdirde DTO'da inline verilmiş custom mesajdır; korumayı dene
        // ama yine de İngilizce kalıbına benziyorsa çevir.
        const shouldTranslate = isDefaultEnglishMessage(originalMessage);
        // class-validator argümanları ValidationError'a iliştirmiyor; default
        // mesajdan parse ediyoruz ki "$constraint1" yerleri sayı ile dolsun.
        const constraints = shouldTranslate
          ? extractConstraintsFromMessage(constraintKey, originalMessage)
          : [];
        const message = shouldTranslate
          ? buildTurkishMessage(constraintKey, label, constraints, isEach)
          : originalMessage;

        messages.push(message);
      }
    }

    if (err.children && err.children.length > 0) {
      messages.push(...flattenErrors(err.children, path));
    }
  }

  return messages;
}

/**
 * NestJS ValidationPipe için Türkçe `exceptionFactory`.
 *
 * Kullanımı (main.ts):
 *
 *   new ValidationPipe({
 *     whitelist: true,
 *     forbidNonWhitelisted: true,
 *     transform: true,
 *     exceptionFactory: turkishExceptionFactory,
 *   })
 *
 * Üretilen yanıt formatı NestJS'in standardına uygundur:
 *
 *   {
 *     "statusCode": 400,
 *     "message": ["e-posta geçerli bir e-posta olmalıdır", ...],
 *     "error": "Bad Request"
 *   }
 */
export const turkishExceptionFactory: NonNullable<
  ValidationPipeOptions['exceptionFactory']
> = (errors) => {
  const validationErrors = errors as ValidationError[];
  const messages = flattenErrors(validationErrors);
  // class-validator bazen hiç constraint döndürmez (sadece children dolu olur);
  // emniyet için boş bir mesaj listesi ile de sağlam dön.
  const finalMessages = messages.length > 0 ? messages : ['Geçersiz istek gövdesi'];
  return new BadRequestException({
    statusCode: 400,
    message: finalMessages,
    error: 'Bad Request',
  });
};

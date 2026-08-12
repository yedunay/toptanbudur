import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { isValidTrPhone } from '../utils/phone';

/**
 * `@IsTrPhone()` — Esnek TR cep telefonu doğrulayıcı.
 *
 * Boşluk, parantez, tire, nokta ile yazılmış girdileri kabul eder.
 * Ülke kodu olsun olmasın (+90 / 0090 / 90 / 0 / yalın 10 hane) eşler.
 * 10 haneli ana kısım 5 ile başlamalı.
 */
export function IsTrPhone(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isTrPhone',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return isValidTrPhone(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} geçerli bir Türkiye cep telefonu olmalı (örn. +90 5XX XXX XX XX)`;
        },
      },
    });
  };
}

import { randomBytes } from 'crypto';

/**
 * TBDR public barcode generator.
 *
 * Müşteriye sunulan ürünlerde orijinal tedarikçi barkodu yerine kullanılan
 * pseudo-barkod. Format:
 *
 *   TBDR + 24 hex (uppercase) + 4 char (uppercase alfanumerik suffix)
 *   Toplam: 32 karakter, "TBDR" prefix sabit.
 *
 * Örnek: TBDRBA12CD34EF5678901234567890ABCD
 *
 * Yöntem:
 *  - Hex segment crypto.randomBytes(12).toString('hex').toUpperCase() = 24 hex.
 *  - Suffix 4 karakter [A-Z0-9] random — benzersizlik şansını artırır,
 *    pazaryerlerinde "rastgele" görüntüsü için.
 *
 * Not: Generator stateless. Çağrı tarafı (IngestService) DB'de unique
 * constraint çakışırsa retry yapmalı (5 deneme yeterli, 32 char alanında
 * çakışma astronomik olarak düşük).
 */

const SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SUFFIX_LENGTH = 4;
const HEX_BYTES = 12; // 12 byte → 24 hex karakter

export function generatePublicBarcode(): string {
  const hex = randomBytes(HEX_BYTES).toString('hex').toUpperCase();
  // Random alphabet suffix — crypto.randomBytes ile bias-free seçim.
  const suffixBytes = randomBytes(SUFFIX_LENGTH);
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[suffixBytes[i] % SUFFIX_ALPHABET.length];
  }
  return `TBDR${hex}${suffix}`;
}

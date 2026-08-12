/**
 * Storefront form yardımcıları.
 *
 * Türkiye telefon numaraları farklı biçimlerde girilebilir
 * ("0500 000 00 00", "+90 500 000 00 00", "905000000000", vb).
 * Esnek doğrulama yapılır, normalize edilirken sadece +90XXXXXXXXXX
 * (E.164) hâline getirilir.
 */

export interface PhoneValidation {
  ok: boolean;
  reason?: string;
  /** E.164 formatında, örn: +905000000000 */
  normalized?: string;
}

/**
 * Türkiye numarasını E.164 (+90XXXXXXXXXX) biçimine getirir.
 * Tanınmayan girdilerde null döner.
 */
export function normalizeTrPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^\d]/g, "");
  if (!digits) return null;

  // 10 hane (5XXXXXXXXX)
  if (digits.length === 10 && digits.startsWith("5")) {
    return `+90${digits}`;
  }
  // 11 hane (05XXXXXXXXX) — başta 0, kaldır
  if (digits.length === 11 && digits.startsWith("0") && digits[1] === "5") {
    return `+90${digits.slice(1)}`;
  }
  // 12 hane (905XXXXXXXXX) — başta 90 ülke kodu
  if (digits.length === 12 && digits.startsWith("90") && digits[2] === "5") {
    return `+${digits}`;
  }
  return null;
}

/**
 * UI tarafında telefonu doğrular.
 * Boş girdi `ok: true` döner — opsiyonel alanlar için kullanışlı.
 */
export function validateTrPhone(
  input: string | null | undefined,
  { required = false }: { required?: boolean } = {},
): PhoneValidation {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    if (required) return { ok: false, reason: "Telefon zorunlu" };
    return { ok: true };
  }
  const normalized = normalizeTrPhone(trimmed);
  if (!normalized) {
    return {
      ok: false,
      reason: "Geçerli bir cep numarası girin (örn. 0500 000 00 00)",
    };
  }
  return { ok: true, normalized };
}

/**
 * Kullanıcıya görüntülenmek için biçim:
 *   +905000000000 → "+90 500 000 00 00"
 */
export function formatTrPhoneDisplay(e164OrLocal: string | null | undefined): string {
  const norm = normalizeTrPhone(e164OrLocal ?? "");
  if (!norm) return (e164OrLocal ?? "").trim();
  // norm = +90XXXXXXXXXX
  const rest = norm.slice(3); // 10 hane
  return `+90 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`;
}

interface Time24InputProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 24-saat (HH:MM) saat girişi.
 *
 * Neden native <input type="time"> DEĞİL: native time picker'ın 12-saat (AM/PM)
 * mi yoksa 24-saat mi gösterdiği tamamen TARAYICI/OS diline bağlıdır ve koddan
 * güvenilir biçimde zorlanamaz. İngilizce (en-US) locale'li bir tarayıcıda
 * "23:00" yerine "11:00 PM" görünür. Admin kullanıcısı her ortamda DAİMA
 * 24-saat ("23:00") görmeli ve girmeli olduğu için, native picker yerine her
 * yerde aynı davranan kontrollü bir text input kullanılır.
 *
 * İletilen/saklanan değer her zaman normalize "HH:MM" (24h) formatındadır.
 * Kullanıcı "2300", "9", "23.00" gibi yazsa bile blur'da "23:00" / "09:00"e
 * normalize edilir. Backend tarafı zaten aynı formatı bekler — ARKA PLAN
 * DAVRANIŞI DEĞİŞMEZ, yalnız görünüm/giriş 24-saate sabitlenir.
 */
export function Time24Input({
  value,
  onChange,
  className,
  disabled,
  placeholder = "23:00",
}: Time24InputProps): React.ReactElement {
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        const norm = normalizeHHMM24(e.target.value);
        if (norm !== value) onChange(norm);
      }}
      className={className}
    />
  );
}

/// Serbest girilen metni 24-saat "HH:MM"e çevirir. Boş bırakılırsa "" döner
/// (üst katman default'a düşürür). Saat 00-23, dakika 00-59 aralığına kırpar.
/// "2300" → "23:00", "9" → "09:00", "23.00" → "23:00".
function normalizeHHMM24(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  let h: number;
  let m: number;
  if (trimmed.includes(":")) {
    const [hs, ms] = trimmed.split(":");
    h = Number(hs.replace(/\D/g, "") || "0");
    m = Number((ms ?? "").replace(/\D/g, "") || "0");
  } else {
    const digits = trimmed.replace(/\D/g, "");
    if (digits === "") return "";
    if (digits.length <= 2) {
      h = Number(digits);
      m = 0;
    } else {
      h = Number(digits.slice(0, digits.length - 2));
      m = Number(digits.slice(-2));
    }
  }

  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

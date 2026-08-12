import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildWelcomeWhatsAppMessage,
  buildWelcomeWhatsAppUrl,
} from "../lib/dealerApplications";

interface DealerApprovalModalProps {
  /** Onaylanan başvurunun bağlı olduğu müşteri (varsa). */
  customer?: {
    email: string;
    name: string;
    phone?: string | null;
  } | null;
  /**
   * Backend'in döndürdüğü tek kullanımlık parola. Yalnızca ilk onay
   * cevabında bulunur; idempotent path bu alanı içermez. Modal `null`
   * ise sadece bilgi mesajı gösterir.
   */
  oneTimePassword: string | null;
  /** Idempotent yeniden onay durumu — başlık ve mesaj buna göre değişir. */
  alreadyApproved?: boolean;
  onClose: () => void;
}

/**
 * Bayi başvurusu onaylandığında admin'e tek seferlik parolayı gösteren
 * modal. SMTP yapılandırılmamış olabileceği için parola burada görünür
 * şekilde sunulur ve kopyalanabilir. Admin parolayı güvenli bir kanaldan
 * (telefon, kişisel mesajlaşma vb.) müşteriye iletmekten sorumludur.
 *
 * Güvenlik notu: parola istemci state'i dışında HİÇBİR yerde saklanmaz.
 * Modal kapandığında değer bellekten düşer; tekrar görüntülenemez.
 */
export default function DealerApprovalModal({
  customer,
  oneTimePassword,
  alreadyApproved = false,
  onClose,
}: DealerApprovalModalProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // oneTimePassword mesaja gömülür — WhatsApp metni e-postayla birebir aynı
  // içeriği (giriş bilgileri + topluluk daveti) taşır. İdempotent yeniden
  // onayda parola olmadığından mesaj bilgi bloğu olmadan üretilir.
  const waUrl = useMemo(
    () =>
      buildWelcomeWhatsAppUrl(customer?.phone, {
        fullName: customer?.name,
        email: customer?.email,
        tempPassword: oneTimePassword,
      }),
    [customer?.phone, customer?.name, customer?.email, oneTimePassword],
  );
  const waMessage = useMemo(
    () =>
      buildWelcomeWhatsAppMessage({
        fullName: customer?.name,
        email: customer?.email,
        tempPassword: oneTimePassword,
      }),
    [customer?.name, customer?.email, oneTimePassword],
  );

  function openWhatsApp(): void {
    if (!waUrl) return;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  // Best-effort: onay sonrası modal açılınca WhatsApp sekmesini otomatik açmayı
  // dener. Tarayıcı popup engelleyicisi bunu bloklayabilir — bu durumda admin
  // aşağıdaki "WhatsApp'ta Aç ve Gönder" butonunu kullanır (garantili yol).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!waUrl || alreadyApproved) return;
    autoOpenedRef.current = true;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }, [waUrl, alreadyApproved]);

  async function handleCopy(): Promise<void> {
    if (!oneTimePassword) return;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(oneTimePassword);
      } else {
        // Fallback: clipboard API yoksa kullanıcıyı manuel kopyaya yönlendir.
        throw new Error("clipboard-unavailable");
      }
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        "Otomatik kopyalama başarısız. Lütfen parolayı manuel olarak seçip kopyalayın.",
      );
    }
  }

  const title = alreadyApproved
    ? "Başvuru zaten onaylanmış"
    : "Başvuru onaylandı";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dealer-approval-title"
        className="w-full max-w-md rounded-xl bg-white shadow-lg border border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h2
            id="dealer-approval-title"
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            {title}
          </h2>
          {customer ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {customer.name} &middot; {customer.email}
            </p>
          ) : null}
        </div>

        <div className="px-5 py-4 space-y-4 text-sm text-[var(--color-text)]">
          {oneTimePassword ? (
            <>
              <p>
                Müşteri için aşağıdaki tek kullanımlık geçici parola
                üretildi. Bu parola yalnızca <strong>bir kez</strong>{" "}
                gösterilecek; modal kapatıldıktan sonra yeniden
                görüntülenemez.
              </p>

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  Geçici parola
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <code className="font-mono text-base font-semibold text-[var(--color-text)] break-all select-all">
                    {oneTimePassword}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopy();
                    }}
                    className="shrink-0 rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-navy)]"
                  >
                    {copied ? "Kopyalandı" : "Kopyala"}
                  </button>
                </div>
              </div>

              {copyError ? (
                <p className="text-xs text-red-600">{copyError}</p>
              ) : null}

              <p className="text-xs text-[var(--color-text-muted)]">
                Müşteriye güvenli bir kanaldan iletin. SMTP
                yapılandırılmışsa otomatik e-posta da gönderilmiştir,
                ancak gönderim garanti değildir. Müşteri ilk girişte
                parolasını değiştirmek zorundadır.
              </p>
            </>
          ) : alreadyApproved ? (
            <p>
              Bu başvuru daha önce onaylanmış. Tek kullanımlık parola
              sadece ilk onay sırasında üretilir ve tekrar gösterilemez.
              Müşteri parolasını unuttuysa şifre sıfırlama akışını
              kullanmalıdır.
            </p>
          ) : (
            <p>
              Başvuru onaylandı, ancak geçici parola döndürülmedi.
              Beklenmeyen bir durum oluştu — backend loglarını kontrol
              edin.
            </p>
          )}

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Hoş geldin mesajı (WhatsApp)
            </div>
            <textarea
              readOnly
              value={waMessage}
              rows={6}
              className="mt-2 w-full resize-none rounded-md border border-[var(--color-border)] bg-white p-2 text-xs text-[var(--color-text)]"
            />
            <div className="mt-2 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={openWhatsApp}
                disabled={!waUrl}
                className="self-start rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1ebe57] disabled:cursor-not-allowed disabled:opacity-50"
              >
                WhatsApp'ta Aç ve Gönder
              </button>
              {waUrl ? (
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Yeni sekmede, tarayıcınızda açık WhatsApp Web oturumunda ilgili
                  numaraya mesaj hazır gelir; yalnızca &quot;Gönder&quot;e basın.
                </span>
              ) : (
                <span className="text-[11px] text-red-600">
                  Telefon numarası yok/geçersiz — WhatsApp mesajı açılamıyor.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-muted)] rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-[var(--color-brand-blue)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)]"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}

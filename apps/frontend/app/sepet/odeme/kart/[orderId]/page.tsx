"use client";

import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useParams, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";
import { formatPrice } from "@/lib/api";
import { apiCustomer, ApiError } from "@/lib/auth";
import { formatOrderNo } from "@/lib/orders";

interface PaytrTokenData {
  token: string;
  iframeUrl: string;
  merchantOid: string;
  orderId: string;
  humanOrderNo: string | null;
  amount: number;
  /** Aktif POS sağlayıcısı: 'paytr' iFrame resizer ister; 'tosla' sabit yükseklik. */
  provider?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: PaytrTokenData }
  | { kind: "error"; message: string };

export default function KartOdemePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-6 py-10" />}>
      <KartOdemePageInner />
    </Suspense>
  );
}

function KartOdemePageInner() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const orderId = params.orderId;
  const t = searchParams.get("t");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // React StrictMode dev'de effect'i iki kez çalıştırır — token endpoint'i
  // her çağrıda yeni bir ödeme denemesi başlattığı için aynı anahtarla
  // İKİNCİ kez vurulmaz.
  const requestedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const key = `${orderId}|${t ?? ""}|${attempt}`;
    if (requestedKeyRef.current === key) return;
    requestedKeyRef.current = key;

    // ÖNEMLİ: StrictMode'un cleanup'ında bu isteğin sonucunu ÇÖPE ATMA —
    // ref guard yüzünden ikinci çalıştırma yeni istek atmaz; sonuç
    // atılırsa sayfa dev'de sonsuza dek spinner'da kalır. Bunun yerine
    // bayatlık kontrolü key üzerinden yapılır: yalnızca aradan yeni bir
    // istek (yeni key) başladıysa bu cevap yok sayılır.
    const isStale = () => requestedKeyRef.current !== key;
    setState({ kind: "loading" });
    apiCustomer<{ success?: boolean; data?: PaytrTokenData }>(
      "/payments/card/token",
      {
        method: "POST",
        general: true,
        body: JSON.stringify({ orderId, ...(t ? { t } : {}) }),
      },
    )
      .then((res) => {
        if (isStale()) return;
        if (res?.success && res.data?.iframeUrl) {
          setState({ kind: "ok", data: res.data });
        } else {
          setState({
            kind: "error",
            message: "Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.",
          });
        }
      })
      .catch((err) => {
        if (isStale()) return;
        setState({
          kind: "error",
          message:
            err instanceof ApiError && err.message.trim()
              ? err.message
              : "Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.",
        });
      });
  }, [orderId, t, attempt]);

  // Aktif sağlayıcı: PayTR iFrame resizer ister; TOSLA ortak ödeme sayfası
  // resizer handshake yapmaz → sabit yükseklikli iframe kullanılır.
  // provider belirsizse (eski yanıt) PayTR davranışına düş — canlı aktif POS.
  const provider =
    state.kind === "ok" ? (state.data.provider ?? "paytr") : null;
  const usesResizer = provider === "paytr";

  // iFrameResizer'ı güvenli biçimde başlat — hem script onLoad'unda hem de
  // iframe DOM'a girdiğinde denenir; ikisi birden hazır değilse no-op.
  const initIframeResizer = useCallback(() => {
    if (typeof window === "undefined") return;
    const resize = (
      window as unknown as {
        iFrameResize?: (options: object, selector: string) => void;
      }
    ).iFrameResize;
    if (typeof resize !== "function") return;
    if (!document.getElementById("paytriframe")) return;
    resize({}, "#paytriframe");
  }, []);

  useEffect(() => {
    if (state.kind === "ok" && usesResizer) initIframeResizer();
  }, [state, usesResizer, initIframeResizer]);

  return (
    <main className="mx-auto max-w-3xl px-6 pb-10 pt-5">
      {usesResizer ? (
        <Script
          src="https://www.paytr.com/js/iframeResizer.min.js"
          strategy="afterInteractive"
          onLoad={initIframeResizer}
        />
      ) : null}

      <nav className="mb-4 text-sm">
        <Link
          href="/sepet"
          className="inline-flex items-center gap-1 font-semibold text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Sepete dön
        </Link>
      </nav>

      <h1 className="text-3xl font-black tracking-tight text-[var(--brand-navy)] sm:text-4xl">
        Güvenli Ödeme
      </h1>

      {state.kind === "loading" ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-blue)] border-t-transparent"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--text-muted)]">
            Güvenli ödeme sayfası hazırlanıyor…
          </p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="mt-8 space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.message}</span>
          </div>
          <p className="text-center text-xs text-[var(--text-muted)]">
            Sepetiniz korunuyor — dilerseniz ödeme adımına dönüp cari
            bakiyenizle de ödeyebilirsiniz.
          </p>
          <div className="flex flex-col items-center gap-3 text-center">
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
            >
              Tekrar dene
            </button>
            <Link
              href="/sepet/odeme"
              className="text-sm font-semibold text-[var(--brand-blue)] hover:underline"
            >
              Ödeme adımına dön
            </Link>
            <Link
              href="/sepet"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
            >
              Sepete dön
            </Link>
          </div>
        </div>
      ) : null}

      {state.kind === "ok" ? (
        <>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Sipariş No:{" "}
            <span className="font-mono font-black text-[var(--text)]">
              {formatOrderNo(state.data.humanOrderNo, state.data.orderId)}
            </span>{" "}
            — Tutar:{" "}
            <span className="font-black text-[var(--brand-navy)]">
              {formatPrice(state.data.amount, "TRY")}
            </span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3 text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1">
              <Image src="/payment/visa.svg" alt="Visa" width={36} height={24} />
              <Image
                src="/payment/mastercard.svg"
                alt="Mastercard"
                width={36}
                height={24}
              />
              <Image src="/payment/troy.svg" alt="Troy" width={36} height={24} />
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                256-bit SSL ile şifrelenir, kart bilgileriniz bizde saklanmaz.
              </span>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-3xl border border-[var(--border)] bg-white shadow-sm">
            {usesResizer ? (
              <iframe
                src={state.data.iframeUrl}
                id="paytriframe"
                frameBorder={0}
                scrolling="no"
                style={{ width: "100%" }}
                onLoad={initIframeResizer}
              />
            ) : (
              <iframe
                src={state.data.iframeUrl}
                title="Güvenli ödeme"
                frameBorder={0}
                scrolling="auto"
                style={{ width: "100%", height: 620 }}
              />
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}

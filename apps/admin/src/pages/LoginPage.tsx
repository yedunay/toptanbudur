import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiFetch, applyTokensFromLogin, getToken, tryAutoLogin } from "../lib/auth";
import { APP_URLS } from "../lib/urls";
import { firstAllowedRoute } from "../lib/permissions";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type Step = "credentials" | "otp";

interface LoginBackendResponse {
  accessToken?: string;
  refreshToken?: string;
  otpRequired?: boolean;
  otpSession?: string;
}

function toEmailCandidate(value: string): string {
  return value.trim();
}

export default function LoginPage(): React.ReactElement {
  useDocumentTitle("Giriş");
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("credentials");
  const [identifier, setIdentifier] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [otpSession, setOtpSession] = useState<string>("");
  const [otpCode, setOtpCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  // İlk render sırasında form bir an görünüp sonra kaybolmasın diye
  // auto-login denemesi bitene kadar formu gizliyoruz.
  const [autoLoginPending, setAutoLoginPending] = useState<boolean>(true);

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Mount sırasında trusted-device cookie'siyle sessizce giriş dene.
  // Başarılıysa kullanıcı login formunu hiç görmez, direkt dashboard'a düşer.
  // Eğer localStorage'da zaten access token varsa auto-login'i bile atla;
  // bu, AdminShell'in yönlendirmesiyle gelen senaryoları (rota guard'ı vs.)
  // sessize alır ve gereksiz network round-trip'ini önler.
  useEffect(() => {
    if (getToken()) {
      navigate(firstAllowedRoute(), { replace: true });
      return;
    }
    let cancelled = false;
    void tryAutoLogin().then((ok) => {
      if (cancelled) return;
      if (ok) {
        navigate(firstAllowedRoute(), { replace: true });
        return;
      }
      setAutoLoginPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<LoginBackendResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: toEmailCandidate(identifier), password }),
      });

      if (data.accessToken) {
        applyTokensFromLogin(data.accessToken, data.refreshToken ?? null);
        navigate(firstAllowedRoute(), { replace: true });
        return;
      }

      if (data.otpRequired && data.otpSession) {
        setOtpSession(data.otpSession);
        setStep("otp");
        setTimeout(() => otpInputRef.current?.focus(), 50);
        return;
      }

      setError("Kullanıcı adı veya şifre hatalı");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Kullanıcı adı veya şifre hatalı");
        } else if (err.status === 0 || err.status >= 500) {
          setError("Sunucuya ulaşılamadı, lütfen tekrar deneyin");
        } else {
          setError(err.message || "Giriş başarısız");
        }
      } else {
        setError("Sunucuya ulaşılamadı, lütfen tekrar deneyin");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<{ accessToken: string; refreshToken?: string }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ otpSession, code: otpCode, rememberMe }),
      });

      if (!data.accessToken) {
        setError("Doğrulama başarısız, tekrar deneyin");
        return;
      }

      applyTokensFromLogin(data.accessToken, data.refreshToken ?? null);
      navigate(firstAllowedRoute(), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Kod hatalı veya süresi dolmuş");
        } else {
          setError(err.message || "Doğrulama başarısız");
        }
      } else {
        setError("Sunucuya ulaşılamadı, lütfen tekrar deneyin");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (autoLoginPending) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-10">
        <div className="text-sm text-[var(--color-text-muted)]">
          Oturum doğrulanıyor…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 gap-4">
      <a
        href={APP_URLS.landing}
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand-navy)]"
      >
        ← Anasayfaya dön
      </a>
      <div className="w-full max-w-md rounded-2xl bg-white border border-[var(--color-border)] shadow-sm p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">
            <span className="text-[var(--color-brand-navy)]">Toptan</span>
            <span className="ml-1 font-medium text-[var(--color-brand-blue)]">
              Budur
            </span>
            <span className="ml-2 text-sm text-[var(--color-text-muted)] font-normal">
              · Admin
            </span>
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {step === "credentials" ? "Yönetim paneline giriş yapın" : "E-postanıza gönderilen kodu girin"}
          </p>
        </div>

        {step === "credentials" ? (
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Kullanıcı Adı veya E-posta
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Şifre
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
              />
              <span>Beni hatırla (30 gün boyunca bu cihazda kal)</span>
            </label>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[var(--color-brand-navy)] hover:bg-[var(--color-brand-blue)] text-white py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Giriş yapılıyor…" : "Giriş yap"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtp} className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Doğrulama Kodu
              </label>
              <input
                ref={otpInputRef}
                id="otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={4}
                pattern="\d{4}"
                placeholder="0000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {identifier} adresine 4 haneli kod gönderildi. Gelmezse spam klasörünü kontrol edin.
              </p>
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || otpCode.length !== 4}
              className="w-full rounded-md bg-[var(--color-brand-navy)] hover:bg-[var(--color-brand-blue)] text-white py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Doğrulanıyor…" : "Doğrula"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("credentials"); setError(null); setOtpCode(""); }}
              className="w-full text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              ← Geri dön
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

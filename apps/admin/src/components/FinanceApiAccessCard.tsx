import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchFinanceApiState,
  generateFinanceApiKey,
  revealFinanceApiKey,
  revokeFinanceApiKey,
  type FinanceApiState,
} from "../lib/partner-finance-api";
import { useToast } from "./Toast";

/**
 * "Hesabım" sayfasındaki Ortak Finans API bölümü. Yalnız bir finans ortağına
 * bağlı admin kullanıcıda görünür; başka
 * adminlerde `state.isPartner=false` döner ve bölüm HİÇ render edilmez.
 *
 * İki parça: (1) API anahtarı yönetimi (üret / göster / kopyala / iptal),
 * (2) tam dokümantasyon — uçlar, parametreler, dönen alanlar, örnek istekler.
 */

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export default function FinanceApiAccessCard(): React.ReactElement | null {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const stateQuery = useQuery<FinanceApiState>({
    queryKey: ["finance-api-state"],
    queryFn: fetchFinanceApiState,
  });

  const baseUrl = useMemo(
    () =>
      typeof window !== "undefined"
        ? `${window.location.origin}/api/partner-finance`
        : "https://toptanbudur.com/api/partner-finance",
    [],
  );

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["finance-api-state"] });

  const generateMutation = useMutation({
    mutationFn: () => generateFinanceApiKey(),
    onSuccess: (res) => {
      setRevealedToken(res.token);
      toast.push("success", "Yeni API anahtarı oluşturuldu");
      invalidate();
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Oluşturulamadı"),
  });

  const revealMutation = useMutation({
    mutationFn: () => revealFinanceApiKey(),
    onSuccess: (res) => setRevealedToken(res.token),
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Gösterilemedi"),
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeFinanceApiKey(),
    onSuccess: () => {
      setRevealedToken(null);
      toast.push("success", "API anahtarı iptal edildi");
      invalidate();
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "İptal edilemedi"),
  });

  // Yükleniyor / hata / ortak değilse: bölümü GÖSTERME.
  if (stateQuery.isLoading) return null;
  if (stateQuery.isError || !stateQuery.data) return null;
  const state = stateQuery.data;
  if (!state.isPartner || !state.partner) return null;

  const key = state.key;
  const busy =
    generateMutation.isPending ||
    revealMutation.isPending ||
    revokeMutation.isPending;

  const handleCopy = async (text: string, label: string): Promise<void> => {
    const ok = await copyText(text);
    toast.push(ok ? "success" : "error", ok ? `${label} kopyalandı` : "Kopyalanamadı");
  };

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Finans API Erişimi</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Kendi finans serini (yalnız <b>{state.partner.name}</b> için) dış bir
            sitede çekmen için salt-okunur API anahtarı. Yalnızca <b>GET</b>.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-muted)] px-2 py-1 text-xs font-medium">
          Pay: %{state.partner.sharePercent}
        </span>
      </div>

      {/* ── Anahtar yönetimi ─────────────────────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/50 p-4">
        {!key ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Henüz bir API anahtarın yok.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => generateMutation.mutate()}
              className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {generateMutation.isPending ? "Oluşturuluyor…" : "API Anahtarı Oluştur"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                API Anahtarı
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-xs">
                  {revealedToken ?? key.masked}
                </code>
                {revealedToken ? (
                  <button
                    type="button"
                    onClick={() => setRevealedToken(null)}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-xs hover:bg-[var(--color-surface-muted)]"
                  >
                    Gizle
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revealMutation.mutate()}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
                  >
                    {revealMutation.isPending ? "…" : "Göster"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || !revealedToken}
                  onClick={() =>
                    revealedToken && handleCopy(revealedToken, "Anahtar")
                  }
                  title={
                    revealedToken
                      ? "Anahtarı kopyala"
                      : "Önce 'Göster' ile anahtarı aç"
                  }
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
                >
                  Kopyala
                </button>
              </div>
              {revealedToken && (
                <p className="mt-1 text-xs text-amber-700">
                  Bu anahtar hesabın gibidir — kimseyle paylaşma, yalnız kendi
                  sitenin sunucusunda sakla.
                </p>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[var(--color-text-muted)]">Oluşturuldu</dt>
                <dd>{fmtDate(key.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Son kullanım</dt>
                <dd>{fmtDate(key.lastUsedAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Toplam istek</dt>
                <dd>{key.requestCount.toLocaleString("tr-TR")}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Yeni anahtar üretilsin mi? Mevcut anahtar HEMEN geçersiz olur ve dış siteye yeni anahtarı girmen gerekir.",
                    )
                  ) {
                    generateMutation.mutate();
                  }
                }}
                className="rounded-md bg-[var(--color-brand-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Yeni Anahtar Üret
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Anahtar iptal edilsin mi? Bu anahtarla yapılan tüm erişim durur.",
                    )
                  ) {
                    revokeMutation.mutate();
                  }
                }}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                İptal Et
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Dokümantasyon ────────────────────────────────────────────────── */}
      <FinanceApiDocs baseUrl={baseUrl} onCopy={handleCopy} />
    </section>
  );
}

// ── Dokümantasyon bölümü ──────────────────────────────────────────────────────

interface EndpointDoc {
  method: "GET";
  path: string;
  params: string;
  returns: string;
}

const ENDPOINTS: EndpointDoc[] = [
  {
    method: "GET",
    path: "/me",
    params: "—",
    returns: "Anahtarın hangi ortağa ait olduğu (kimlik/sağlık kontrolü).",
  },
  {
    method: "GET",
    path: "/summary",
    params: "?month=YYYY-MM (ops., varsayılan bu ay)",
    returns:
      "Şirket: seçili ay (toplam gelir/gider/kâr, dağıtılabilir bakiye) + kümülatif (toplam kâr, KDV farkı, döner sermaye). Senin dilimin: bu ay hak edişin + kümülatif net bakiyen (Toptan Budur'nin sana borcu).",
  },
  {
    method: "GET",
    path: "/monthly",
    params: "?month=YYYY-MM (ops., varsayılan bu ay)",
    returns:
      "Seçili ayın tam dökümü: Toptan Budur + Manuel Gelir/Gider + toplam KPI, masraflar, dağıtım detayı ve senin o ayki dilimin.",
  },
  {
    method: "GET",
    path: "/series",
    params: "?months=1..24 (ops., varsayılan 6), ?to=YYYY-MM (ops.)",
    returns:
      "Ay-ay şirket geliri/gideri/kârı + o ay senin çektiğin kâr avansı. Grafik/tablo için idealdir.",
  },
  {
    method: "GET",
    path: "/advances",
    params: "?from=YYYY-MM (ops.), ?to=YYYY-MM (ops.)",
    returns:
      "Senin kâr avansı (çekim) geçmişin: her satır ay + tarih + brüt + net; toplam net/brüt.",
  },
];

// Muhasebe bölümü uçları — /partner-finance/muhasebe/*
const MUHASEBE_ENDPOINTS: EndpointDoc[] = [
  {
    method: "GET",
    path: "/muhasebe/suppliers",
    params: "?q= (ops.), ?page=1, ?pageSize=50 (≤200)",
    returns: "Tedarikçi listesi (id + ad) — id keşfi için. Sayfalı.",
  },
  {
    method: "GET",
    path: "/muhasebe/customers",
    params: "?q= (ops.), ?page=1, ?pageSize=50 (≤200)",
    returns:
      "Bayi/müşteri listesi: id, ünvan, e-posta, bayiNo ve güncel cari bakiye. Sayfalı.",
  },
  {
    method: "GET",
    path: "/muhasebe/ledger",
    params: "?type=supplier|dealer, ?id=ZORUNLU, ?from=YYYY-MM-DD, ?to=, ?page=, ?pageSize=",
    returns:
      "Cari Hareketler sayfası: seçili tedarikçi/bayinin borç/alacak/bakiye satırları + güncel bakiye + toplam kayıt.",
  },
  {
    method: "GET",
    path: "/muhasebe/tedarikci-hesap",
    params: "?supplierId=ZORUNLU, ?from=YYYY-MM-DD, ?to=",
    returns: "Tedarikçi Hesabı raporu: açılış/kapanış bakiye, hareketler, toplamlar.",
  },
  {
    method: "GET",
    path: "/muhasebe/bayi-hesap",
    params: "?customerId=ZORUNLU, ?from=YYYY-MM-DD, ?to=",
    returns:
      "Bayi Hesabı raporu: siparişler, cari yüklemeler, açılış/kapanış bakiye, mutabakat.",
  },
  {
    method: "GET",
    path: "/muhasebe/makbuzlar",
    params:
      "?kind=order|cari_topup, ?customerId=, ?from=YYYY-MM-DD, ?to=, ?page=, ?pageSize=",
    returns:
      "Tahsilat Makbuzları sayfası: kredi kartı tahsilat makbuzları (tutar, bayi, sipariş/yükleme no, tarih). Sayfalı.",
  },
  {
    method: "GET",
    path: "/muhasebe/makbuzlar/dealers",
    params: "—",
    returns: "Makbuzu olan bayilerin listesi (filtre için).",
  },
];

const FIELD_GLOSSARY: Array<{ key: string; desc: string }> = [
  { key: "toplamGelir", desc: "O ayın toplam geliri (KDV dahil, Toptan Budur + Entegrasyon)." },
  { key: "toplamGider", desc: "O ayın toplam gideri (tedarik maliyeti + entegrasyon gideri)." },
  { key: "toplamKar", desc: "toplamGelir − toplamGider." },
  { key: "kdvFarki", desc: "Tahsil edilen − ödenen KDV (net KDV yükü)." },
  { key: "dagitilabilirBakiye", desc: "O ay ortaklara dağıtılabilir tutar (kâr − KDV farkı − havuz masraf − promo + kart farkı)." },
  { key: "donerSermaye", desc: "Sistem başından beri şirkette biriken, henüz çekilmemiş net kasa." },
  { key: "hakedis", desc: "Bu ay Toptan Budur'nin SANA borcu — önerilen ödeme (payın + masraf dengelemesi)." },
  { key: "netAlacak", desc: "Sistem başından beri toplam hak edişin (kümülatif)." },
  { key: "cekilenAvans", desc: "Şimdiye kadar çektiğin/ödendiğin toplam (kâr avansı)." },
  { key: "netBakiye", desc: "Toptan Budur'nin sana NET borcu = netAlacak − cekilenAvans (artı = AB sana borçlu)." },
];

function FinanceApiDocs({
  baseUrl,
  onCopy,
}: {
  baseUrl: string;
  onCopy: (text: string, label: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(true);

  const curlSummary = `curl -H "Authorization: Bearer AKB_ANAHTARINIZ" \\\n  "${baseUrl}/summary"`;
  const curlSeries = `curl "${baseUrl}/series?months=12&token=AKB_ANAHTARINIZ"`;

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--color-surface-muted)]"
      >
        <span>Nasıl kullanılır? — Dokümantasyon</span>
        <span className="text-[var(--color-text-muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-5 text-sm">
          {/* Temel bilgiler */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoBox title="Temel adres (Base URL)">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">
                  {baseUrl}
                </code>
                <button
                  type="button"
                  onClick={() => onCopy(baseUrl, "Adres")}
                  className="shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white"
                >
                  Kopyala
                </button>
              </div>
            </InfoBox>
            <InfoBox title="Kurallar">
              <ul className="list-inside list-disc space-y-0.5 text-xs text-[var(--color-text-muted)]">
                <li>Yalnızca <b>GET</b> — hiçbir yazma/silme yok.</li>
                <li>Hız limiti: <b>60 istek / dakika</b>.</li>
                <li>Yanıtlar <b>JSON</b>, tutarlar <b>₺</b> (KDV dahil).</li>
                <li>Aylar <b>YYYY-MM</b> (örn. 2026-07); gelecek ay istenemez.</li>
              </ul>
            </InfoBox>
          </div>

          {/* Kimlik doğrulama */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Kimlik doğrulama (3 yoldan biri)
            </h3>
            <div className="mt-2 space-y-1 text-xs">
              <p>
                1) Header <b>(önerilen)</b>:{" "}
                <code className="font-mono">Authorization: Bearer ANAHTAR</code>
              </p>
              <p>
                2) Header: <code className="font-mono">x-akb-finance-key: ANAHTAR</code>
              </p>
              <p>
                3) Query: <code className="font-mono">?token=ANAHTAR</code> — yalnız
                Google Sheets / tarayıcı gibi header atamayan yerlerde kullan.
                <span className="text-amber-700">
                  {" "}
                  Anahtar URL'de kalır (sunucu logu/geçmiş); mümkünse header'ı tercih et.
                </span>
              </p>
            </div>
          </div>

          {/* Uçlar tablosu — Finans */}
          <EndpointTable title="Finans uçları" rows={ENDPOINTS} />

          {/* Uçlar tablosu — Muhasebe */}
          <div>
            <EndpointTable
              title="Muhasebe uçları (Cari Hareketler / Tedarikçi & Bayi Hesabı)"
              rows={MUHASEBE_ENDPOINTS}
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Akış: önce <code className="font-mono">/muhasebe/suppliers</code> veya{" "}
              <code className="font-mono">/muhasebe/customers</code> ile id'leri al,
              sonra <code className="font-mono">/muhasebe/ledger</code> /{" "}
              <code className="font-mono">tedarikci-hesap</code> /{" "}
              <code className="font-mono">bayi-hesap</code> ile o kaydın tüm
              hareketlerini çek. Bu veri admin Muhasebe sayfalarıyla birebir aynıdır.
            </p>
          </div>

          {/* Örnek istekler */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Örnek istekler
            </h3>
            <CodeBlock code={curlSummary} onCopy={() => onCopy(curlSummary, "Örnek")} />
            <CodeBlock code={curlSeries} onCopy={() => onCopy(curlSeries, "Örnek")} />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              <code className="font-mono">AKB_ANAHTARINIZ</code> yerine yukarıdaki
              gerçek anahtarını koy.
            </p>
          </div>

          {/* Alan sözlüğü */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Alan sözlüğü (en çok kullanılanlar)
            </h3>
            <dl className="mt-2 space-y-1.5 text-xs">
              {FIELD_GLOSSARY.map((f) => (
                <div key={f.key} className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-mono font-medium sm:w-44">
                    {f.key}
                  </dt>
                  <dd className="text-[var(--color-text-muted)]">{f.desc}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Kendi sitene entegrasyon notu */}
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3 text-xs text-[var(--color-text-muted)]">
            <p className="font-medium text-[var(--color-text)]">
              Kendi sitene entegre ederken
            </p>
            <p className="mt-1">
              İstekleri kendi sitenin <b>sunucusundan</b> at (PHP, Node, Python,
              Google Apps Script, n8n/Make, Google Sheets IMPORTDATA). Anahtarı
              tarayıcıda/istemci JavaScript'inde açık bırakma. Yanıt gecikirse ya
              da 429 alırsan istek sıklığını düşür (limit 60/dk). Veri, admin
              panelindeki “Aylık Kâr Dağılımı” ile birebir aynıdır.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function EndpointTable({
  title,
  rows,
}: {
  title: string;
  rows: EndpointDoc[];
}): React.ReactElement {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
              <th className="py-2 pr-3 font-medium">Uç</th>
              <th className="py-2 pr-3 font-medium">Parametre</th>
              <th className="py-2 font-medium">Ne döner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.path}
                className="border-b border-[var(--color-border)]/60 align-top"
              >
                <td className="py-2 pr-3">
                  <code className="whitespace-nowrap font-mono">
                    <span className="text-emerald-700">{e.method}</span> {e.path}
                  </code>
                </td>
                <td className="py-2 pr-3 font-mono text-[var(--color-text-muted)]">
                  {e.params}
                </td>
                <td className="py-2 text-[var(--color-text-muted)]">{e.returns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3">
      <p className="mb-1 text-xs font-semibold">{title}</p>
      {children}
    </div>
  );
}

function CodeBlock({
  code,
  onCopy,
}: {
  code: string;
  onCopy: () => void;
}): React.ReactElement {
  return (
    <div className="group relative mt-2">
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 pr-16 font-mono text-xs leading-relaxed text-zinc-100">
        {code}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 rounded bg-white/10 px-2 py-1 text-xs text-zinc-200 hover:bg-white/20"
      >
        Kopyala
      </button>
    </div>
  );
}

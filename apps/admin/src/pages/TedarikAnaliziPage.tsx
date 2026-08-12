import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { getToken } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useToast } from "../components/Toast";
import {
  createCompetitor, deleteCompetitor, fetchCheaperHints, fetchCompetitors, fetchSupplierAnalysis,
  removeCheaperHint, setCheaperHint, supplierAnalysisExportUrl, syncCompetitor, updateCompetitor,
  type SupplierAnalysisProduct,
} from "../lib/comparisons";

const tl = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const nf = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("tr-TR"));
const scoreTone = (s: number) => (s >= 60 ? "text-emerald-600" : s >= 35 ? "text-amber-600" : "text-red-500");
const scoreRing = (s: number) => (s >= 60 ? "#059669" : s >= 35 ? "#d97706" : "#ef4444");
const confTone = (c: number) => (c >= 80 ? "bg-emerald-100 text-emerald-700" : c >= 50 ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700");

/* ürün görseli (kırık/boş → yer tutucu) */
function Img({ url }: { url: string | null }) {
  const [err, setErr] = useState(false);
  if (!url || err) return <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-300">🖼</div>;
  return <img src={url} loading="lazy" onError={() => setErr(true)} className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />;
}

function StatCard({ icon, label, value, sub, tone = "text-slate-900", pct }: { icon: string; label: string; value: string; sub?: string; tone?: string; pct?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-400">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-sm">{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1.5">
        <span className={`text-2xl font-black tabular-nums ${tone}`}>{value}</span>
        {pct && <span className={`mb-0.5 text-sm font-bold ${tone}`}>{pct}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

async function downloadExcel(competitorId: string) {
  const token = getToken();
  const res = await fetch(`/api${supplierAnalysisExportUrl(competitorId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (!res.ok) throw new Error("export failed");
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = m ? m[1] : "yeni-tedarikci-analizi.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function TedarikAnaliziPage() {
  useRequireAuth();
  useDocumentTitle("Yeni Tedarikçi Analizi");
  const qc = useQueryClient();
  const toast = useToast();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState("");

  // filtre + sayfalama
  const [priceStatus, setPriceStatus] = useState("all");
  const [stockStatus, setStockStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (col: string) => { if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortBy(col); setSortDir("desc"); } setPage(1); };
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [priceStatus, stockStatus, activeId]);

  // form
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [kdvIncl, setKdvIncl] = useState(false);
  const [disc, setDisc] = useState("0");
  const [pack, setPack] = useState("0");

  const candidatesQ = useQuery({ queryKey: ["cmp-competitors"], queryFn: fetchCompetitors });
  const candidates = (candidatesQ.data ?? []).filter((c) => c.type === "supplier");
  const analysisQ = useQuery({
    queryKey: ["supplier-analysis", activeId, priceStatus, stockStatus, search, page, sortBy, sortDir],
    queryFn: () => fetchSupplierAnalysis(activeId!, { page, pageSize, priceStatus, stockStatus, q: search, sortBy: sortBy || undefined, sortDir }),
    enabled: !!activeId,
  });
  const a = analysisQ.data;

  const hintsQ = useQuery({ queryKey: ["cheaper-hints"], queryFn: fetchCheaperHints });
  const flagged = new Set((hintsQ.data ?? []).map((h) => h.productId));
  const flagM = useMutation({
    mutationFn: (b: { productId: string; supplierName: string; competitorId?: string; theirCost: number; ourCost: number; productUrl?: string | null }) => setCheaperHint(b),
    onSuccess: () => { toast.push("success", "İşaretlendi — Siparişlerde uyarı çıkacak"); qc.invalidateQueries({ queryKey: ["cheaper-hints"] }); },
    onError: () => toast.push("error", "İşaretlenemedi"),
  });
  const unflagM = useMutation({
    mutationFn: (productId: string) => removeCheaperHint(productId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cheaper-hints"] }); },
    onError: () => toast.push("error", "Kaldırılamadı"),
  });

  const analyze = useMutation({
    mutationFn: async () => {
      setStep("Tedarikçi kaydediliyor…");
      const created = await createCompetitor({ name: name.trim() || "Yeni Tedarikçi", type: "supplier", feedUrl: feedUrl.trim() || undefined, priceKdvIncluded: kdvIncl, purchaseDiscountPercent: Number(disc) || 0, packagingFee: Number(pack) || 0 } as any);
      const id = created.data.id;
      setStep("XML çekiliyor + eşleştiriliyor… (büyük feed birkaç dakika)");
      await syncCompetitor(id);
      setStep("Analiz hesaplanıyor…");
      return id;
    },
    onSuccess: (id) => { setStep(""); setShowForm(false); qc.invalidateQueries({ queryKey: ["cmp-competitors"] }); setActiveId(id); },
    onError: () => { setStep(""); toast.push("error", "Analiz başarısız (XML çekilemedi/eşleştirilemedi)"); },
  });
  const resetForm = () => { setName(""); setFeedUrl(""); setDisc("0"); setPack("0"); setKdvIncl(false); };
  const clearFilters = () => { setPriceStatus("all"); setStockStatus("all"); setSearchInput(""); };

  // Ayarlar = seçili tedarikçinin config'i (KDV/iskonto/paketleme/ad). Değişince analiz yenilenir (re-sync YOK).
  const activeCandidate = candidates.find((c) => c.id === activeId) ?? null;
  const [showSettings, setShowSettings] = useState(false);
  const [sName, setSName] = useState("");
  const [sKdv, setSKdv] = useState(false);
  const [sDisc, setSDisc] = useState("0");
  const [sPack, setSPack] = useState("0");
  const openSettings = () => {
    if (!activeCandidate) return;
    setSName(activeCandidate.name);
    setSKdv(activeCandidate.priceKdvIncluded);
    setSDisc(String(activeCandidate.purchaseDiscountPercent ?? 0));
    setSPack(activeCandidate.packagingFee != null ? String(activeCandidate.packagingFee) : "0");
    setShowSettings(true);
  };
  const saveSettings = useMutation({
    mutationFn: () => updateCompetitor(activeId!, { name: sName.trim() || undefined, priceKdvIncluded: sKdv, purchaseDiscountPercent: Number(sDisc) || 0, packagingFee: Number(sPack) || 0 } as any),
    onSuccess: () => { toast.push("success", "Ayarlar güncellendi — analiz yenilendi"); setShowSettings(false); qc.invalidateQueries({ queryKey: ["cmp-competitors"] }); qc.invalidateQueries({ queryKey: ["supplier-analysis"] }); },
    onError: () => toast.push("error", "Kaydedilemedi"),
  });

  const totalPages = a ? Math.max(1, Math.ceil(a.total / a.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {/* Başlık */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-[var(--color-text,#0f1e3d)]">＋ Yeni Tedarikçi Analizi</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {activeId && <button onClick={openSettings} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:border-slate-300">⚙ Ayarlar</button>}
          {activeId && <button onClick={() => downloadExcel(activeId).catch(() => toast.push("error", "İndirilemedi"))} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:border-slate-300">⬇ Raporu İndir</button>}
          <button onClick={() => { resetForm(); setShowForm((v) => !v); }} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">＋ Yeni Analiz</button>
        </div>
      </div>
      <p className="-mt-2 mb-4 text-sm text-slate-500">Yeni bir tedarikçinin XML'ini yükle, mevcut <b>alış (maliyet)</b> fiyatlarınla otomatik kıyasla — eşleşen ürünler, ucuz/pahalı %, eşleşme güveni ve tahmini tasarruf.</p>

      {/* Yeni Analiz formu */}
      {showForm && (
        <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
          <h2 className="mb-3 font-black text-slate-800">Yeni Tedarikçi Bilgileri</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Tedarikçi Adı<input value={name} onChange={(e) => setName(e.target.value)} placeholder="XYZ Toptan" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
            <label className="text-sm md:col-span-2">XML Kaynağı (URL)<input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://xyz.com/xml/products.xml" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs" /></label>
            <label className="text-sm">KDV<select value={kdvIncl ? "incl" : "excl"} onChange={(e) => setKdvIncl(e.target.value === "incl")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5"><option value="excl">KDV Hariç</option><option value="incl">KDV Dahil</option></select></label>
            <label className="text-sm">Alış İndirimi (%)<input value={disc} onChange={(e) => setDisc(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
            <label className="text-sm">Paketleme Maliyeti (birim ₺)<input value={pack} onChange={(e) => setPack(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => analyze.mutate()} disabled={analyze.isPending || !feedUrl.trim()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-40">{analyze.isPending ? "Analiz ediliyor…" : "XML'yi Analiz Et"}</button>
            {step && <span className="text-sm font-bold text-blue-600">{step}</span>}
            <button onClick={() => setShowForm(false)} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-600">Kapat</button>
          </div>
        </div>
      )}

      {/* Ayarlar — seçili tedarikçinin config'i */}
      {showSettings && activeCandidate && (
        <div className="mb-5 rounded-2xl border border-slate-300 bg-slate-50 p-4">
          <h2 className="mb-1 font-black text-slate-800">⚙ Tedarikçi Ayarları — {activeCandidate.name}</h2>
          <p className="mb-3 text-xs text-slate-500">Fiyat bazını düzelt (ör. KDV dahil sanmışsın ama hariçmiş, alış iskontosu varmış). Kaydedince analiz <b>yeniden hesaplanır</b> — XML tekrar çekilmez.</p>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm">Ad<input value={sName} onChange={(e) => setSName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
            <label className="text-sm">KDV<select value={sKdv ? "incl" : "excl"} onChange={(e) => setSKdv(e.target.value === "incl")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5"><option value="excl">KDV Hariç</option><option value="incl">KDV Dahil</option></select></label>
            <label className="text-sm">Alış İndirimi (%)<input value={sDisc} onChange={(e) => setSDisc(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
            <label className="text-sm">Paketleme Maliyeti (birim ₺)<input value={sPack} onChange={(e) => setSPack(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-40">{saveSettings.isPending ? "Kaydediliyor…" : "Kaydet & Yeniden Hesapla"}</button>
            <button onClick={() => setShowSettings(false)} className="text-sm font-bold text-slate-400 hover:text-slate-600">Vazgeç</button>
          </div>
        </div>
      )}

      {/* Stat kartları */}
      {a && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard icon="📦" label="Toplam Ürün" value={nf(a.totals.xmlTotal)} sub="XML'deki toplam" />
          <StatCard icon="🔗" label="Eşleşen Ürün" value={nf(a.totals.matched)} pct={`%${a.totals.matchedPct}`} sub="katalogla eşleşen" tone="text-blue-600" />
          <StatCard icon="↓" label="Bizden Daha Ucuz" value={nf(a.totals.cheaper)} pct={`%${a.totals.cheaperPct}`} sub="eşleşen içinde" tone="text-emerald-600" />
          <StatCard icon="↑" label="Bizden Daha Pahalı" value={nf(a.totals.expensive)} pct={`%${a.totals.expensivePct}`} sub="eşleşen içinde" tone="text-red-500" />
          <StatCard icon="%" label="Ortalama Avantaj" value={`%${a.totals.avgAdvantagePct}`} sub="fiyat avantajı ort." tone={a.totals.avgAdvantagePct >= 0 ? "text-emerald-600" : "text-red-500"} />
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${scoreRing(a.totals.worthScore)} ${a.totals.worthScore * 3.6}deg, #e2e8f0 0)` }}>
              <div className="grid h-11 w-11 place-items-center rounded-full bg-white"><span className={`text-sm font-black ${scoreTone(a.totals.worthScore)}`}>{a.totals.worthScore}</span></div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Çalışmaya Değer</div>
              <div className={`text-sm font-black ${scoreTone(a.totals.worthScore)}`}>{a.insight.recommend}</div>
            </div>
          </div>
        </div>
      )}

      {/* Filtre satırı */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-xs font-bold text-slate-500">Yeni Tedarikçi
          <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)} className="mt-1 block w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800">
            <option value="">— seç —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500">Fiyat Durumu
          <select value={priceStatus} onChange={(e) => setPriceStatus(e.target.value)} className="mt-1 block w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">Tümü</option><option value="cheaper">Bizden Ucuz</option><option value="expensive">Bizden Pahalı</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500">Stok Durumu
          <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)} className="mt-1 block w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">Tümü</option><option value="instock">Stokta</option><option value="low">Az Stok</option><option value="out">Stok Yok</option>
          </select>
        </label>
        <label className="min-w-[200px] flex-1 text-xs font-bold text-slate-500">Ürün Ara
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ürün adı…" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        {activeId && <button onClick={() => { if (confirm("Bu analiz silinsin mi?")) deleteCompetitor(activeId).then(() => { qc.invalidateQueries({ queryKey: ["cmp-competitors"] }); setActiveId(null); }); }} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-500 hover:bg-red-50">🗑 Sil</button>}
        <button onClick={clearFilters} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:border-slate-300">Filtreleri Temizle</button>
      </div>

      {!activeId && <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Bir tedarikçi seç ya da <b>＋ Yeni Analiz</b> ile XML yükle.</p>}
      {activeId && analysisQ.isLoading && <p className="p-6 text-center text-sm text-slate-400">analiz yükleniyor…</p>}

      {a && (
        <>
          {/* bilgi çubuğu */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200/70 bg-blue-500/5 px-4 py-2.5 text-sm text-slate-600">
            <span className="text-lg">ℹ️</span>
            <b>{nf(a.total)}</b> eşleşen ürün{(priceStatus !== "all" || stockStatus !== "all" || search) ? " (filtreli)" : ""} · Fiyatlar <b>KDV hariç net maliyet</b> üzerinden. Eşleşme %'sine + görsellere bakıp <b>Geçiş Yap</b> ile işaretle.
          </div>

          {/* liste başlığı */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Ürün Karşılaştırma Listesi</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{nf(a.total)} ürün</span>
            <button onClick={() => activeId && downloadExcel(activeId).catch(() => toast.push("error", "İndirilemedi"))} className="ml-auto flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">⊞ Excel'e Aktar</button>
          </div>

          {/* tablo */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="p-3">Yeni Tedarikçi Ürünü</th>
                  <th className="p-3">Bizim Ürünümüz</th>
                  <Th label="Stok" col="stock" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <Th label="Yeni Tedarikçi Fiyat" col="theirCost" align="right" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <Th label="En Ucuz Mevcut Tedarikçi" col="ourCost" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <Th label="Eşleşme" col="confidence" align="center" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <Th label="Fark" col="fark" align="right" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <Th label="Avantaj" col="avantaj" align="right" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <th className="p-3 text-center">Karar</th>
                </tr>
              </thead>
              <tbody>
                {a.products.map((p) => <Row key={p.productId} p={p} supplierName={a.competitor.name} activeId={activeId!} flagged={flagged.has(p.productId)} onFlag={flagM.mutate} onUnflag={unflagM.mutate} pending={flagM.isPending} />)}
                {a.products.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-400">Eşleşen ürün yok (filtreye takılmış olabilir).</td></tr>}
              </tbody>
            </table>
          </div>

          {/* sayfalama */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1} className="rounded-lg border border-slate-200 px-2.5 py-1 font-bold disabled:opacity-40">‹</button>
            <span>Sayfa <b>{page}</b> / {totalPages}</span>
            <button onClick={() => setPage((x) => Math.min(totalPages, x + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-200 px-2.5 py-1 font-bold disabled:opacity-40">›</button>
            <span className="ml-auto">{a.total ? (page - 1) * a.pageSize + 1 : 0}–{Math.min(page * a.pageSize, a.total)} / {nf(a.total)}</span>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            <b>Bizim Maliyet / Mevcut Tedarikçi</b> = ürünü aldığımız tedarikçiler arasından en ucuzu. <b>Eşleşme %</b> = ad-benzerliği güveni (barkod = %100); düşükse görselden kontrol et. <b>Geçiş Yap</b> = Siparişlerde "daha ucuz" uyarısı çıkarır (otomasyon yok).
          </p>
        </>
      )}
    </div>
  );
}

function Th({ label, col, sortBy, sortDir, onSort, align = "left" }: {
  label: string; col: string; sortBy: string; sortDir: "asc" | "desc"; onSort: (c: string) => void; align?: "left" | "right" | "center";
}) {
  const active = sortBy === col;
  return (
    <th onClick={() => onSort(col)} className={`cursor-pointer select-none p-3 hover:text-slate-600 text-${align}`} title="sırala">
      <span className="inline-flex items-center gap-1">{label}<span className={active ? "text-blue-600" : "text-slate-300"}>{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span></span>
    </th>
  );
}

function Row({ p, supplierName, activeId, flagged, onFlag, onUnflag, pending }: {
  p: SupplierAnalysisProduct; supplierName: string; activeId: string; flagged: boolean;
  onFlag: (b: { productId: string; supplierName: string; competitorId?: string; theirCost: number; ourCost: number; productUrl?: string | null }) => void;
  onUnflag: (productId: string) => void; pending: boolean;
}) {
  const stockBadge = p.ourStock > 10
    ? <span className="inline-flex items-center gap-1 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Stokta</span>
    : p.ourStock > 0
    ? <span className="inline-flex items-center gap-1 text-amber-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Az Stok</span>
    : <span className="inline-flex items-center gap-1 text-red-500"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Stok Yok</span>;
  return (
    <tr className="border-t border-slate-100 align-top hover:bg-slate-50/50">
      {/* yeni tedarikçi ürünü */}
      <td className="p-3">
        <div className="flex gap-2">
          <Img url={p.theirImage} />
          <div className="min-w-0">
            {p.theirUrl ? <a href={p.theirUrl} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-bold text-blue-700 hover:underline">{p.theirName}</a> : <span className="line-clamp-2 font-bold text-slate-700">{p.theirName}</span>}
            <div className="font-mono text-[11px] text-slate-400">{p.theirCode ?? "—"}</div>
          </div>
        </div>
      </td>
      {/* bizim ürün */}
      <td className="p-3">
        <div className="flex gap-2">
          <Img url={p.ourImage} />
          <div className="min-w-0">
            {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-bold text-blue-700 hover:underline">{p.name}</a> : <span className="line-clamp-2 font-bold text-slate-700">{p.name}</span>}
            <div className="font-mono text-[11px] text-slate-400">{p.ourCode ?? "—"}</div>
          </div>
        </div>
      </td>
      {/* stok */}
      <td className="p-3 text-xs font-bold">{stockBadge}<div className="mt-0.5 text-slate-400">{nf(p.ourStock)} adet</div></td>
      {/* yeni tedarikçi fiyat */}
      <td className="p-3 text-right">
        <div className={`font-black tabular-nums ${p.cheaper ? "text-emerald-600" : "text-slate-800"}`}>{tl(p.theirCost)}</div>
        {p.cheaper && <div className="text-[10px] font-black uppercase text-emerald-600">En Ucuz</div>}
      </td>
      {/* en ucuz mevcut tedarikçi */}
      <td className="p-3">
        <div className="font-bold text-slate-700">{p.currentSupplier ?? "—"}</div>
        <div className="tabular-nums text-slate-500">{tl(p.ourCost)}</div>
      </td>
      {/* eşleşme % */}
      <td className="p-3 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-black ${confTone(p.confidence)}`}>%{p.confidence}</span></td>
      {/* fark */}
      <td className={`p-3 text-right font-bold tabular-nums ${p.cheaper ? "text-emerald-600" : "text-red-500"}`}>{p.fark <= 0 ? "" : "+"}{tl(p.fark)}</td>
      {/* avantaj */}
      <td className={`p-3 text-right font-black tabular-nums ${p.cheaper ? "text-emerald-600" : "text-red-500"}`}>%{Math.abs(p.diffPct)}</td>
      {/* karar */}
      <td className="p-3 text-center">
        {!p.cheaper ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-400">kalsın</span>
        ) : flagged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-700">✓ İşaretli<button onClick={() => onUnflag(p.productId)} className="text-blue-400 hover:text-blue-600" title="uyarıyı kaldır">✕</button></span>
        ) : (
          <button onClick={() => onFlag({ productId: p.productId, supplierName, competitorId: activeId, theirCost: p.theirCost, ourCost: p.ourCost, productUrl: p.theirUrl })} disabled={pending} className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50" title="Siparişlerde 'daha ucuz' uyarısı çıkar">Geçiş Yap</button>
        )}
      </td>
    </tr>
  );
}

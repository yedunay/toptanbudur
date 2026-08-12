import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useToast } from "../components/Toast";
import { searchCustomers, type CustomerOption } from "../lib/muhasebe";
import {
  createCompetitor, decideMatch, deleteCompetitor, fetchApproved, fetchCompetitors, fetchMissing,
  fetchOpportunities, fetchOverview, fetchPending, fetchPriceCompare, manualMatch, syncCompetitor,
  type Competitor, type OurSide,
} from "../lib/comparisons";

type Tab = "match" | "approved" | "missing" | "bayi";

const tl = (n: number | string | null | undefined) =>
  n == null ? "—" : `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

const confColor = (c: number) => (c >= 95 ? "text-emerald-600" : c >= 85 ? "text-blue-600" : "text-amber-600");

/** matchedBy → insan-okur eşleşme sebebi rozeti. */
function matchReason(by: string | null): { label: string; cls: string } | null {
  if (by === "ean") return { label: "Barkod Eşleşti", cls: "bg-emerald-100 text-emerald-700" };
  if (by === "name" || by === "prefix") return { label: "İsim Benzerliği", cls: "bg-blue-100 text-blue-700" };
  if (by === "manual") return { label: "Elle Eşleşti", cls: "bg-violet-100 text-violet-700" };
  return null;
}

/* ---- Ürün adı → linke tıklanınca ürün sayfası açılır (yoksa düz metin) ---- */
function NameLink({ name, url }: { name: string; url: string | null | undefined }) {
  if (!url) return <span className="line-clamp-3 font-bold leading-snug text-slate-900">{name}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Ürün sayfasını aç"
      className="line-clamp-3 font-bold leading-snug text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-800 hover:decoration-blue-500">
      {name}
    </a>
  );
}

/* ---- Ürün görseli (kırık/boş URL'de yer tutucu) ---- */
function Thumb({ url, size = "h-20 w-20" }: { url: string | null | undefined; size?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err)
    return (
      <div className={`${size} grid shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-xl text-slate-300`}>
        🖼
      </div>
    );
  return (
    <img
      src={url}
      loading="lazy"
      onError={() => setErr(true)}
      className={`${size} shrink-0 rounded-lg border border-slate-200 bg-white object-contain`}
    />
  );
}

export default function ComparisonsPage() {
  useRequireAuth();
  useDocumentTitle("Karşılaştırmalar");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("match");
  const [view, setView] = useState<"overview" | "detail">("overview");
  const [showManage, setShowManage] = useState(false);
  const [sortPending, setSortPending] = useState<"conf_desc" | "conf_asc">("conf_desc");

  const competitorsQ = useQuery({ queryKey: ["cmp-competitors"], queryFn: fetchCompetitors });
  const competitors = (competitorsQ.data ?? []).filter((c) => c.type === "competitor"); // aday tedarikçiler "Yeni Tedarikçi Analizi" sayfasında
  const openCompetitor = (id: string) => { setSelectedIds([id]); setTab("match"); setView("detail"); };
  const selectedLabel = selectedIds.length === 0
    ? "Tüm rakipler"
    : competitors.filter((c) => selectedIds.includes(c.id)).map((c) => c.name).join(", ");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 flex items-end gap-3">
        <h1 className="text-xl font-black text-[var(--color-text,#0f1e3d)]">Karşılaştırmalar</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Faz 4 · geliştiriliyor</span>
        <button
          onClick={() => setShowManage(true)}
          className="ml-auto rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700"
        >
          ＋ Rakip / Tedarikçi Ekle
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Rakip/tedarikçi XML'leriyle ürün eşleştirme + fiyat karşılaştırma. Barkod ve birebir isim otomatik onaylanır; gerisini elle onaylarsın.
      </p>

      {/* üst gezinme: Genel Bakış · rakip seç (çoklu) · yönet */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setView("overview")}
          className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
            view === "overview" ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          ▦ Genel Bakış
        </button>
        <RakipSelect
          competitors={competitors}
          selectedIds={selectedIds}
          active={view === "detail"}
          onChange={(ids) => { setSelectedIds(ids); setView("detail"); }}
        />
        <button
          onClick={() => setShowManage((v) => !v)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:border-slate-300"
        >
          ⚙ Rakipleri Yönet
        </button>
      </div>

      {showManage && <ManagePanel competitors={competitors} onClose={() => setShowManage(false)} />}

      {view === "overview" && <OverviewView onOpen={openCompetitor} />}

      {view === "detail" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setView("overview")} className="text-sm font-bold text-slate-400 hover:text-slate-600">← Genel Bakış</button>
            <span className="text-xs text-slate-400">Seçili: <b className="text-slate-600">{selectedLabel}</b></span>
          </div>

          {/* sekmeler */}
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            <TabBtn on={tab === "match"} onClick={() => setTab("match")}>Eşleştirme (bekleyen)</TabBtn>
            <TabBtn on={tab === "approved"} onClick={() => setTab("approved")}>Onaylanan</TabBtn>
            <TabBtn on={tab === "missing"} onClick={() => setTab("missing")}>Envanterimizde Olmayan</TabBtn>
            <TabBtn on={tab === "bayi"} onClick={() => setTab("bayi")}>Bayi Fiyat</TabBtn>
          </div>

          {tab === "match" && <MatchTab ids={selectedIds} sort={sortPending} onSort={setSortPending} />}
          {tab === "approved" && <ApprovedTab ids={selectedIds} />}
          {tab === "missing" && <MissingTab ids={selectedIds} />}
          {tab === "bayi" && <BayiTab />}
        </>
      )}
    </div>
  );
}

/* ---- Genel Bakış (önizleme / dashboard) ---- */
function StatCard({ label, value, tone = "text-slate-900" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-black ${tone}`}>{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</div>
      <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function OverviewView({ onOpen }: { onOpen: (id: string, type: "competitor" | "supplier") => void }) {
  const ov = useQuery({ queryKey: ["cmp-overview"], queryFn: fetchOverview });
  const opp = useQuery({ queryKey: ["cmp-opportunities"], queryFn: () => fetchOpportunities(40) });
  const t = ov.data?.totals;
  const rows = (ov.data?.competitors ?? []).filter((c) => c.type === "competitor");

  return (
    <div className="space-y-6">
      {/* stat kartları */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Rakip / Tedarikçi" value={t?.competitors ?? 0} tone="text-blue-600" />
        <StatCard label="Rakip ürünü" value={t?.products ?? 0} />
        <StatCard label="Eşleşen" value={t?.matched ?? 0} tone="text-emerald-600" />
        <StatCard label="Bekleyen onay" value={t?.pending ?? 0} tone="text-amber-600" />
        <StatCard label="Bizde yok" value={t?.missing ?? 0} tone="text-slate-500" />
      </div>

      {/* rakip kartları */}
      <div>
        <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Rakipler</h2>
        {ov.isLoading && <p className="text-sm text-slate-400">yükleniyor…</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpen(c.id, c.type)}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900">{c.name}</span>
                <span className={`rounded px-1.5 text-[11px] font-bold ${c.type === "supplier" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {c.type === "supplier" ? "tedarikçi" : "rakip"}
                </span>
                {c.isDealerPrice && <span className="text-[11px] font-bold text-amber-600">bayi-fiyatı</span>}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1 text-center">
                <MiniStat label="ürün" value={c.products} />
                <MiniStat label="eşleşen" value={c.matched} tone="text-emerald-600" />
                <MiniStat label="bekleyen" value={c.pending} tone="text-amber-600" />
                <MiniStat label="bizde yok" value={c.missing} tone="text-slate-500" />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>son senkron: {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleDateString("tr-TR") : "—"}</span>
                <span className="font-bold text-blue-600 group-hover:underline">İncele →</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ucuz olduğumuz ürünler */}
      <div>
        <div className="mb-2 flex items-end gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Ucuz olduğumuz ürünler</h2>
          {opp.data && <span className="text-xs text-slate-400">liste fiyatımız rakipten düşük — {opp.data.cheaperCount.toLocaleString("tr-TR")} üründe öndeyiz ({opp.data.comparedCount.toLocaleString("tr-TR")} kıyaslandı)</span>}
        </div>
        {opp.isLoading && <p className="text-sm text-slate-400">hesaplanıyor… (tüm eşleşmeler taranıyor)</p>}
        {opp.data && !opp.data.data.length && <p className="text-sm text-slate-400">Liste fiyatıyla rakipten ucuz olduğumuz ürün bulunamadı.</p>}
        <div className="space-y-2">
          {opp.data?.data.map((o) => (
            <div key={o.productId} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <Thumb url={o.imageUrl} size="h-14 w-14" />
              <div className="min-w-[220px] flex-1">
                <NameLink name={o.name} url={o.url} />
                <div className="mt-0.5 text-sm text-slate-500">
                  <span className="font-bold text-emerald-600">bizde {tl(o.ourGross)}</span>
                  {" · "}
                  {o.rivalUrl ? (
                    <a href={o.rivalUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 underline decoration-slate-300 hover:text-slate-700">{o.rivalName} {tl(o.rivalPrice)}</a>
                  ) : (
                    <span>{o.rivalName} {tl(o.rivalPrice)}</span>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-right">
                <div className="text-sm font-black text-emerald-700">%{o.advantagePct} ucuz</div>
                <div className="text-[11px] text-emerald-600">{tl(o.advantage)} fark</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={`text-base font-black ${tone}`}>{value.toLocaleString("tr-TR")}</div>
      <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-bold transition ${on ? "border-b-2 border-blue-600 text-slate-900" : "text-slate-400 hover:text-slate-600"}`}>
      {children}
    </button>
  );
}

/* ---- Fiyat vurgusu (alt satır, büyük, renkli arka plan) ---- */
function PriceChip({ value, tone = "rival" }: { value: string | number | null | undefined; tone?: "rival" | "ours" }) {
  const cls = tone === "ours" ? "bg-blue-100 text-blue-800" : "bg-slate-200/70 text-slate-800";
  return <span className={`inline-block rounded-lg px-2.5 py-1 text-lg font-black tabular-nums ${cls}`}>{tl(value)}</span>;
}

/** Bizim liste fiyatımız rakibe göre yüzde kaç ucuz/pahalı. */
function priceVerdict(ourGross: number | null | undefined, rivalPrice: string | number) {
  const r = Number(rivalPrice);
  if (ourGross == null || !(r > 0)) return null;
  const pct = Math.round((Math.abs(ourGross - r) / r) * 100);
  return { cheaper: ourGross < r, equal: Math.abs(ourGross - r) < 0.01, pct };
}

function VerdictBox({ ourGross, rivalPrice }: { ourGross: number | null | undefined; rivalPrice: string }) {
  const v = priceVerdict(ourGross, rivalPrice);
  if (!v) return <div className="grid place-items-center p-3 text-xs text-slate-300">—</div>;
  if (v.equal) return <div className="grid place-items-center bg-slate-50 p-3 text-center"><span className="text-sm font-black text-slate-500">eşit fiyat</span></div>;
  return (
    <div className={`grid place-items-center p-3 text-center ${v.cheaper ? "bg-emerald-50" : "bg-red-50"}`}>
      <div className={`text-2xl font-black leading-none ${v.cheaper ? "text-emerald-600" : "text-red-600"}`}>%{v.pct}</div>
      <div className={`mt-1 text-xs font-black uppercase ${v.cheaper ? "text-emerald-600" : "text-red-600"}`}>{v.cheaper ? "ucuzuz" : "pahalıyız"}</div>
    </div>
  );
}

/* ---- Ortak eşleşme kartı: sol rakip / güven / sağ bizim / en sağ % fark ---- */
function MatchCard({
  rival, ours, confidence, matchedBy, badge, actions,
}: {
  rival: { name: string; price: string; imageUrl: string | null; url: string | null; code: string; competitor?: string; isDealerPrice?: boolean };
  ours: OurSide | null;
  confidence: number;
  matchedBy: string | null;
  badge?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const reason = matchReason(matchedBy);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_78px_1fr_132px]">
        {/* rakip */}
        <div className="flex gap-3 p-4">
          <Thumb url={rival.imageUrl} />
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">◀ Rakip ürün</div>
            <NameLink name={rival.name} url={rival.url} />
            <div className="mt-1.5"><PriceChip value={rival.price} tone="rival" /></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {rival.competitor && <span className="rounded bg-slate-800/90 px-2 py-0.5 text-[11px] font-bold text-white">{rival.competitor}</span>}
              {rival.isDealerPrice && <span className="text-[10px] font-bold text-amber-600">bayi-fiyatı</span>}
              <span className="font-mono text-[11px] text-slate-400">{rival.code}</span>
            </div>
          </div>
        </div>
        {/* güven + eşleşme sebebi */}
        <div className="flex flex-row items-center justify-center gap-2 border-y border-dashed border-slate-200 bg-slate-50 py-2 md:flex-col md:gap-1 md:border-x md:border-y-0">
          <div className={`text-lg font-black ${confColor(confidence)}`}>%{confidence}</div>
          {reason && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${reason.cls}`}>{reason.label}</span>}
          {badge}
        </div>
        {/* bizim */}
        <div className="flex flex-col gap-2 bg-slate-50/60 p-4">
          <div className="flex gap-3">
            <Thumb url={ours?.imageUrl} />
            <div className="min-w-0">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Bizim ürün ▶</div>
              {ours ? <NameLink name={ours.name} url={ours.url} /> : <span className="font-bold text-slate-400">—</span>}
              <div className="mt-1.5"><PriceChip value={ours?.listGross ?? null} tone="ours" /></div>
              <div className="mt-1 text-[11px] text-slate-400">{ours?.supplier ?? "—"}</div>
            </div>
          </div>
          <div className="flex gap-2">{actions}</div>
        </div>
        {/* % fark */}
        <div className="border-t border-slate-200 md:border-l md:border-t-0">
          <VerdictBox ourGross={ours?.listGross} rivalPrice={rival.price} />
        </div>
      </div>
    </div>
  );
}

/* ---- Eşleştirme (bekleyen) ---- */
function MatchTab({ ids, sort, onSort }: { ids: string[]; sort: "conf_desc" | "conf_asc"; onSort: (s: "conf_desc" | "conf_asc") => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["cmp-pending", ids, sort], queryFn: () => fetchPending(ids, 50, 0, sort) });
  const decide = useMutation({
    mutationFn: ({ id, s }: { id: string; s: "approved" | "rejected" }) => decideMatch(id, s),
    onSuccess: (_r, v) => {
      toast.push("success", v.s === "approved" ? "Onaylandı" : "Reddedildi");
      qc.invalidateQueries({ queryKey: ["cmp-pending"] });
      qc.invalidateQueries({ queryKey: ["cmp-approved"] });
    },
    onError: () => toast.push("error", "İşlem başarısız"),
  });
  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  if (q.isLoading) return <p className="text-sm text-slate-400">yükleniyor…</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">Bekleyen eşleşme yok.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-600">Eşleştirme bekleyen <span className="text-amber-600">{total.toLocaleString("tr-TR")}</span> ürün — sol rakip / sağ bizim ürün, en sağda % fark.</p>
        <select value={sort} onChange={(e) => onSort(e.target.value as "conf_desc" | "conf_asc")}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold">
          <option value="conf_desc">Güven Skoru (Yüksek)</option>
          <option value="conf_asc">Güven Skoru (Düşük)</option>
        </select>
      </div>
      {rows.map((m) => (
        <MatchCard
          key={m.matchId}
          rival={m.rival}
          ours={m.ours}
          confidence={m.confidence}
          matchedBy={m.matchedBy}
          actions={
            <>
              <button onClick={() => decide.mutate({ id: m.matchId, s: "approved" })} disabled={decide.isPending}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">✓ Onayla</button>
              <button onClick={() => decide.mutate({ id: m.matchId, s: "rejected" })} disabled={decide.isPending}
                className="flex-1 rounded-lg border border-red-500 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">✗ Reddet</button>
            </>
          }
        />
      ))}
    </div>
  );
}

/* ---- Onaylanan (oto + elle onaylı) — geri dönüp kontrol + geri al ---- */
function ApprovedTab({ ids }: { ids: string[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [take, setTake] = useState(60);
  const q = useQuery({ queryKey: ["cmp-approved", ids, take], queryFn: () => fetchApproved(ids, take) });
  const decide = useMutation({
    mutationFn: (id: string) => decideMatch(id, "rejected"),
    onSuccess: () => {
      toast.push("success", "Eşleşme kaldırıldı (Envanterimizde Olmayan'a düştü)");
      qc.invalidateQueries({ queryKey: ["cmp-approved"] });
      qc.invalidateQueries({ queryKey: ["cmp-missing"] });
    },
    onError: () => toast.push("error", "İşlem başarısız"),
  });
  if (q.isLoading) return <p className="text-sm text-slate-400">yükleniyor…</p>;
  const d = q.data;
  const rows = d?.data ?? [];
  if (!rows.length) return <p className="text-sm text-slate-400">Onaylı/otomatik eşleşme yok.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Toplam <b>{d?.total?.toLocaleString("tr-TR")}</b> eşleşme (elle onaylı + otomatik). Yanlış varsa <b>Kaldır</b> ile geri al.
      </p>
      {rows.map((m) => (
        <MatchCard
          key={m.matchId}
          rival={m.rival}
          ours={m.ours}
          confidence={m.confidence}
          matchedBy={m.matchedBy}
          badge={
            <span className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${m.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
              {m.status === "approved" ? "elle onaylı" : "otomatik"}
            </span>
          }
          actions={
            <button onClick={() => decide.mutate(m.matchId)} disabled={decide.isPending}
              className="flex-1 rounded-lg border border-red-400 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">✗ Kaldır (yanlış eşleşme)</button>
          }
        />
      ))}
      {d && rows.length < d.total && (
        <button onClick={() => setTake((t) => t + 60)}
          className="mx-auto block rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold hover:border-slate-300">
          Daha fazla göster ({rows.length} / {d.total.toLocaleString("tr-TR")})
        </button>
      )}
    </div>
  );
}

/* ---- Envanterimizde Olmayan ---- */
function MissingTab({ ids }: { ids: string[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["cmp-missing", ids], queryFn: () => fetchMissing(ids) });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const mm = useMutation({
    mutationFn: ({ cpId, code }: { cpId: string; code: string }) => manualMatch(cpId, code),
    onSuccess: (r) => {
      toast.push("success", `Eşleşti: ${r.matched.name}`);
      qc.invalidateQueries({ queryKey: ["cmp-missing"] });
      qc.invalidateQueries({ queryKey: ["cmp-approved"] });
    },
    onError: () => toast.push("error", "Bu kod/barkodla ürün bulunamadı"),
  });
  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  if (q.isLoading) return <p className="text-sm text-slate-400">yükleniyor…</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">Bizde olmayan ürün yok.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-slate-600">Bizde eşi bulunamayan <span className="text-slate-800">{total.toLocaleString("tr-TR")}</span> rakip ürün. Aslında varsa <b>stok kodu / barkod</b> girip elle eşleştir.</p>
      {rows.map((it) => (
        <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <Thumb url={it.imageUrl} size="h-14 w-14" />
          <div className="min-w-[200px] flex-1">
            <NameLink name={it.name} url={it.productUrl} />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PriceChip value={it.price} tone="rival" />
              {it.competitor && <span className="rounded bg-slate-800/90 px-2 py-0.5 text-[11px] font-bold text-white">{it.competitor}</span>}
              <span className="font-mono text-[11px] text-slate-400">{it.externalCode}{it.barcode ? ` · ${it.barcode}` : ""}</span>
            </div>
          </div>
          <input placeholder="stok kodu / barkod" value={codes[it.id] ?? ""}
            onChange={(e) => setCodes((c) => ({ ...c, [it.id]: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-sm" />
          <button onClick={() => mm.mutate({ cpId: it.id, code: codes[it.id] ?? "" })} disabled={!codes[it.id] || mm.isPending}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">Elle eşleştir</button>
        </div>
      ))}
    </div>
  );
}

/* ---- Bayi arama seçici ---- */
function DealerPicker({ onSelect }: { onSelect: (c: CustomerOption | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CustomerOption | null>(null);
  const sq = useQuery({
    queryKey: ["cmp-dealer-search", q],
    queryFn: () => searchCustomers(q),
    enabled: open && q.trim().length >= 1,
  });
  const results = sq.data ?? [];
  return (
    <div className="relative w-96 max-w-full">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (picked) { setPicked(null); onSelect(null); } }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Bayi ara — isim, firma, e-posta veya bayi no…"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      {open && q.trim().length >= 1 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {sq.isLoading && <div className="px-3 py-2 text-sm text-slate-400">aranıyor…</div>}
          {!sq.isLoading && !results.length && <div className="px-3 py-2 text-sm text-slate-400">sonuç yok</div>}
          {results.map((c) => (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setPicked(c); setQ(c.name); setOpen(false); onSelect(c); }}
              className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-blue-50 last:border-0"
            >
              <span>
                <span className="font-bold">{c.name}</span>
                {c.companyTitle ? <span className="text-slate-400"> · {c.companyTitle}</span> : ""}
                <span className="block text-xs text-slate-400">{c.email}</span>
              </span>
              {c.bayiNo && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">#{c.bayiNo}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Bayi Fiyat ---- */
function BayiTab() {
  const [dealer, setDealer] = useState<CustomerOption | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);
  const customerId = dealer?.id ?? "";
  const q = useQuery({
    queryKey: ["cmp-bayi", customerId, search],
    queryFn: () => fetchPriceCompare(customerId, search), // TÜM rakipler + bizim ürün adına göre filtre
    enabled: customerId.length > 0,
  });
  const sug = q.data?.suggestion;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold">Bayi seç:</span>
        <DealerPicker onSelect={setDealer} />
        {q.data && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{q.data.discount}</span>}
      </div>
      {customerId && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">Ürün ara:</span>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="bizim ürün adı ile filtrele…"
            className="w-96 max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          {searchInput && <button onClick={() => setSearchInput("")} className="text-xs font-bold text-slate-400 hover:text-slate-600">temizle ✕</button>}
        </div>
      )}
      {!customerId && <p className="text-sm text-slate-400">Yukarıdan bir bayi arayıp seç — o bayinin gördüğü indirimli fiyat TÜM rakiplerle kıyaslanır.</p>}
      {q.isLoading && <p className="text-sm text-slate-400">yükleniyor…</p>}
      {q.data && (
        <div className="space-y-2">
          {sug?.lower && (
            <div className="flex items-start gap-3 rounded-2xl border border-blue-200/70 bg-blue-500/10 p-4">
              <span className="text-2xl leading-none">💡</span>
              <div className="text-sm leading-relaxed text-slate-700">
                <b className="text-blue-700">Kâr önerisi.</b> Bu bayide çoğu üründe rakiplerden bariz öndesin.{" "}
                Global {sug.mode === "profit" ? "kâr indirimini" : "iskontonu"}{" "}
                <b className="rounded bg-blue-100 px-1 text-blue-800">%{sug.currentPct} → %{sug.lower.suggestedPct}</b>{" "}
                çekersen ürünlerin ~<b>%{sug.lower.keepCheaperPct}</b>'inde hâlâ <b>en ucuz</b> kalırsın, ortalama fiyatın ~<b className="text-emerald-700">%{sug.lower.gainPct}</b> artar (daha çok kâr).
                <span className="mt-0.5 block text-xs text-slate-400">{sug.pool.toLocaleString("tr-TR")} global-iskontolu ürün üzerinden hesaplandı · öneridir.</span>
              </div>
            </div>
          )}
          {sug?.raise && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-400/10 p-4">
              <span className="text-2xl leading-none">🎯</span>
              <div className="text-sm leading-relaxed text-slate-700">
                <b className="text-amber-700">Rekabet önerisi.</b> Şu an ürünlerin ~<b>%{100 - sug.cheaperPct}</b>'inde rakip daha ucuz.{" "}
                Global {sug.mode === "profit" ? "kâr indirimini" : "iskontonu"}{" "}
                <b className="rounded bg-amber-100 px-1 text-amber-800">%{sug.currentPct} → %{sug.raise.suggestedPct}</b>{" "}
                çıkarırsan ürünlerin ~<b>%{sug.raise.reachCheaperPct}</b>'inde <b>en ucuz</b> olursun (maliyetin altına inmeden); ortalama fiyatın ~<b className="text-red-600">%{sug.raise.marginDropPct}</b> düşer.{" "}
                {sug.raise.coversAll
                  ? "Neredeyse tüm üründe öne geçersin."
                  : `Kalan ~${sug.raise.unwinnable.toLocaleString("tr-TR")} üründe rakip senin maliyetinin altında satıyor — orada kârlı inemezsin.`}
                <span className="mt-0.5 block text-xs text-slate-400">{sug.pool.toLocaleString("tr-TR")} global-iskontolu ürün üzerinden hesaplandı · öneridir.</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700">✔ {q.data.summary.cheaper.toLocaleString("tr-TR")} üründe daha ucuzuz</span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-black text-red-600">✖ {q.data.summary.expensive.toLocaleString("tr-TR")} üründe daha pahalıyız</span>
          </div>

          <p className="text-sm font-bold text-slate-600">
            {q.data.total.toLocaleString("tr-TR")} eşleşen ürün{search ? ` — "${search}" filtresi` : ""} — her ürünün TÜM rakiplerdeki fiyatı + % fark
            {q.data.total > q.data.data.length ? ` (en çok rakipli ilk ${q.data.data.length} gösteriliyor)` : ""}.
          </p>
          {q.data.data.slice(0, 200).map((r) => (
            <div key={r.productId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Thumb url={r.imageUrl} size="h-14 w-14" />
                <div className="min-w-[200px] flex-1">
                  <NameLink name={r.name} url={r.url} />
                  <div className="text-[11px] text-slate-400">{r.supplier ?? ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase text-slate-400">bizden (bu bayi)</div>
                  <PriceChip value={r.ourGross} tone="ours" />
                </div>
                {r.weCheapest
                  ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-700">✔ en ucuz biziz</span>
                  : <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-600">rakip daha ucuz</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                {r.rivals.map((v, i) => {
                  const pv = priceVerdict(r.ourGross, v.price);
                  return (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs">
                      {v.url
                        ? <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-bold text-slate-600 underline decoration-slate-300 hover:text-slate-800">{v.competitor}</a>
                        : <span className="font-bold text-slate-600">{v.competitor}</span>}
                      <span className="tabular-nums text-slate-500">{tl(v.price)}</span>
                      {pv && !pv.equal && <span className={`font-black ${pv.cheaper ? "text-emerald-600" : "text-red-500"}`}>{pv.cheaper ? "▼" : "▲"}%{pv.pct}</span>}
                      {v.isDealerPrice && <span className="text-[10px] font-bold text-amber-500">bayi</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---- Çoklu-seçim rakip dropdown ---- */
function RakipSelect({ competitors, selectedIds, active, onChange }: {
  competitors: Competitor[];
  selectedIds: string[];
  active: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const label = selectedIds.length === 0
    ? "Bir veya daha fazla rakip seçin…"
    : competitors.filter((c) => selectedIds.includes(c.id)).map((c) => c.name).join(", ");
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  const shown = competitors.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative min-w-[280px]">
      <button onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition ${active && selectedIds.length ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-slate-300"}`}>
        <span className={`truncate font-bold ${selectedIds.length ? "text-slate-800" : "text-slate-400"}`}>{label}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rakip ara…"
            className="mb-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
          <div className="max-h-72 overflow-auto">
            {shown.length === 0 && <div className="px-2 py-2 text-sm text-slate-400">sonuç yok</div>}
            {shown.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggle(c.id)} />
                <span className="font-bold">{c.name}</span>
                <span className={`rounded px-1.5 text-[11px] font-bold ${c.type === "supplier" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.type === "supplier" ? "tedarikçi" : "rakip"}</span>
                {c.isDealerPrice && <span className="text-[11px] font-bold text-amber-600">bayi-fiyatı</span>}
              </label>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <button onClick={() => onChange([])} className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50">Seçimi temizle (tüm rakipler)</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Rakipleri Yönet (ekle / senkronize / sil) ---- */
function ManagePanel({ competitors, onClose }: { competitors: Competitor[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const syncM = useMutation({
    mutationFn: (id: string) => syncCompetitor(id),
    onSuccess: (r) => {
      toast.push("success", `Senkron: ${r.ingest.upserted} ürün · oto ${r.match.auto} · bekleyen ${r.match.pending}`);
      qc.invalidateQueries({ queryKey: ["cmp-competitors"] });
      qc.invalidateQueries({ queryKey: ["cmp-overview"] });
    },
    onError: () => toast.push("error", "Senkron başarısız"),
  });
  const del = (c: Competitor) => {
    if (!confirm(`"${c.name}" ve tüm ürün/eşleşmeleri silinsin mi?`)) return;
    deleteCompetitor(c.id).then(() => qc.invalidateQueries({ queryKey: ["cmp-competitors"] }));
  };
  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-black text-slate-800">Rakipleri Yönet</h3>
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700">＋ Yeni</button>
        <button onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-600">Kapat ✕</button>
      </div>
      {showAdd && <AddCompetitor onDone={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ["cmp-competitors"] }); }} />}
      <div className="divide-y divide-slate-100">
        {competitors.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="font-bold text-slate-800">{c.name}</span>
            <span className={`rounded px-1.5 text-[11px] font-bold ${c.type === "supplier" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.type === "supplier" ? "tedarikçi" : "rakip"}</span>
            <span className="text-xs text-slate-400">son senkron: {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString("tr-TR") : "—"}</span>
            <button onClick={() => syncM.mutate(c.id)} disabled={syncM.isPending} className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold hover:border-slate-300 disabled:opacity-50">⟳ Senkronize</button>
            <button onClick={() => del(c)} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-50">🗑 Sil</button>
          </div>
        ))}
        {competitors.length === 0 && <p className="py-2 text-sm text-slate-400">Henüz rakip yok — "＋ Yeni" ile ekle.</p>}
      </div>
    </div>
  );
}

/* ---- Rakip/Tedarikçi Ekle ---- */
function AddCompetitor({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"competitor" | "supplier">("competitor");
  const [feedUrl, setFeedUrl] = useState("");
  const [kdv, setKdv] = useState(true);
  const [dealer, setDealer] = useState(false);
  const [cleanup, setCleanup] = useState("");
  const m = useMutation({
    mutationFn: () =>
      createCompetitor({
        name, type, feedUrl: feedUrl || undefined, priceKdvIncluded: kdv, isDealerPrice: dealer,
        cleanupWords: cleanup.split(",").map((s) => s.trim()).filter(Boolean),
      } as any),
    onSuccess: () => { toast.push("success", "Eklendi"); onDone(); },
    onError: () => toast.push("error", "Eklenemedi"),
  });
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Ad<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
        <label className="text-sm">XML URL<input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" /></label>
        <label className="text-sm">Tür
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5">
            <option value="competitor">Rakip (satış kıyası)</option>
            <option value="supplier">Tedarikçi (maliyet kıyası)</option>
          </select>
        </label>
        <label className="text-sm">Önek/kelime temizleme (virgülle)
          <input value={cleanup} onChange={(e) => setCleanup(e.target.value)} placeholder="Mey İthalat®, ®" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={kdv} onChange={(e) => setKdv(e.target.checked)} /> Fiyatlar KDV dahil</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dealer} onChange={(e) => setDealer(e.target.checked)} /> Bayi (toptan) fiyatı feed'i</label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => m.mutate()} disabled={!name || m.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Ekle</button>
        <button onClick={onDone} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-500">Vazgeç</button>
      </div>
    </div>
  );
}

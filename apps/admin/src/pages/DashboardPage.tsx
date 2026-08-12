import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  RefreshCw,
  Wallet,
  ShoppingCart,
  Users,
  Clock,
  Package,
  Tag,
  UserPlus,
  Activity,
} from "lucide-react";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { fetchDashboardOverview, type DashboardOverview } from "../lib/dashboard";
import { formatTRY } from "../lib/products";
import HeroMetric from "../components/dashboard/HeroMetric";
import KpiCard from "../components/dashboard/KpiCard";
import TrendChart from "../components/dashboard/TrendChart";
import AlertList from "../components/dashboard/AlertList";
import TopList from "../components/dashboard/TopList";
import FeedHealth from "../components/dashboard/FeedHealth";
import SupplierBalanceStrip from "../components/SupplierBalanceStrip";
import { canAccess } from "../lib/permissions";

const REFRESH_MS = 60_000;

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function DashboardPage(): ReactElement {
  useDocumentTitle();
  useRequireAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [metric, setMetric] = useState<"orders" | "revenue">("revenue");

  useEffect(() => {
    let cancelled = false;
    async function load(silent: boolean): Promise<void> {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const overview = await fetchDashboardOverview();
        if (!cancelled) {
          setData(overview);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Veri alınamadı");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load(false);
    const id = setInterval(() => void load(true), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const ordersSpark = useMemo(
    () => (data ? data.trend30d.slice(-14).map((d) => d.orders) : []),
    [data],
  );
  const revenueSpark = useMemo(
    () => (data ? data.trend30d.slice(-14).map((d) => d.revenue) : []),
    [data],
  );

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
        Panel yükleniyor…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!data) return <div />;

  return (
    <div className="space-y-4 text-slate-900 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 sm:text-sm">
            <span>Gerçek zamanlı operasyonel görünüm</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              son güncelleme{" "}
              <span className="font-medium text-slate-900">
                {formatGeneratedAt(data.generatedAt)}
              </span>
            </span>
            {refreshing ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                yenileniyor
              </span>
            ) : null}
          </p>
        </div>
      </header>

      {/* === TEDARİKÇİ BAKİYE ŞERİDİ ===
          Şeridin ucu 'suppliers' iznine bağlı; izinsiz çalışanda şeridi hiç
          mount etmiyoruz ki 60 sn'de bir 403 denemesi olmasın. */}
      {canAccess("suppliers") ? <SupplierBalanceStrip /> : null}

      {/* === KAHRAMAN METRİKLERİ === */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <HeroMetric
          label="Bugünkü ciro"
          value={formatTRY(data.today.revenue)}
          delta={data.today.deltaRevenuePct}
          sparkValues={revenueSpark}
          hint={`Sepet ort. ${formatTRY(data.today.avgBasket)}`}
          accent="emerald"
          icon={<Wallet size={18} aria-hidden="true" />}
        />
        <HeroMetric
          label="Bugünkü sipariş"
          value={data.today.orders.toLocaleString("tr-TR")}
          delta={data.today.deltaOrdersPct}
          sparkValues={ordersSpark}
          hint={
            data.today.refundRate > 0
              ? `İade oranı %${(data.today.refundRate * 100).toFixed(1)}`
              : "İade yok"
          }
          accent="blue"
          icon={<ShoppingCart size={18} aria-hidden="true" />}
        />
        <HeroMetric
          label="Toplam bayi"
          value={(data.dealers.totalDealers ?? data.dealers.activeDealers).toLocaleString("tr-TR")}
          delta={null}
          sparkValues={[]}
          hint={`${data.dealers.activeDealers.toLocaleString("tr-TR")} aktif · ${data.dealers.pendingApplications.toLocaleString("tr-TR")} başvuru bekliyor`}
          accent="violet"
          icon={<Users size={18} aria-hidden="true" />}
        />
        <HeroMetric
          label="Bekleyen sipariş"
          value={data.alerts.pendingOrders.toLocaleString("tr-TR")}
          delta={null}
          sparkValues={[]}
          hint={
            data.alerts.pendingOrders > 0
              ? "Ödendi · hazırlanmayı bekliyor"
              : "İşlenecek sipariş yok"
          }
          accent="amber"
          icon={<Clock size={18} aria-hidden="true" />}
        />
      </section>

      {/* === BENTO ANA İZGARA === */}
      <section className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {/* Trend grafiği — büyük blok */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2 sm:mb-4 sm:flex-nowrap sm:items-center sm:gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                30 günlük eğilim
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {metric === "revenue" ? "Günlük ciro (TL)" : "Günlük sipariş adedi"}
              </p>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMetric("revenue")}
                className={`rounded-md px-3 py-1 font-medium transition ${metric === "revenue" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Ciro
              </button>
              <button
                type="button"
                onClick={() => setMetric("orders")}
                className={`rounded-md px-3 py-1 font-medium transition ${metric === "orders" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Sipariş
              </button>
            </div>
          </div>
          <TrendChart data={data.trend30d} metric={metric} />
        </div>

        {/* Operasyonel uyarılar — sağ blok */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="mb-3 sm:mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
              Operasyonel uyarılar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Tıkla, ilgili sayfaya filtreli git
            </p>
          </div>
          <AlertList alerts={data.alerts} />
        </div>
      </section>

      {/* === KATALOG + BAYİ KPI'LARI === */}
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiCard
          label="Aktif ürün"
          value={data.catalog.activeProducts.toLocaleString("tr-TR")}
          sub={`${data.catalog.totalProducts.toLocaleString("tr-TR")} toplam katalog`}
          to="/products"
          tone="neutral"
          icon={<Package size={18} aria-hidden="true" />}
        />
        <KpiCard
          label="Kategori"
          value={data.catalog.categories.toLocaleString("tr-TR")}
          to="/categories"
          tone="neutral"
          icon={<Tag size={18} aria-hidden="true" />}
        />
        <KpiCard
          label="Bayi başvurusu"
          value={data.dealers.pendingApplications.toLocaleString("tr-TR")}
          sub={data.dealers.pendingApplications > 0 ? "İnceleme bekliyor" : "Tümü işlendi"}
          to="/mesajlar?source=APPLICATION"
          tone={data.dealers.pendingApplications > 0 ? "warn" : "good"}
          icon={<UserPlus size={18} aria-hidden="true" />}
        />
        <KpiCard
          label="Son senkron"
          value={
            data.catalog.lastSyncedAt
              ? new Date(data.catalog.lastSyncedAt).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
          sub={
            data.catalog.lastSyncError
              ? `Hata: ${data.catalog.lastSyncError.slice(0, 40)}`
              : "Sağlıklı"
          }
          to="/suppliers"
          tone={data.catalog.lastSyncError ? "danger" : "good"}
          icon={<Activity size={18} aria-hidden="true" />}
        />
      </section>

      {/* === TOP LİSTELER === */}
      <section className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <TopList
          title="Çok satan ürün"
          subtitle="Son 7 gün"
          emptyMessage="Bu hafta henüz satış yok"
          items={data.top.products7d.map((p) => ({
            id: p.id,
            primary: p.name,
            secondary: `${p.qty.toLocaleString("tr-TR")} adet`,
            trailing: formatTRY(p.revenue),
            to: `/products?q=${encodeURIComponent(p.name)}`,
          }))}
        />
        <TopList
          title="Çok alan bayi"
          subtitle="Son 30 gün"
          emptyMessage="Bu ay henüz sipariş yok"
          items={data.top.dealers30d.map((d) => ({
            id: d.id,
            primary: d.name,
            secondary: `${d.orders.toLocaleString("tr-TR")} sipariş`,
            trailing: formatTRY(d.revenue),
            to: d.id ? `/customers/${d.id}` : undefined,
          }))}
        />
        <TopList
          title="Lider kategori"
          subtitle="Son 30 gün · ciroya göre"
          emptyMessage="Bu ay henüz satış yok"
          items={data.top.categories30d.map((c) => ({
            id: c.id,
            primary: c.name,
            trailing: formatTRY(c.revenue),
          }))}
        />
      </section>

      {/* === FEED SAĞLIK === */}
      <section>
        <FeedHealth feeds={data.systemHealth.feeds} />
      </section>
    </div>
  );
}

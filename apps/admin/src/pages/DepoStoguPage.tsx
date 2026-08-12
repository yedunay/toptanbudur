import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Warehouse,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  PauseCircle,
  PlayCircle,
  Trash2,
  Send,
  ArrowRightLeft,
  Undo2,
  Plus,
  AlertTriangle,
  Search,
  X,
} from "lucide-react";
import { useDebounce } from "../lib/useDebounce";
import { fetchProducts, type Product } from "../lib/products";
import { useRequireAuth } from "../lib/auth";
import { fetchMe } from "../lib/account";
import { useToast } from "../components/Toast";
import { formatAmount } from "../lib/format";
import { formatDateTime, CARGO_COMPANY_LABELS, type CargoCompany } from "../lib/orders";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  dispatchOrderFromDepot,
  deleteItem,
  fetchItems,
  fetchOrdersByTab,
  fetchOwners,
  fetchSalesSummary,
  fetchSettings,
  markOrderShipped,
  revertOrderToSupplier,
  transferOrderToSupplier,
  updateSettings,
  upsertItem,
  type HouseStockOrderRow,
  type HouseStockOrdersTab,
  type HouseStockOwner,
} from "../lib/house-stock";

/**
 * Depo Stoğu — yalnızca OWNER kullanıcıların eriştiği sayfa.
 *
 * Üst sekmeler her bir OWNER'ın deposunu temsil eder + bir adet "Toplam" sekmesi.
 * Her depo için 4 alt sekme: Ürünlerim, Bekleyen, Kargoya Verilecek,
 * Kargoya Verildi. ("Tamamlandı" kaldırıldı — "Kargoya Verildi" nihai aşamadır.)
 *
 * Siparişler ORDER-GROUPED gösterilir: bir siparişin tüm Depo kalemleri tek
 * satırda toplanır (whole-order kuralı: hepsi tek OWNER deposuna aittir).
 *
 * Müşteri ya da tedarikçi yüzlü hiçbir bilgi burada gösterilmez (cari, kâr,
 * tedarikçi adı, maliyet bedeli, müşteri adı/şehir vs.). Tatil modu
 * ileri-yönlü: zaten rezerve edilmiş siparişler etkilenmez.
 */

type SubTab = "items" | HouseStockOrdersTab;

interface SubTabDef {
  key: SubTab;
  label: string;
  icon: typeof Package;
}

const SUB_TABS: ReadonlyArray<SubTabDef> = [
  { key: "items", label: "Ürünlerim", icon: Package },
  { key: "bekleyen", label: "Bekleyen", icon: Clock },
  { key: "kargoVerilecek", label: "Kargoya Verilecek", icon: Truck },
  { key: "kargoVerildi", label: "Kargoya Verildi", icon: Send },
];

function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return formatAmount(n);
}

function ownerLabel(owner: HouseStockOwner): string {
  return owner.name?.trim() || owner.email;
}

/** Kargo firması kodunu okunabilir etikete çevirir ("ARAS" → "Aras Kargo"). */
function cargoLabel(company: string | null | undefined): string | null {
  if (!company) return null;
  const key = company.trim().toUpperCase();
  return CARGO_COMPANY_LABELS[key as CargoCompany] ?? company;
}

/** Kargo firmasına göre renkli çip sınıfları (logo varlığı olmadığı için). */
function cargoChipClasses(company: string | null | undefined): string {
  const key = (company ?? "").trim().toUpperCase();
  if (key === "ARAS") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (key === "SURAT") return "bg-orange-50 text-orange-700 ring-orange-200";
  if (key === "YURTICI") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

/**
 * Sayfanın en başındaki kısa kullanım notu. Adminler Depo Stoğunu yeni
 * kullandığından her detayı (4 sekme + 03:00 oto-devir kuralı) öz ama eksiksiz
 * anlatır.
 */
function UsageNote(): React.ReactElement {
  return (
    <section
      aria-labelledby="depo-usage-heading"
      className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
          <AlertTriangle size={16} aria-hidden="true" />
        </span>
        <div className="space-y-2 text-[13px] leading-relaxed text-slate-700">
          <h2
            id="depo-usage-heading"
            className="text-sm font-semibold text-slate-900"
          >
            Depo Stoğu nasıl çalışır?
          </h2>
          <p>
            Bir müşteri siparişinin <strong>tüm ürünleri tek bir owner'ın</strong>{" "}
            ev/depo stokundan karşılanabiliyorsa sipariş otomatik buraya düşer;
            aksi halde doğrudan tedarikçiden temin edilir. Yalnızca{" "}
            <strong>kendi deponda</strong> işlem yapabilirsin (diğer owner'ların
            depolarını görebilir ama düzenleyemezsin).
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-slate-900">Bekleyen:</strong> Siparişi ya{" "}
              <strong>“Depodan Gönder”</strong> (kendi stokundan
              göndereceksin — raf stoğu düşer; gerekirse Kargoya Verilecek
              sekmesinden geri alabilirsin) ya da{" "}
              <strong>“Tedarikçiye Devret”</strong> (gönderemeyeceksin — bot
              tedarikten alır) ile işaretle.
            </li>
            <li>
              <strong className="text-slate-900">Kargoya Verilecek:</strong>{" "}
              Depodan gönderdiğin siparişi kargoya teslim edince{" "}
              <strong>“Kargoya Verdim”</strong> de. Veremiyorsan{" "}
              <strong>“Tedarikçiye Devret”</strong> ile geri bırak (düşülen stok
              iade edilir, bot tedarikten alır).
            </li>
            <li>
              <strong className="text-slate-900">Kargoya Verildi:</strong>{" "}
              Tamamlanan sevkiyatların geçmişidir (nihai aşama).
            </li>
          </ul>
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-800 ring-1 ring-amber-200">
            <Clock size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              <strong>Önemli:</strong> Bekleyen'de bıraktığın ve gece{" "}
              <strong>03.00</strong>'e kadar hiçbir işlem yapmadığın siparişler{" "}
              <strong>otomatik olarak tedarikçiye devredilir</strong> — bot ürünü
              tedarikten temin eder. (Depodan gönderdiklerin etkilenmez.)
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

export default function DepoStoguPage(): React.ReactElement | null {
  useDocumentTitle("Depo Stoğu");
  const authed = useRequireAuth();

  const meQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    enabled: authed,
    staleTime: 60_000,
  });

  const ownersQuery = useQuery({
    queryKey: ["house-stock", "owners"],
    queryFn: fetchOwners,
    enabled: authed,
    staleTime: 60_000,
  });

  type TopTab = { kind: "owner"; ownerId: string } | { kind: "total" };

  const [topTab, setTopTab] = useState<TopTab | null>(null);

  useEffect(() => {
    if (topTab) return;
    const owners = ownersQuery.data;
    if (!owners || owners.length === 0) return;
    const me = meQuery.data;
    const mine = me ? owners.find((o) => o.id === me.id) : null;
    setTopTab({ kind: "owner", ownerId: (mine ?? owners[0]).id });
  }, [topTab, ownersQuery.data, meQuery.data]);

  if (!authed) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <Warehouse size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Depo Stoğu
            </h1>
            <p className="text-sm text-slate-500">
              Owner depoları, rezervasyonlar ve sevkiyat yönetimi.
            </p>
          </div>
        </div>
      </header>

      <UsageNote />

      {ownersQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Yükleniyor…
        </div>
      ) : ownersQuery.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Owner listesi alınamadı.
        </div>
      ) : !ownersQuery.data || ownersQuery.data.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Henüz tanımlı OWNER yok.
        </div>
      ) : (
        <>
          <TopTabs
            owners={ownersQuery.data}
            value={topTab}
            onChange={setTopTab}
          />
          {topTab?.kind === "owner" ? (
            <OwnerDepoView
              ownerId={topTab.ownerId}
              owners={ownersQuery.data}
              currentUserId={meQuery.data?.id ?? null}
            />
          ) : topTab?.kind === "total" ? (
            <TotalView owners={ownersQuery.data} />
          ) : null}
        </>
      )}
    </div>
  );
}

// ───────────────────── Top Tabs ─────────────────────

interface TopTabsProps {
  owners: ReadonlyArray<HouseStockOwner>;
  value:
    | { kind: "owner"; ownerId: string }
    | { kind: "total" }
    | null;
  onChange: (
    next: { kind: "owner"; ownerId: string } | { kind: "total" },
  ) => void;
}

function TopTabs({ owners, value, onChange }: TopTabsProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
      {owners.map((owner) => {
        const active =
          value?.kind === "owner" && value.ownerId === owner.id;
        return (
          <button
            key={owner.id}
            type="button"
            onClick={() => onChange({ kind: "owner", ownerId: owner.id })}
            className={`-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-emerald-500 bg-white text-slate-900"
                : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
            aria-pressed={active}
          >
            <Warehouse size={14} aria-hidden="true" />
            <span>Depo Stoğu — {ownerLabel(owner)}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange({ kind: "total" })}
        className={`-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
          value?.kind === "total"
            ? "border-emerald-500 bg-white text-slate-900"
            : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        }`}
        aria-pressed={value?.kind === "total"}
      >
        <span>Toplam</span>
      </button>
    </div>
  );
}

// ───────────────────── Owner Depo View ─────────────────────

interface OwnerDepoViewProps {
  ownerId: string;
  owners: ReadonlyArray<HouseStockOwner>;
  currentUserId: string | null;
}

function OwnerDepoView({
  ownerId,
  owners,
  currentUserId,
}: OwnerDepoViewProps): React.ReactElement {
  const [subTab, setSubTab] = useState<SubTab>("items");
  const owner = owners.find((o) => o.id === ownerId) ?? null;
  const isMine = currentUserId !== null && currentUserId === ownerId;

  // Sub-tab seçimi owner değiştiğinde sıfırlanmalı: aksi halde bir depo
  // sahibinin "Bekleyen"inden diğerine geçince yanlış owner endpoint(’)ine
  // yanlış subTab değeriyle istek atıyor olurduk.
  useEffect(() => {
    setSubTab("items");
  }, [ownerId]);

  return (
    <div className="space-y-4">
      <DepoHeader ownerId={ownerId} owner={owner} isMine={isMine} />

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
              aria-pressed={active}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {subTab === "items" ? (
        <ItemsPanel ownerId={ownerId} canEdit={isMine} />
      ) : (
        <OrdersPanel ownerId={ownerId} tab={subTab} canAct={isMine} />
      )}
    </div>
  );
}

// ───────────────────── Depo Header (sales + vacation) ─────────────────────

interface DepoHeaderProps {
  ownerId: string;
  owner: HouseStockOwner | null;
  isMine: boolean;
}

function DepoHeader({ ownerId, owner, isMine }: DepoHeaderProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  const salesQuery = useQuery({
    queryKey: ["house-stock", "sales", ownerId],
    queryFn: () => fetchSalesSummary(ownerId),
    refetchInterval: 60_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["house-stock", "settings", ownerId],
    queryFn: () => fetchSettings(ownerId),
  });

  const updateVacation = useMutation({
    mutationFn: (vacationMode: boolean) =>
      updateSettings(ownerId, { vacationMode }),
    onSuccess: (data) => {
      queryClient.setQueryData(["house-stock", "settings", ownerId], data);
      toast.push(
        "success",
        data.vacationMode ? "Tatil moduna alındı" : "Tatil modu kapatıldı",
      );
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Tatil modu güncellenemedi",
      );
    },
  });

  const vacationMode = settingsQuery.data?.vacationMode ?? false;
  const sales = salesQuery.data;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500">
            Depo Sahibi
          </p>
          <p className="text-sm font-semibold text-slate-900">
            {owner ? ownerLabel(owner) : "—"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Bu Ay
            </p>
            <p className="text-base font-semibold text-emerald-700">
              {fmtMoney(sales?.monthAmount)}{" "}
              <span className="text-xs font-normal text-slate-500">
                ({sales?.monthCount ?? 0} sipariş)
              </span>
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Toplam
            </p>
            <p className="text-base font-semibold text-slate-900">
              {fmtMoney(sales?.totalAmount)}{" "}
              <span className="text-xs font-normal text-slate-500">
                ({sales?.totalCount ?? 0} sipariş)
              </span>
            </p>
          </div>

          <div className="border-l border-slate-200 pl-6">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Tatil Modu
            </p>
            <button
              type="button"
              disabled={!isMine || updateVacation.isPending}
              onClick={() => updateVacation.mutate(!vacationMode)}
              className={`mt-1 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                vacationMode
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
              title={
                isMine
                  ? "Yalnızca yeni rezervasyonlar durur; mevcut hazırlanan siparişler etkilenmez."
                  : "Sadece kendi deponuzun tatil modunu değiştirebilirsiniz."
              }
            >
              {vacationMode ? (
                <PauseCircle size={14} aria-hidden="true" />
              ) : (
                <PlayCircle size={14} aria-hidden="true" />
              )}
              <span>{vacationMode ? "Tatilde" : "Aktif"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Items Panel ─────────────────────

interface ItemsPanelProps {
  ownerId: string;
  canEdit: boolean;
}

function ItemsPanel({ ownerId, canEdit }: ItemsPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  const itemsQuery = useQuery({
    queryKey: ["house-stock", "items", ownerId],
    queryFn: () => fetchItems(ownerId),
    refetchInterval: 60_000,
  });

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [stockQty, setStockQty] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const debouncedSearch = useDebounce(searchQuery, 200);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const productsQuery = useQuery({
    queryKey: ["house-stock-product-search", debouncedSearch],
    queryFn: () =>
      fetchProducts({
        page: 1,
        pageSize: 12,
        q: debouncedSearch.trim(),
      }),
    enabled: canEdit && debouncedSearch.trim().length > 0 && !selectedProduct,
    staleTime: 30_000,
  });

  const suggestions: Product[] = useMemo(() => {
    const list = productsQuery.data?.data ?? [];
    return list.filter((p) => p.isActive !== false && !!p.internalCode);
  }, [productsQuery.data]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isDropdownOpen]);

  const upsert = useMutation({
    mutationFn: () => {
      if (!selectedProduct?.internalCode) {
        throw new Error("Önce listeden bir ürün seç");
      }
      return upsertItem(ownerId, {
        tbdrCode: selectedProduct.internalCode,
        stockQty: Math.max(0, Math.floor(Number(stockQty) || 0)),
        mode: "add",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["house-stock", "items", ownerId],
      });
      setSelectedProduct(null);
      setSearchQuery("");
      setStockQty("");
      setIsDropdownOpen(false);
      toast.push("success", "Stok eklendi");
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Stok güncellenemedi",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (itemId: string) => deleteItem(itemId, ownerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["house-stock", "items", ownerId],
      });
      toast.push("success", "Ürün silindi");
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Silinemedi (rezerve olabilir)",
      );
    },
  });

  const items = itemsQuery.data ?? [];
  const parsedQty = Math.floor(Number(stockQty) || 0);
  const canSubmit =
    canEdit && !!selectedProduct?.internalCode && parsedQty > 0;

  return (
    <div className="space-y-4">
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            upsert.mutate();
          }}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
            <div ref={searchBoxRef} className="relative">
              <label className="text-[11px] uppercase tracking-wider text-slate-500">
                Ürün ara
              </label>
              {selectedProduct ? (
                <div className="mt-1 flex h-9 items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 px-2">
                  {selectedProduct.imageUrl ? (
                    <img
                      src={selectedProduct.imageUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-6 w-6 rounded object-cover ring-1 ring-emerald-200"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded bg-emerald-100" />
                  )}
                  <span className="truncate text-sm text-slate-800">
                    {selectedProduct.name}
                  </span>
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-emerald-700 ring-1 ring-emerald-200">
                    {selectedProduct.internalCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProduct(null);
                      setSearchQuery("");
                      setIsDropdownOpen(false);
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-rose-600"
                    aria-label="Seçimi temizle"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-1">
                  <Search
                    size={14}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsDropdownOpen(true);
                    }}
                    onFocus={() => setIsDropdownOpen(true)}
                    placeholder="Ürün adıyla ara (en az 2 harf)…"
                    className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    autoComplete="off"
                  />
                  {isDropdownOpen && debouncedSearch.trim().length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                      {productsQuery.isLoading ? (
                        <div className="px-3 py-4 text-center text-xs text-slate-400">
                          Aranıyor…
                        </div>
                      ) : suggestions.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-slate-400">
                          Sonuç yok
                        </div>
                      ) : (
                        suggestions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedProduct(p);
                              setIsDropdownOpen(false);
                              setSearchQuery("");
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                          >
                            {p.imageUrl ? (
                              <img
                                src={p.imageUrl}
                                alt=""
                                aria-hidden="true"
                                className="h-8 w-8 rounded object-cover ring-1 ring-slate-200"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded bg-slate-100" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-slate-800">
                                {p.name}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500">
                                {p.internalCode}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-500">
                Eklenecek Adet
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                placeholder="0"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={!canSubmit || upsert.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} aria-hidden="true" />
                Depoya Ekle
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Aynı ürünü tekrar eklersen mevcut stoğuna eklenir, üzerine yazılmaz.
          </p>
        </form>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Bu depo size ait değil. Sadece görüntüleme.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Ürün</th>
              <th className="px-4 py-3 font-semibold">Stok Kodu</th>
              <th className="px-4 py-3 font-semibold text-right">Stok</th>
              <th className="px-4 py-3 font-semibold text-right">Rezerve</th>
              <th className="px-4 py-3 font-semibold text-right">Boşta</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {itemsQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Yükleniyor…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Bu depoda ürün yok.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {it.productImage ? (
                        <img
                          src={it.productImage}
                          alt=""
                          aria-hidden="true"
                          className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100" />
                      )}
                      <span className="text-sm text-slate-800">
                        {it.productName ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-600">
                    {it.tbdrCode}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {it.stockQty}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {it.reservedQty > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {it.reservedQty}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                    {it.freeQty}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (it.reservedQty > 0) {
                            toast.push("error", "Rezerve adet varken silinemez.");
                            return;
                          }
                          if (!window.confirm("Bu ürünü silmek istiyor musunuz?")) return;
                          remove.mutate(it.id);
                        }}
                        disabled={remove.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                        aria-label="Sil"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────── Orders Panel ─────────────────────

interface OrdersPanelProps {
  ownerId: string;
  tab: HouseStockOrdersTab;
  /** Aksiyon butonları yalnızca depo sahibinin kendi sekmesinde aktiftir. */
  canAct: boolean;
}

/** Bu sekmede sağ "İşlem" sütunu (buton) gösterilir mi? */
function tabHasActions(tab: HouseStockOrdersTab): boolean {
  return tab === "bekleyen" || tab === "kargoVerilecek";
}

function OrdersPanel({
  ownerId,
  tab,
  canAct,
}: OrdersPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  const ordersQuery = useQuery({
    queryKey: ["house-stock", "orders", ownerId, tab],
    queryFn: () => fetchOrdersByTab(ownerId, tab),
    refetchInterval: 30_000,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({
      queryKey: ["house-stock", "orders", ownerId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["house-stock", "items", ownerId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["house-stock", "sales", ownerId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["house-stock", "badge"],
    });
  };

  // "Bekleyen" sekmesi — Depodan Gönder.
  const dispatchMut = useMutation({
    mutationFn: (orderId: string) => dispatchOrderFromDepot(orderId),
    onSuccess: () => {
      invalidate();
      toast.push("success", "Depodan gönderildi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  // "Bekleyen" sekmesi — Tedarikçiye Devret (stok düşülmeden çıkar).
  const transferMut = useMutation({
    mutationFn: (orderId: string) => transferOrderToSupplier(orderId),
    onSuccess: () => {
      invalidate();
      toast.push("success", "Tedarikçiye devredildi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Devir başarısız");
    },
  });

  // "Kargoya Verilecek" sekmesi — Kargoya Verdim.
  const shipMut = useMutation({
    mutationFn: (orderId: string) => markOrderShipped(orderId),
    onSuccess: () => {
      invalidate();
      toast.push("success", "Sipariş kargoya verildi");
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Kargoya verilemedi",
      );
    },
  });

  // "Kargoya Verilecek" sekmesi — Tedarikçiye geri devret (stok iade edilir).
  const revertMut = useMutation({
    mutationFn: (orderId: string) => revertOrderToSupplier(orderId),
    onSuccess: () => {
      invalidate();
      toast.push("success", "Tedarikçiye devredildi, stok iade edildi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  const busy =
    dispatchMut.isPending ||
    transferMut.isPending ||
    shipMut.isPending ||
    revertMut.isPending;

  const rows = ordersQuery.data ?? [];
  // Sipariş + Ürün + Tutar + Kargo Firması + Kargo Barkodu + Rezerve = 6,
  // işlem sütunu varsa 7.
  const colCount = tabHasActions(tab) ? 7 : 6;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Sipariş</th>
            <th className="px-4 py-3 font-semibold">Ürün</th>
            <th className="px-4 py-3 font-semibold text-right">Tutar</th>
            <th className="px-4 py-3 font-semibold">Kargo Firması</th>
            <th className="px-4 py-3 font-semibold">Kargo Barkodu</th>
            <th className="px-4 py-3 font-semibold">Rezerve</th>
            {tabHasActions(tab) ? (
              <th className="px-4 py-3 font-semibold text-right">İşlem</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ordersQuery.isLoading ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                Yükleniyor…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                Bu sekmede sipariş yok.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <OrderRow
                key={row.orderId}
                row={row}
                tab={tab}
                busy={busy}
                canAct={canAct}
                onDispatch={() => dispatchMut.mutate(row.orderId)}
                onTransfer={() => transferMut.mutate(row.orderId)}
                onShip={() => shipMut.mutate(row.orderId)}
                onRevert={() => revertMut.mutate(row.orderId)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

interface OrderRowProps {
  row: HouseStockOrderRow;
  tab: HouseStockOrdersTab;
  busy: boolean;
  canAct: boolean;
  onDispatch: () => void;
  onTransfer: () => void;
  onShip: () => void;
  onRevert: () => void;
}

function OrderRow({
  row,
  tab,
  busy,
  canAct,
  onDispatch,
  onTransfer,
  onShip,
  onRevert,
}: OrderRowProps): React.ReactElement {
  const firmaLabel = cargoLabel(row.cargoCompany);

  // "Kargoya Verdim" onay metni kargo bilgisinden dinamik kurulur.
  const handleShip = (): void => {
    const parts = [firmaLabel, row.cargoBarcode].filter(Boolean).join(" ");
    const message = parts
      ? `${parts} kargo barkodlu ürünü teslim ettiğinizi onaylıyor musunuz?`
      : "Ürünü kargoya teslim ettiğinizi onaylıyor musunuz?";
    if (!window.confirm(message)) return;
    onShip();
  };

  const handleDispatch = (): void => {
    if (
      !window.confirm(
        "Bu siparişi kendi depo stoğundan göndereceksin; raf stoğu düşer. Gerekirse Kargoya Verilecek sekmesinden Tedarikçiye Devret ile geri alabilirsin. Onaylıyor musun?",
      )
    )
      return;
    onDispatch();
  };

  const handleTransfer = (): void => {
    if (
      !window.confirm(
        "evden gönderemeyeceğinizi onaylıyorsunuz bu sipariş tedarikçiden alınacak onaylıyor musunuz?",
      )
    )
      return;
    onTransfer();
  };

  const handleRevert = (): void => {
    if (
      !window.confirm(
        "Alımı Tedarikçinin gerçekleştirmesini istediğinizden emin misiniz? sipariş statüsü tekrardan ödendiye düşürülecektir ve sipariş tedarikçiden temin edilecektir",
      )
    )
      return;
    onRevert();
  };

  return (
    <tr className="hover:bg-slate-50/60 align-top">
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <Link
            to={`/orders/${row.orderId}`}
            className="font-mono text-[12px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            #{row.humanOrderNo}
          </Link>
          <span className="text-[11px] text-slate-400">
            {formatDateTime(row.createdAt)}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-2">
          {row.items.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <div className="relative h-10 w-10 shrink-0">
                {item.productImage ? (
                  <img
                    src={item.productImage}
                    alt=""
                    aria-hidden="true"
                    className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-slate-100" />
                )}
                <span className="absolute -left-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-4 text-white shadow ring-1 ring-white">
                  x{item.qty}
                </span>
              </div>
              <span className="line-clamp-2 max-w-[220px] text-[12px] leading-snug text-slate-700">
                {item.productName ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 font-semibold text-slate-800">
        {fmtMoney(row.total)}
      </td>
      <td className="px-4 py-3">
        {firmaLabel ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cargoChipClasses(
              row.cargoCompany,
            )}`}
          >
            <Truck size={11} aria-hidden="true" />
            {firmaLabel}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-[12px] text-slate-600">
        {row.cargoBarcode ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs">
        <div className="flex flex-col">
          <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
            {row.expiringSoon ? (
              <AlertTriangle size={12} aria-hidden="true" className="text-rose-600" />
            ) : null}
            {row.reservedQty} adet
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400">
            {row.depotLabel}
          </span>
          {row.dispatchKind === "manual" ? (
            <span className="text-[10px] uppercase tracking-wider text-emerald-600">
              Depodan gönderildi
            </span>
          ) : null}
        </div>
      </td>
      {tabHasActions(tab) ? (
        <td className="px-4 py-3 text-right">
          {!canAct ? (
            // Başka bir OWNER'ın deposunu görüntülüyoruz — yalnızca okuma.
            // Aksiyon butonları yalnızca deponun sahibinde görünür.
            <span className="text-[11px] italic text-slate-400">
              Yalnızca depo sahibi işlem yapabilir
            </span>
          ) : (
          <div className="inline-flex flex-wrap items-center justify-end gap-2">
            {tab === "bekleyen" ? (
              <>
                <button
                  type="button"
                  onClick={handleDispatch}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={12} aria-hidden="true" />
                  Depodan Gönder
                </button>
                <button
                  type="button"
                  onClick={handleTransfer}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowRightLeft size={12} aria-hidden="true" />
                  Tedarikçiye Devret
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleShip}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckCircle2 size={12} aria-hidden="true" />
                  Kargoya Verdim
                </button>
                <button
                  type="button"
                  onClick={handleRevert}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Undo2 size={12} aria-hidden="true" />
                  Gönderimi Sağlayamayacağım Tedarikçiye Devret
                </button>
              </>
            )}
          </div>
          )}
        </td>
      ) : null}
    </tr>
  );
}

// ───────────────────── Total View ─────────────────────

interface TotalViewProps {
  owners: ReadonlyArray<HouseStockOwner>;
}

function TotalView({ owners }: TotalViewProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {owners.map((owner) => (
        <TotalCard key={owner.id} owner={owner} />
      ))}
    </div>
  );
}

function TotalCard({ owner }: { owner: HouseStockOwner }): React.ReactElement {
  const salesQuery = useQuery({
    queryKey: ["house-stock", "sales", owner.id],
    queryFn: () => fetchSalesSummary(owner.id),
    refetchInterval: 60_000,
  });
  const sales = salesQuery.data;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
          <Warehouse size={18} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Depo Stoğu — {ownerLabel(owner)}
          </p>
          <p className="text-[11px] text-slate-500">{owner.email}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500">
            Bu Ay
          </p>
          <p className="text-lg font-semibold text-emerald-700">
            {fmtMoney(sales?.monthAmount)}
          </p>
          <p className="text-[11px] text-slate-400">
            {sales?.monthCount ?? 0} sipariş
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500">
            Toplam
          </p>
          <p className="text-lg font-semibold text-slate-900">
            {fmtMoney(sales?.totalAmount)}
          </p>
          <p className="text-[11px] text-slate-400">
            {sales?.totalCount ?? 0} sipariş
          </p>
        </div>
      </div>
    </div>
  );
}

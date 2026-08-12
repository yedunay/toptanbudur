import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  CARGO_COMPANIES,
  CARGO_COMPANY_LABELS,
  ORDER_MARKETPLACES,
  ORDER_MARKETPLACE_LABELS,
  ORDER_STATUS_LABELS,
  checkCargoBarcodeDuplicates,
  deleteOrder,
  fetchOrder,
  fetchSupplierAlternatives,
  formatDateTime,
  formatOrderNo,
  setOrderSupplierOrderNo,
  updateOrder,
  type CargoBarcodeDuplicate,
  type CargoCompany,
  type OrderItem,
  type OrderInvoiceBatch,
  type OrderMarketplace,
  type OrderStatus,
  type OrderUpdate,
  type SupplierDecision,
} from "../lib/orders";
import { formatTRY } from "../lib/products";
import { useToast } from "../components/Toast";
import { OrderSupplierPicker } from "../components/OrderSupplierPicker";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { storefrontProductUrl } from "../lib/urls";
import { canSeeCostProfit } from "../lib/permissions";

const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  paid: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["refunded"],
  cancelled: [],
  refunded: [],
};

function statusColor(status: OrderStatus): string {
  switch (status) {
    case "shipped":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "paid":
    case "preparing":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "cancelled":
    case "refunded":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

const MARKETPLACE_BADGE_STYLES: Record<OrderMarketplace, string> = {
  other: "bg-slate-100 text-slate-800 ring-slate-200",
  self: "bg-blue-100 text-blue-800 ring-blue-200",
};

function MarketplaceBadge({ marketplace }: { marketplace: OrderMarketplace | string }): React.ReactElement {
  // "Kendim İçin" (self) — bayinin kendisi için verdiği sipariş; ayrı rozet.
  const isSelf = marketplace === "self";
  const isKnown = (ORDER_MARKETPLACES as readonly string[]).includes(marketplace);
  const key = (isKnown ? marketplace : "") as OrderMarketplace;
  const label = isSelf
    ? "Kendim İçin"
    : isKnown
    ? ORDER_MARKETPLACE_LABELS[key]
    : marketplace.charAt(0).toUpperCase() + marketplace.slice(1);
  const cls = isSelf
    ? "bg-blue-100 text-blue-800 ring-blue-200"
    : isKnown
    ? MARKETPLACE_BADGE_STYLES[key]
    : "bg-[var(--color-surface-muted)] text-[var(--color-text)] ring-[var(--color-border)]";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

function SectionCard({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }): React.ReactElement {
  return (
    <div className={`rounded-xl border bg-white ${danger ? "border-red-300" : "border-[var(--color-border)]"}`}>
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-sm font-medium text-[var(--color-text)]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * Konsolide fatura durumu (birfatura.md §11) — yalnızca admin görür.
 * Üç durum:
 *  1) invoicedAt dolu  → yeşil "Faturalandı" + fatura no/tarih + (varsa) bağlantı
 *  2) invoiceBatch var, invoicedAt boş → amber "Faturaya alındı (bekliyor)" + dönem
 *  3) hiçbiri yok      → nötr "Henüz faturaya alınmadı"
 */
function OrderInvoiceCard({
  invoicedAt,
  invoiceBatch,
}: {
  invoicedAt?: string | null;
  invoiceBatch?: OrderInvoiceBatch | null;
}): React.ReactElement {
  const periodText =
    invoiceBatch?.periodStart || invoiceBatch?.periodEnd
      ? `${invoiceBatch?.periodStart ? formatDateTime(invoiceBatch.periodStart) : "?"} – ${
          invoiceBatch?.periodEnd ? formatDateTime(invoiceBatch.periodEnd) : "?"
        }`
      : null;

  if (invoicedAt) {
    return (
      <SectionCard title="Faturalandırma">
        <div className="space-y-3 text-sm">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Faturalandı
          </div>
          <dl className="space-y-2">
            {invoiceBatch?.invoiceNumber ? (
              <div className="flex justify-between gap-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Fatura No
                </dt>
                <dd className="font-mono font-medium text-right">
                  {invoiceBatch.invoiceNumber}
                </dd>
              </div>
            ) : null}
            {invoiceBatch?.invoiceDate ? (
              <div className="flex justify-between gap-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Fatura Tarihi
                </dt>
                <dd className="text-right">{formatDateTime(invoiceBatch.invoiceDate)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                Faturalanma
              </dt>
              <dd className="text-right">{formatDateTime(invoicedAt)}</dd>
            </div>
            {periodText ? (
              <div className="flex justify-between gap-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Dönem
                </dt>
                <dd className="text-right text-[var(--color-text-muted)]">{periodText}</dd>
              </div>
            ) : null}
          </dl>
          {invoiceBatch?.invoiceUrl ? (
            <a
              href={invoiceBatch.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-blue)] hover:underline"
            >
              Faturayı görüntüle →
            </a>
          ) : null}
          <Link
            to="/ayarlar/fatura"
            className="block text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
          >
            Tüm konsolide faturalar →
          </Link>
        </div>
      </SectionCard>
    );
  }

  if (invoiceBatch) {
    return (
      <SectionCard title="Faturalandırma">
        <div className="space-y-3 text-sm">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Faturaya alındı (bekliyor)
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Sipariş aylık konsolide kesime donduruldu; BirFatura faturayı henüz
            bu siparişe bağlamadı.
          </p>
          {periodText ? (
            <div className="flex justify-between gap-2">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                Dönem
              </dt>
              <dd className="text-right text-[var(--color-text-muted)]">{periodText}</dd>
            </div>
          ) : null}
          <Link
            to="/ayarlar/fatura"
            className="block text-xs font-medium text-[var(--color-brand-blue)] hover:underline"
          >
            Konsolide faturalarda gör →
          </Link>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Faturalandırma">
      <div className="space-y-1.5 text-sm">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Henüz faturaya alınmadı
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Sipariş kargolandıktan sonra, kesim gününde aylık konsolide e-faturaya
          dahil edilir.
        </p>
      </div>
    </SectionCard>
  );
}

export default function OrderDetailPage(): React.ReactElement | null {
  const authed = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () =>
      id ? deleteOrder(id) : Promise.reject(new Error("missing id")),
    onSuccess: () => {
      toast.push("success", "Sipariş silindi");
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.removeQueries({ queryKey: ["order", id] });
      navigate("/orders");
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Silinemedi");
    },
  });

  const orderQuery = useQuery({
    queryKey: ["order", id],
    queryFn: () => (id ? fetchOrder(id) : Promise.reject(new Error("missing id"))),
    enabled: authed && Boolean(id),
  });

  // Belge başlığı: yüklenince insan-okur sipariş no (61...), yüklenirken boş.
  useDocumentTitle(
    orderQuery.data
      ? `Sipariş ${formatOrderNo(orderQuery.data.humanOrderNo, orderQuery.data.orderNumber)}`
      : "Sipariş",
  );

  // SİPARİŞ-SEVİYESİ tedarikçi kararı (maliyet-vs-maliyet, eşik-bilinçli) — YALNIZ
  // 'paid' (alım öncesi). 'preparing'+ kilitli → backend kind:'none' döner.
  // Kullanıcı kararı 2026-06-29.
  // Uç OWNER/ADMIN'e kilitli ve alım maliyeti taşıyor; çalışanda sorguyu hiç
  // atmıyoruz — data undefined kalır, uyarı şeridi de çizilmez.
  const canSeeCost = canSeeCostProfit();
  const decisionQuery = useQuery<SupplierDecision>({
    queryKey: ["order", id, "supplier-alternatives"],
    queryFn: () =>
      id ? fetchSupplierAlternatives(id) : Promise.resolve({ kind: "none" }),
    enabled:
      authed && canSeeCost && Boolean(id) && orderQuery.data?.status === "paid",
    staleTime: 60_000,
  });
  const supplierDecision = decisionQuery.data;

  const [statusInput, setStatusInput] = useState<OrderStatus | "">("");
  const [marketplaceInput, setMarketplaceInput] = useState<OrderMarketplace | "">("");
  const [cargoCompanyInput, setCargoCompanyInput] = useState<string>("");
  const [cargoBarcodeInput, setCargoBarcodeInput] = useState<string>("");
  const [supplierOrderNoInput, setSupplierOrderNoInput] = useState<string>("");
  const [endCustomerNameInput, setEndCustomerNameInput] = useState<string>("");
  const [notifyCustomer, setNotifyCustomer] = useState<boolean>(true);
  const [copyFeedback, setCopyFeedback] = useState<string>("");

  const [pendingUpdate, setPendingUpdate] = useState<OrderUpdate | null>(null);
  const [barcodeDuplicates, setBarcodeDuplicates] = useState<CargoBarcodeDuplicate[]>([]);

  useEffect(() => {
    const o = orderQuery.data;
    if (o) {
      setStatusInput(o.status);
      setMarketplaceInput((o.marketplace ?? "") as OrderMarketplace | "");
      setCargoCompanyInput(typeof o.cargoCompany === "string" ? o.cargoCompany : "");
      setCargoBarcodeInput(o.cargoBarcode ?? "");
      setSupplierOrderNoInput(o.supplierOrderNo ?? "");
      setEndCustomerNameInput(o.endCustomerName ?? "");
    }
  }, [orderQuery.data]);

  const copyToClipboard = async (value: string, label: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(label);
      window.setTimeout(() => setCopyFeedback(""), 1500);
      toast.push("success", `${label} kopyalandı`);
    } catch {
      toast.push("error", "Kopyalanamadı");
    }
  };

  const updateMutation = useMutation({
    mutationFn: (patch: OrderUpdate) =>
      id ? updateOrder(id, patch) : Promise.reject(new Error("missing id")),
    onSuccess: () => {
      toast.push("success", "Sipariş güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["order", id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Güncelleme başarısız");
    },
  });

  // Tedarikçi sipariş no kaydı — "paid" bir sipariş için ilk kez girildiğinde
  // backend otomatik olarak siparişi "Hazırlanıyor"a çeker. O mekanizma kritik.
  const supplierOrderNoMutation = useMutation({
    mutationFn: (value: string) =>
      id
        ? setOrderSupplierOrderNo(id, value.trim() || null)
        : Promise.reject(new Error("missing id")),
    onSuccess: () => {
      const willPrepare = orderQuery.data?.status === "paid";
      toast.push(
        "success",
        willPrepare
          ? "Tedarikçi sipariş no kaydedildi — sipariş hazırlanıyora alındı"
          : "Tedarikçi sipariş no kaydedildi",
      );
      void queryClient.invalidateQueries({ queryKey: ["order", id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Kaydedilemedi");
    },
  });

  if (orderQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-surface-muted)]" />
        </div>
        <div className="h-8 w-56 animate-pulse rounded bg-[var(--color-surface-muted)]" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Sipariş yüklenemedi.{" "}
        <Link to="/orders" className="underline font-medium">
          Listeye dön
        </Link>
      </div>
    );
  }

  const order = orderQuery.data;
  // "Kendim İçin" (self) sipariş: müşteri ismi / kargo barkodu YOKTUR — admin
  // formunda bu alanlar zorunlu değildir.
  const isSelfOrder = order.marketplace === "self";

  const restrictedItems = order.items.filter(
    (it: OrderItem) =>
      Boolean(it.supplier?.requiresPdf) ||
      (Array.isArray(it.supplier?.mandatoryCarriers) &&
        (it.supplier?.mandatoryCarriers ?? []).length > 0),
  );

  const distinctMandatoryCarriers = Array.from(
    new Set(
      restrictedItems.flatMap((it) =>
        Array.isArray(it.supplier?.mandatoryCarriers)
          ? (it.supplier?.mandatoryCarriers ?? []).map((c) => c.trim())
          : [],
      ),
    ),
  ).filter((c) => c.length > 0);

  const requiresPdf = restrictedItems.some((it) => it.supplier?.requiresPdf);
  const pdfMissing = requiresPdf && !order.pdfUrl;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
        <Link to="/orders" className="hover:text-[var(--color-text)] transition-colors">
          ← Siparişler
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tabular-nums text-[var(--color-text)]">
              {formatOrderNo(order.humanOrderNo, order.orderNumber)}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor(order.status)}`}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </span>
            {order.marketplace ? (
              <MarketplaceBadge marketplace={order.marketplace} />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatDateTime(order.createdAt)}
            {order.customerName ? (
              <>
                {" · "}
                {order.customerId ? (
                  <Link
                    to={`/customers/${order.customerId}`}
                    className="text-[var(--color-brand-blue)] hover:underline"
                  >
                    {order.customerName}
                  </Link>
                ) : (
                  order.customerName
                )}
              </>
            ) : null}
          </p>
          {order.supplierOrderNo ? (
            <p className="mt-1 text-sm text-[var(--color-text)]">
              <span className="text-[var(--color-text-muted)]">Tedarikçi Sip No:</span>{" "}
              <span className="font-mono font-medium">{order.supplierOrderNo}</span>
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Toplam</div>
          <div className="text-2xl font-semibold tabular-nums">{formatTRY(order.total)}</div>
          {order.paymentType === "card" &&
          typeof order.cardCommissionAmount === "number" &&
          order.cardCommissionAmount > 0 ? (
            <div
              className="text-xs text-[var(--color-text-muted)]"
              title="Karttan çekilen toplam = sipariş toplamı + kart komisyonu"
            >
              Çekilen: {formatTRY(order.total + order.cardCommissionAmount)}
            </div>
          ) : null}
          {typeof order.subtotal === "number" && order.subtotal !== order.total ? (
            <div className="text-xs text-[var(--color-text-muted)]">
              Ara: {formatTRY(order.subtotal)}
              {typeof order.shippingFee === "number" && order.shippingFee > 0
                ? ` + Kargo: ${formatTRY(order.shippingFee)}`
                : ""}
            </div>
          ) : null}
        </div>
      </div>

      {/* Supplier constraint banner */}
      {restrictedItems.length > 0 ? (
        <div className={`rounded-xl border p-4 text-sm ${pdfMissing ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          <div className="font-medium mb-1.5">Tedarikçi kısıtlamaları</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {distinctMandatoryCarriers.length > 0 ? (
              <li>
                Zorunlu kargo:{" "}
                <span className="font-mono font-medium">{distinctMandatoryCarriers.join(", ")}</span>
                {" "}— bu siparişte yalnızca bu firma ile gönderim yapılabilir.
              </li>
            ) : null}
            {requiresPdf ? (
              <li>
                Tedarikçi imzalı sipariş PDF'i zorunlu.
                {pdfMissing ? (
                  <span className="ml-1 font-semibold text-red-700">PDF yüklenmemiş!</span>
                ) : null}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <section className="lg:col-span-2 space-y-6">
          {/* Products — kalem altındaki tedarikçi adına tıklayınca tüm sipariş tek
              tedarikçiye alınır (ayrı "tüm sipariş" satırı YOK; kullanıcı kararı 2026-06-29). */}
          <SectionCard title="Ürünler">
            {supplierDecision && supplierDecision.kind !== "none" ? (
              <div
                className={`mb-3 rounded-md border px-3 py-2 text-xs ${
                  supplierDecision.kind === "deliberate"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
                title={`${supplierDecision.cheaperSupplierName ?? ""} toplam ${formatTRY(
                  supplierDecision.diff ?? 0,
                )} daha ucuz · eşik ${formatTRY(supplierDecision.threshold ?? 0)}`}
              >
                {supplierDecision.kind === "deliberate" ? (
                  <>
                    ✓ <strong>{supplierDecision.cheaperSupplierName}</strong>{" "}
                    {formatTRY(supplierDecision.diff ?? 0)} daha ucuz, ancak eşiğin (
                    {formatTRY(supplierDecision.threshold ?? 0)}) altında — tedarikçi
                    ilişkisi için{" "}
                    <strong>{supplierDecision.currentSupplierName}</strong> bilinçli
                    olarak tercih edildi.{" "}
                    <span className="opacity-70">(üzerine gel: fark)</span>
                  </>
                ) : (
                  <>
                    ⚠ <strong>{supplierDecision.cheaperSupplierName}</strong>{" "}
                    {formatTRY(supplierDecision.diff ?? 0)} daha ucuz (eşik{" "}
                    {formatTRY(supplierDecision.threshold ?? 0)}) — daha ucuza alınabilir.
                  </>
                )}
              </div>
            ) : null}
            <div className="-m-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="px-5 py-2.5 text-left">Ürün</th>
                    <th className="px-5 py-2.5 text-right">Adet</th>
                    <th className="hidden px-5 py-2.5 text-right sm:table-cell">Birim</th>
                    <th className="px-5 py-2.5 text-right">Toplam</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {order.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-[var(--color-text-muted)]">
                        Ürün yok
                      </td>
                    </tr>
                  ) : (
                    order.items.map((item) => (
                      <tr key={item.id} className="hover:bg-[var(--color-surface-muted)] transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-medium">
                            {storefrontProductUrl(item.productSlug) ? (
                              <a
                                href={storefrontProductUrl(item.productSlug) ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--color-text)] hover:text-[var(--color-brand-blue)] hover:underline"
                                title="Storefront kataloğunda ürünü aç"
                              >
                                {item.productName}
                              </a>
                            ) : (
                              item.productName
                            )}
                          </div>
                          {item.sku ? (
                            <div className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                              {item.sku}
                            </div>
                          ) : null}
                          {/* Tedarikçi kod/barkod — sipariş anındaki snapshot.
                              Yalnızca admin görür, müşteriye asla gösterilmez. */}
                          {item.supplierSku || item.supplierBarcode ? (
                            <div
                              className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]"
                              title="Tedarikçi kodları — yalnızca admin görür, müşteriye gösterilmez"
                            >
                              <span className="font-sans">Tedarikçi:</span>{" "}
                              {item.supplierSku ? <span>Stok {item.supplierSku}</span> : null}
                              {item.supplierSku && item.supplierBarcode ? <span> · </span> : null}
                              {item.supplierBarcode ? <span>Barkod {item.supplierBarcode}</span> : null}
                            </div>
                          ) : null}
                          {item.supplier && id ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {/* Tedarikçi adına tıkla → tüm siparişi tek tedarikçiye al
                                  (kalem-kalem DEĞİŞTİRİLEMEZ; kullanıcı kararı 2026-06-29). */}
                              <OrderSupplierPicker
                                orderId={id}
                                triggerLabel={item.supplier.name}
                              />
                              {item.supplierIdOverride ? (
                                <span
                                  className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-800"
                                  title="Bayinin alım yaptığı tedarikçi orijinalden farklı — ciro/cari bu tedarikçi üzerinden hesaplanıyor"
                                >
                                  override
                                </span>
                              ) : null}
                              {Array.isArray(item.supplier.mandatoryCarriers) &&
                              item.supplier.mandatoryCarriers.length > 0 ? (
                                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                                  Zorunlu kargo: {item.supplier.mandatoryCarriers.join(", ")}
                                </span>
                              ) : null}
                              {item.supplier.requiresPdf ? (
                                <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] text-rose-800">
                                  PDF zorunlu
                                </span>
                              ) : null}
                              {typeof item.supplier.leadTimeDays === "number" ? (
                                <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800">
                                  {item.supplier.leadTimeDays} gün
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {item.cheaperHint ? (
                            <div className="mt-1.5">
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800"
                                title="Yeni Tedarikçi Analizi'nde işaretlendi — sadece hatırlatma, sisteme hiçbir şey sokmaz"
                              >
                                ⚠ {item.cheaperHint.supplierName}'de daha ucuz
                                {item.cheaperHint.savingPerUnit > 0
                                  ? ` (birim ${item.cheaperHint.savingPerUnit.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ tasarruf)`
                                  : ""}
                                {item.cheaperHint.productUrl ? (
                                  <a href={item.cheaperHint.productUrl} target="_blank" rel="noopener noreferrer" className="underline">
                                    gör
                                  </a>
                                ) : null}
                              </span>
                            </div>
                          ) : null}
                          {(() => {
                            const itemSupNo =
                              item.supplierOrderNo ?? order.supplierOrderNo ?? null;
                            return (
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <span className="text-[11px] text-[var(--color-text-muted)] whitespace-nowrap">
                                  Tedarikçi sipariş no:
                                </span>
                                <span className="font-mono text-[11px] text-[var(--color-text)]">
                                  {itemSupNo ?? "—"}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{item.quantity}</td>
                        <td className="hidden px-5 py-3 text-right tabular-nums sm:table-cell">
                          {formatTRY(item.unitPrice)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums font-medium">
                          {formatTRY(item.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {typeof order.subtotal === "number" ||
              typeof order.shippingFee === "number" ||
              (typeof order.packagingCost === "number" && order.packagingCost > 0) ? (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-3 space-y-1 text-sm">
                  {/* Ödeme tipi — null/eksik = cari (kart özelliği öncesi siparişler). */}
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Ödeme</span>
                    {order.paymentType === "card" ? (
                      <span
                        className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        title={
                          order.posProviderKey
                            ? `POS: ${order.posProviderKey}`
                            : undefined
                        }
                      >
                        Kredi Kartı
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Cari
                      </span>
                    )}
                  </div>
                  {typeof order.subtotal === "number" ? (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Ara toplam</span>
                      <span className="tabular-nums">{formatTRY(order.subtotal)}</span>
                    </div>
                  ) : null}
                  {typeof order.shippingFee === "number" ? (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Kargo</span>
                      <span className="tabular-nums">{formatTRY(order.shippingFee)}</span>
                    </div>
                  ) : null}
                  {typeof order.packagingCost === "number" && order.packagingCost > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">
                        Paketleme
                        {typeof order.packagingUnitFee === "number" && order.packagingUnitFee > 0 ? (
                          <span className="ml-1 text-xs text-[var(--color-text-muted)]">
                            ({formatTRY(order.packagingUnitFee)}/birim)
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums">{formatTRY(order.packagingCost)}</span>
                    </div>
                  ) : null}
                  {typeof order.cargoCost === "number" && order.cargoCost > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Kargo Bedeli</span>
                      <span className="tabular-nums">{formatTRY(order.cargoCost)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between font-semibold border-t border-[var(--color-border)] pt-1">
                    <span>Toplam</span>
                    <span className="tabular-nums">{formatTRY(order.total)}</span>
                  </div>
                  {/* Kart komisyonu — total'a DAHİL DEĞİL; karttan çekilen =
                      total + cardCommissionAmount. Backend kesin hesabı yapar,
                      burada yalnızca snapshot gösterilir. */}
                  {order.paymentType === "card" &&
                  typeof order.cardCommissionAmount === "number" &&
                  order.cardCommissionAmount > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[var(--color-text-muted)]">
                          Kart Komisyonu
                          {typeof order.cardCommissionRate === "number" &&
                          order.cardCommissionRate > 0 ? (
                            <span className="ml-1 text-xs">
                              (%
                              {order.cardCommissionRate.toLocaleString("tr-TR", {
                                maximumFractionDigits: 2,
                              })}
                              )
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular-nums">
                          {formatTRY(order.cardCommissionAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span>Çekilen Toplam</span>
                        <span className="tabular-nums">
                          {formatTRY(order.total + order.cardCommissionAmount)}
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* Timeline */}
          {order.timeline && order.timeline.length > 0 ? (
            <SectionCard title="Durum geçmişi">
              <div className="-m-5">
                <ol className="divide-y divide-[var(--color-border)]">
                  {order.timeline.map((entry, idx) => (
                    <li key={idx} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(entry.status)}`}
                        >
                          {ORDER_STATUS_LABELS[entry.status]}
                        </span>
                        {entry.note ? (
                          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{entry.note}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] tabular-nums">
                        {formatDateTime(entry.at)}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </SectionCard>
          ) : null}
        </section>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Order management */}
          <SectionCard title="Sipariş yönetimi">
            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Durum</span>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as OrderStatus)}
                  className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                >
                  {/* Tüm statüler seçilebilir — admin yanlış işlemi geri
                      alabilmeli. Normal ileri geçişler dışındakiler (iptal/
                      iade'den diriltme, depodan→paid) "⚠" ile işaretli ve
                      kaydederken onay popup'ı çıkar. */}
                  {(Object.keys(STATUS_TRANSITIONS) as OrderStatus[]).map((s) => {
                    const cur = order.status as OrderStatus;
                    const risky =
                      s !== cur && !(STATUS_TRANSITIONS[cur] ?? []).includes(s);
                    return (
                      <option key={s} value={s}>
                        {ORDER_STATUS_LABELS[s]}
                        {risky ? " ⚠ (geri alma — onay ister)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Satış Kanalı</span>
                <select
                  value={marketplaceInput}
                  onChange={(e) => setMarketplaceInput(e.target.value as OrderMarketplace | "")}
                  className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                >
                  <option value="">— Seçilmedi —</option>
                  {/* 'self' düzenleme dropdown'ında yok — backend admin
                      güncellemesinde 'self' kabul etmez (mevcut kural). */}
                  {ORDER_MARKETPLACES.filter((m) => m !== "self").map((m) => (
                    <option key={m} value={m}>{ORDER_MARKETPLACE_LABELS[m]}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                  Müşteri ismi
                  {isSelfOrder ? (
                    <span className="ml-1 font-normal text-[var(--color-text-muted)]">(Kendim İçin — gerekmez)</span>
                  ) : (
                    <span className="ml-1 font-normal text-red-600">(zorunlu)</span>
                  )}
                  <span className="ml-1 font-normal text-[var(--color-text-muted)]">— bayinin son müşterisi</span>
                </span>
                <input
                  type="text"
                  value={endCustomerNameInput}
                  onChange={(e) => setEndCustomerNameInput(e.target.value.slice(0, 200))}
                  className={`block w-full rounded-lg border bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] ${
                    !isSelfOrder && endCustomerNameInput.trim().length === 0
                      ? "border-red-300"
                      : "border-[var(--color-border)]"
                  }`}
                  placeholder={isSelfOrder ? "Kendim İçin siparişte gerekmez" : "Siparişin ulaştırılacağı müşterinin adı"}
                />
                {!isSelfOrder && endCustomerNameInput.trim().length === 0 ? (
                  <span className="mt-1 block text-xs text-red-600">
                    Müşteri ismi zorunludur.
                  </span>
                ) : null}
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                  Kargo firması
                  {distinctMandatoryCarriers.length === 1 ? (
                    <span className="ml-1 font-normal text-amber-700">(tedarikçi kilitli)</span>
                  ) : null}
                </span>
                <select
                  value={cargoCompanyInput}
                  onChange={(e) => setCargoCompanyInput(e.target.value)}
                  disabled={distinctMandatoryCarriers.length === 1}
                  className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:opacity-60"
                >
                  <option value="">— Seçilmedi —</option>
                  {CARGO_COMPANIES.map((c) => (
                    <option key={c} value={c}>{CARGO_COMPANY_LABELS[c]}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Kargo takip no</span>
                <input
                  type="text"
                  value={cargoBarcodeInput}
                  onChange={(e) => setCargoBarcodeInput(e.target.value)}
                  className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                  placeholder="Kargo barkod / takip no"
                />
              </label>

              {/* Tedarikçi sipariş no — kendi save butonu var. "Ödeme alındı"
                  bir siparişe ilk kez girildiğinde sipariş OTOMATİK olarak
                  "Hazırlanıyor"a çekilir (backend mekanizması). */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3">
                <label className="block">
                  <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                    Tedarikçi sipariş no
                    {order.status === "paid" ? (
                      <span className="ml-1 font-normal text-emerald-700">
                        (girince Hazırlanıyor'a çekilir)
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="text"
                    value={supplierOrderNoInput}
                    onChange={(e) => setSupplierOrderNoInput(e.target.value)}
                    className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                    placeholder="Tedarikçiden alınan sipariş no"
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    supplierOrderNoMutation.isPending ||
                    supplierOrderNoInput.trim() === (order.supplierOrderNo ?? "").trim()
                  }
                  onClick={() => supplierOrderNoMutation.mutate(supplierOrderNoInput)}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-brand-blue)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {supplierOrderNoMutation.isPending ? "Kaydediliyor…" : "Tedarikçi sip. no kaydet"}
                </button>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={notifyCustomer}
                  onChange={(e) => setNotifyCustomer(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
                />
                <span className="text-[var(--color-text-muted)]">
                  Durum değişirse müşteriye e-posta gönder
                </span>
              </label>

              <button
                type="button"
                onClick={async () => {
                  const trimmedBarcode = cargoBarcodeInput.trim();
                  const trimmedCargoCompany = cargoCompanyInput.trim();
                  const trimmedEndCustomerName = endCustomerNameInput.trim();
                  if (!isSelfOrder && trimmedEndCustomerName.length === 0) {
                    toast.push("error", "Müşteri ismi zorunludur");
                    return;
                  }
                  const patch: OrderUpdate = {
                    status: statusInput || undefined,
                    marketplace: marketplaceInput || null,
                    cargoCompany: trimmedCargoCompany.length > 0 ? trimmedCargoCompany : null,
                    cargoBarcode: trimmedBarcode.length > 0 ? trimmedBarcode : null,
                    endCustomerName: trimmedEndCustomerName,
                    notify: notifyCustomer,
                  };

                  // Riskli statü geçişi (iptal/iade'den diriltme veya depodan
                  // gönderilmiş→paid): ne olacağını açıkça anlatıp onay iste.
                  // Onaylanırsa confirmReactivation gönderilir (backend aksi
                  // halde 409 "onay gerekir" döner). Normal ileri geçişler
                  // (paid→preparing→shipped→refunded) onaysız kaydedilir.
                  const curStatus = order.status as OrderStatus;
                  if (
                    patch.status &&
                    patch.status !== curStatus &&
                    !(STATUS_TRANSITIONS[curStatus] ?? []).includes(patch.status)
                  ) {
                    const ok = window.confirm(
                      `Riskli statü değişikliği:\n"${ORDER_STATUS_LABELS[curStatus]}" → "${ORDER_STATUS_LABELS[patch.status]}"\n\n` +
                        (curStatus === "cancelled"
                          ? "İptal edilmiş sipariş YENİDEN AKTİFLEŞTİRİLECEK:\n" +
                            "• Stok yeniden düşülür\n" +
                            "• Müşteri carisi yeniden ücretlendirilir\n" +
                            "• Tedarikçi cüzdanı yeniden düşülür\n\n" +
                            "(Müşterinin cari bakiyesi yetmezse işlem durur, sipariş iptalde kalır.)\n\nDevam edilsin mi?"
                          : "İade durumundan geri alma ya da depodan gönderilmiş siparişi geri çekme yapıyorsunuz.\n\n" +
                            "⚠ Stok, cari ve depo hareketleri OTOMATİK düzeltilmez — gerekirse elle kontrol edin.\n\nDevam edilsin mi?"),
                    );
                    if (!ok) return;
                    patch.confirmReactivation = true;
                  }

                  const barcodeChanged =
                    trimmedBarcode.length > 0 &&
                    trimmedBarcode !== (order.cargoBarcode ?? "").trim();

                  if (barcodeChanged && id) {
                    try {
                      const matches = await checkCargoBarcodeDuplicates(trimmedBarcode, id);
                      if (matches.length > 0) {
                        setBarcodeDuplicates(matches);
                        setPendingUpdate(patch);
                        return;
                      }
                    } catch {
                      // Kontrol başarısız olursa akışı bloklamıyoruz — kullanıcının
                      // işini zorlaştırmamak için kayda devam.
                    }
                  }

                  updateMutation.mutate(patch);
                }}
                disabled={updateMutation.isPending || (!isSelfOrder && endCustomerNameInput.trim().length === 0)}
                className="w-full rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60 transition-colors"
              >
                {updateMutation.isPending ? "Kaydediliyor…" : "Güncelle"}
              </button>
            </div>
          </SectionCard>

          {/* Faturalandırma durumu (birfatura.md §11) — yalnızca admin görür */}
          <OrderInvoiceCard
            invoicedAt={order.invoicedAt}
            invoiceBatch={order.invoiceBatch}
          />

          {/* Shipment info */}
          <SectionCard title="Sevkiyat" danger={pdfMissing}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] self-start pt-0.5">Kargo firması</dt>
                <dd className="font-medium text-right">
                  {(() => {
                    const cc = order.cargoCompany;
                    if (!cc) return <span className="font-normal text-[var(--color-text-muted)]">—</span>;
                    const upper = cc.toUpperCase();
                    if ((CARGO_COMPANIES as readonly string[]).includes(upper))
                      return CARGO_COMPANY_LABELS[upper as CargoCompany];
                    return cc;
                  })()}
                </dd>
              </div>

              {order.cargoBarcode ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] self-start pt-0.5">Takip no</dt>
                  <dd className="flex items-center gap-1.5">
                    <code className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-xs">
                      {order.cargoBarcode}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(order.cargoBarcode ?? "", "Takip no")}
                      className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      {copyFeedback === "Takip no" ? "Kopyalandı" : "Kopyala"}
                    </button>
                  </dd>
                </div>
              ) : null}

              <div className="flex justify-between gap-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] self-start pt-0.5">Sipariş PDF</dt>
                <dd>
                  {order.pdfUrl ? (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={order.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand-blue)] hover:bg-white transition-colors"
                      >
                        Görüntüle
                      </a>
                      <a
                        href={order.pdfUrl}
                        download
                        className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-xs font-medium hover:bg-[var(--color-surface-muted)] transition-colors"
                      >
                        İndir
                      </a>
                    </div>
                  ) : pdfMissing ? (
                    <span className="text-xs font-medium text-red-700">PDF zorunlu — yüklenmemiş!</span>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">Yok</span>
                  )}
                </dd>
              </div>
            </dl>
          </SectionCard>

          {/* Customer */}
          <SectionCard title="Müşteri">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Ad Soyad</dt>
                <dd className="mt-0.5 font-medium">
                  {order.customerName ? (
                    order.customerId ? (
                      <Link
                        to={`/customers/${order.customerId}`}
                        className="text-[var(--color-brand-blue)] hover:underline"
                      >
                        {order.customerName}
                      </Link>
                    ) : (
                      order.customerName
                    )
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {order.endCustomerName ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    Müşteri ismi
                    <span className="ml-1 normal-case font-normal">(bayinin son müşterisi)</span>
                  </dt>
                  <dd className="mt-0.5 font-medium text-[var(--color-brand-blue)]">
                    {order.endCustomerName}
                  </dd>
                </div>
              ) : null}
              {order.customerEmail ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">E-posta</dt>
                  <dd className="mt-0.5 break-all text-[var(--color-text-muted)]">{order.customerEmail}</dd>
                </div>
              ) : null}
              {order.customerPhone ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Telefon</dt>
                  <dd className="mt-0.5 tabular-nums text-[var(--color-text-muted)]">{order.customerPhone}</dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>

          {/* Bu siparişe bağlı talepler */}
          {(order.supportMessages?.length ?? 0) > 0 ? (
            <SectionCard title="Bu siparişe bağlı talepler">
              <div className="space-y-3 text-sm">
                {(order.supportMessages?.length ?? 0) > 0 ? (
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                      Destek talepleri
                    </div>
                    <ul className="space-y-1.5">
                      {order.supportMessages!.map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <Link
                            to={`/orders/talepler?ticketId=${encodeURIComponent(t.id)}`}
                            className="font-medium text-[var(--color-brand-blue)] hover:underline"
                          >
                            {t.subject?.trim() || t.category || "Destek talebi"}
                          </Link>
                          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                            {t.status}
                          </span>
                          <span className="text-[11px] text-[var(--color-text-muted)]">
                            {formatDateTime(t.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          {/* Shipping address */}
          {order.shippingAddress ? (
            <SectionCard title="Teslimat adresi">
              <address className="not-italic text-sm space-y-0.5 text-[var(--color-text)]">
                {order.shippingAddress.fullName ? <div className="font-medium">{order.shippingAddress.fullName}</div> : null}
                {order.shippingAddress.line1 ? <div>{order.shippingAddress.line1}</div> : null}
                {order.shippingAddress.line2 ? <div>{order.shippingAddress.line2}</div> : null}
                {order.shippingAddress.district || order.shippingAddress.city ? (
                  <div>
                    {[order.shippingAddress.district, order.shippingAddress.city].filter(Boolean).join(" / ")}
                  </div>
                ) : null}
                {order.shippingAddress.postalCode ? <div>{order.shippingAddress.postalCode}</div> : null}
                {order.shippingAddress.phone ? (
                  <div className="mt-1 text-[var(--color-text-muted)]">{order.shippingAddress.phone}</div>
                ) : null}
              </address>
            </SectionCard>
          ) : null}

          {/* Billing address */}
          {order.billingAddress ? (
            <SectionCard title="Fatura adresi">
              <address className="not-italic text-sm space-y-0.5 text-[var(--color-text)]">
                {order.billingAddress.fullName ? <div className="font-medium">{order.billingAddress.fullName}</div> : null}
                {order.billingAddress.line1 ? <div>{order.billingAddress.line1}</div> : null}
                {order.billingAddress.line2 ? <div>{order.billingAddress.line2}</div> : null}
                {order.billingAddress.district || order.billingAddress.city ? (
                  <div>
                    {[order.billingAddress.district, order.billingAddress.city].filter(Boolean).join(" / ")}
                  </div>
                ) : null}
                {order.billingAddress.postalCode ? <div>{order.billingAddress.postalCode}</div> : null}
              </address>
            </SectionCard>
          ) : null}

          {/* Notes */}
          {order.notes && order.notes.trim() ? (
            <SectionCard title="Notlar">
              <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{order.notes}</p>
            </SectionCard>
          ) : null}
        </aside>
      </div>

      {/* Tehlikeli bölge — siparişi kalıcı sil (yalnızca admin). En altta,
          yanlışlıkla girilen / istenmeyen siparişleri DB'den temizlemek için. */}
      <SectionCard title="Tehlikeli bölge" danger>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--color-text-muted)]">
            <div className="font-medium text-[var(--color-text)]">Siparişi sil</div>
            <p className="mt-0.5">
              Bu siparişi ve tüm kalemlerini kalıcı olarak siler. Cariden ödenmiş
              ve henüz iade edilmemiş tutar varsa bayinin cari bakiyesine geri
              yüklenir. Bu işlem geri alınamaz.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            className="shrink-0 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 transition-colors"
          >
            Siparişi Sil
          </button>
        </div>
      </SectionCard>

      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-order-title"
          onClick={() => {
            if (!deleteMutation.isPending) setConfirmDelete(false);
          }}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-red-200 bg-red-50 px-5 py-4">
              <h2 id="delete-order-title" className="text-base font-semibold text-red-800">
                Siparişi kalıcı olarak sil
              </h2>
              <p className="mt-1 text-xs text-red-700">
                <span className="font-mono font-medium">
                  {formatOrderNo(order.humanOrderNo, order.orderNumber)}
                </span>{" "}
                ·{" "}
                {formatTRY(order.total)}
                {order.endCustomerName ? ` · ${order.endCustomerName}` : ""} siparişi
                kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  // İKİNCİ ONAY (çift onay): modal birinci, bu ikinci kapı.
                  // Hard-delete kart makbuzu + POS işlem kaydını da kalıcı siler.
                  const sure = window.confirm(
                    `SON ONAY — ${formatOrderNo(order.humanOrderNo, order.orderNumber)} ` +
                      `siparişi, tüm kalemleri ve (varsa) kredi kartı makbuzu + POS ` +
                      `işlem kaydı KALICI olarak silinecek. Bu işlem GERİ ALINAMAZ.\n\n` +
                      `Gerçekten silmek istiyor musun?`,
                  );
                  if (sure) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Siliniyor…" : "Evet, sil"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingUpdate && barcodeDuplicates.length > 0 ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-barcode-title"
          onClick={() => {
            setPendingUpdate(null);
            setBarcodeDuplicates([]);
          }}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-red-200 bg-red-50 px-5 py-4">
              <div>
                <h2
                  id="duplicate-barcode-title"
                  className="text-base font-semibold text-red-800"
                >
                  Bu kargo barkodu daha önce kullanılmış
                </h2>
                <p className="mt-1 text-xs text-red-700">
                  Aynı takip numarasıyla aşağıdaki sipariş(ler) zaten kayıtlı.
                  Yanlışlıkla tekrar kaydetmediğine emin misin?
                </p>
              </div>
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => {
                  setPendingUpdate(null);
                  setBarcodeDuplicates([]);
                }}
                className="-mr-1 -mt-1 rounded-md p-1.5 text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto px-5 py-4">
              <ul className="divide-y divide-[var(--color-border)]">
                {barcodeDuplicates.map((m) => (
                  <li key={m.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/orders/${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono font-semibold text-[var(--color-brand-blue)] hover:underline"
                      >
                        {m.humanOrderNo}
                      </Link>
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs">
                        {ORDER_STATUS_LABELS[m.status as OrderStatus] ?? m.status}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
                      <div>
                        <span className="font-medium text-[var(--color-text)]">
                          Bayi:
                        </span>{" "}
                        {m.customerName ?? m.customerEmail ?? "—"}
                      </div>
                      <div>
                        <span className="font-medium text-[var(--color-text)]">
                          Son müşteri:
                        </span>{" "}
                        {m.endCustomerName ?? "—"}
                      </div>
                      <div>
                        <span className="font-medium text-[var(--color-text)]">
                          Kargo:
                        </span>{" "}
                        {m.cargoCompany ?? "—"}
                      </div>
                      <div>
                        <span className="font-medium text-[var(--color-text)]">
                          Barkod:
                        </span>{" "}
                        <code className="rounded bg-[var(--color-surface-muted)] px-1 py-0.5 font-mono">
                          {m.cargoBarcode ?? m.trackingNumber ?? "—"}
                        </code>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setPendingUpdate(null);
                  setBarcodeDuplicates([]);
                }}
                disabled={updateMutation.isPending}
                className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  const patch = pendingUpdate;
                  setPendingUpdate(null);
                  setBarcodeDuplicates([]);
                  if (patch) updateMutation.mutate(patch);
                }}
                disabled={updateMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? "Kaydediliyor…" : "Yine de kaydet"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

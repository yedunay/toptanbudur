import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Eye,
  Megaphone,
  MousePointerClick,
  Pencil,
  Plus,
  Power,
  Trash2,
  X as XIcon,
} from "lucide-react";
import { useRequireAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { PopupFormDialog } from "../components/popups/PopupFormDialog";
import {
  deletePopup,
  fetchPopups,
  updatePopup,
  POPUP_AUDIENCE_LABELS,
  POPUP_FREQUENCY_LABELS,
  POPUP_POSITION_LABELS,
  POPUP_SIZE_LABELS,
  POPUP_STATUS_LABELS,
  type Popup,
  type PopupStatus,
} from "../lib/popups";

type TabKey = "active" | "scheduled" | "expired" | "inactive" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Yayında" },
  { key: "scheduled", label: "Zamanlanmış" },
  { key: "expired", label: "Geçmiş" },
  { key: "inactive", label: "Pasif" },
  { key: "all", label: "Tümü" },
];

const STATUS_STYLES: Record<PopupStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  scheduled: "bg-blue-50 text-blue-700 ring-blue-200",
  expired: "bg-slate-100 text-slate-600 ring-slate-200",
  inactive: "bg-amber-50 text-amber-700 ring-amber-200",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function dateRangeLabel(popup: Popup): string {
  if (!popup.startsAt && !popup.endsAt) return "Süresiz · hemen";
  const start = popup.startsAt ? formatDateTime(popup.startsAt) : "Hemen";
  const end = popup.endsAt ? formatDateTime(popup.endsAt) : "Süresiz";
  return `${start} → ${end}`;
}

function audienceLabel(popup: Popup): string {
  const base = POPUP_AUDIENCE_LABELS[popup.audience];
  if (popup.audience === "SEGMENT" && popup.segment) return `${base}: ${popup.segment}`;
  if (popup.audience === "SPECIFIC") return `${base} (${popup.customerIds.length})`;
  return base;
}

function popupTitle(popup: Popup): string {
  return (popup.title && popup.title.trim()) || "Başlıksız duyuru";
}

/** Kart altı kısa özet — legacy gövde ya da blok içeriğinden türetilir. */
function popupSummary(popup: Popup): string {
  if (popup.body && popup.body.trim()) return popup.body;
  const blocks = popup.content ?? [];
  if (blocks.length > 0) {
    const firstText = blocks.find(
      (b) => b.type === "heading" || b.type === "text" || b.type === "hero" || b.type === "callout",
    );
    const txt =
      firstText && "text" in firstText
        ? firstText.text
        : firstText && "title" in firstText
          ? firstText.title
          : "";
    const kinds = new Set(blocks.map((b) => b.type));
    const tags = [
      kinds.has("image") ? "görsel" : null,
      kinds.has("video") ? "video" : null,
    ].filter(Boolean);
    const suffix = tags.length ? ` · ${tags.join(", ")}` : "";
    return (txt ? `${txt}` : `${blocks.length} blok`) + suffix;
  }
  return "—";
}

/** Kartta gösterilecek küçük görsel (legacy görsel ya da ilk görsel bloğu). */
function popupThumb(popup: Popup): string | null {
  if (popup.imageUrl) return popup.imageUrl;
  const imgBlock = (popup.content ?? []).find((b) => b.type === "image");
  return imgBlock && imgBlock.type === "image" ? imgBlock.url : null;
}

export default function PopupsPage(): React.ReactElement | null {
  useDocumentTitle("Pop-up / Duyurular");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Popup | null>(null);

  const popupsQuery = useQuery({
    queryKey: ["popups"],
    queryFn: fetchPopups,
    enabled: authed,
  });

  const popups = useMemo(() => popupsQuery.data ?? [], [popupsQuery.data]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = {
      active: 0,
      scheduled: 0,
      expired: 0,
      inactive: 0,
      all: popups.length,
    };
    for (const p of popups) c[p.status] += 1;
    return c;
  }, [popups]);

  const visible = useMemo(() => {
    const list = activeTab === "all" ? popups : popups.filter((p) => p.status === activeTab);
    // Öncelik yüksekten düşüğe, sonra en yeni güncellenen üstte.
    return [...list].sort(
      (a, b) =>
        b.priority - a.priority ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [popups, activeTab]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePopup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popups"] });
      toast.push("success", "Pop-up silindi.");
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız."),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updatePopup(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popups"] });
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Güncelleme başarısız."),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(popup: Popup) {
    setEditing(popup);
    setDialogOpen(true);
  }

  function onDelete(popup: Popup) {
    if (!window.confirm(`"${popupTitle(popup)}" pop-up'ı silinsin mi? Bu işlem geri alınamaz.`)) {
      return;
    }
    deleteMutation.mutate(popup.id);
  }

  if (!authed) return null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Megaphone size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Pop-up / Duyurular</h1>
            <p className="text-sm text-slate-500">
              Müşteri ekranında çıkan duyuruları oluştur, zamanla ve takip et.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={16} />
          Yeni Pop-up
        </button>
      </div>

      {/* Sekmeler */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border,#e2e8f0)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs ${
                activeTab === tab.key ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {counts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Liste */}
      {popupsQuery.isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Yükleniyor…</p>
      ) : popupsQuery.isError ? (
        <p className="py-12 text-center text-sm text-red-600">
          Pop-up'lar yüklenemedi. Sayfayı yenileyin.
        </p>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visible.map((popup) => (
            <PopupCard
              key={popup.id}
              popup={popup}
              onEdit={() => openEdit(popup)}
              onDelete={() => onDelete(popup)}
              onToggle={() =>
                toggleMutation.mutate({ id: popup.id, isActive: !popup.isActive })
              }
            />
          ))}
        </ul>
      )}

      {dialogOpen && (
        <PopupFormDialog popup={editing} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

// ---- Kart -----------------------------------------------------------------

interface PopupCardProps {
  popup: Popup;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

function PopupCard({ popup, onEdit, onDelete, onToggle }: PopupCardProps) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-[var(--color-border,#e2e8f0)] bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex gap-3 p-4">
        {popupThumb(popup) ? (
          <img
            src={popupThumb(popup)!}
            alt=""
            className="h-16 w-16 flex-shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
          />
        ) : (
          <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-300 ring-1 ring-slate-100">
            <Megaphone size={22} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold text-slate-900">{popupTitle(popup)}</h3>
            <span
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[popup.status]}`}
            >
              {POPUP_STATUS_LABELS[popup.status]}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{popupSummary(popup)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <CalendarClock size={13} className="flex-shrink-0 text-slate-400" />
          <span className="truncate">{dateRangeLabel(popup)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>{audienceLabel(popup)}</Tag>
          <Tag>{POPUP_FREQUENCY_LABELS[popup.frequency]}</Tag>
          <Tag>{POPUP_POSITION_LABELS[popup.position]}</Tag>
          <Tag>{popup.widthPx ? `${popup.widthPx}px` : POPUP_SIZE_LABELS[popup.size]}</Tag>
        </div>
      </div>

      {/* İstatistik */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
        <Stat icon={<Eye size={14} />} label="Görüldü" value={popup.stats.seen} />
        <Stat icon={<MousePointerClick size={14} />} label="Tıklandı" value={popup.stats.clicks} />
        <Stat icon={<XIcon size={14} />} label="Kapatıldı" value={popup.stats.dismissed} />
      </div>

      {/* Aksiyonlar */}
      <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          title={popup.isActive ? "Pasifleştir" : "Aktifleştir"}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-50 ${
            popup.isActive ? "text-emerald-600" : "text-slate-400"
          }`}
        >
          <Power size={14} />
          {popup.isActive ? "Aktif" : "Pasif"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Pencil size={14} />
          Düzenle
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 size={14} />
          Sil
        </button>
      </div>
    </li>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {children}
    </span>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function Stat({ icon, label, value }: StatProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2">
      <span className="flex items-center gap-1 text-slate-400">{icon}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border,#e2e8f0)] bg-slate-50/50 py-16">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-300 ring-1 ring-slate-200">
        <Megaphone size={24} />
      </span>
      <p className="text-sm text-slate-500">Bu sekmede pop-up yok.</p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        <Plus size={16} />
        İlk pop-up'ı oluştur
      </button>
    </div>
  );
}

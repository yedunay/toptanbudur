import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag as TagIcon, Plus, X, Check } from "lucide-react";
import { useToast } from "./Toast";
import {
  createCustomerTag,
  fetchCustomerTags,
  setCustomerTags,
  type AutoTag,
  type CustomerTag,
} from "../lib/customer-tags";
import { canAccess } from "../lib/permissions";

const POPUP_WIDTH = 260;

/**
 * Bir müşterinin etiketlerini satır-içi gösterir ve düzenler (YALNIZ ADMIN).
 * - Otomatik etiketler (autoTags) salt-okunur (kupa/kırmızı vb.).
 * - Manuel etiketler çip; × ile kaldırılır.
 * - Etiket yoksa silik "Etiket ekle"; varsa küçük "+".
 * - Popup, KIRPILMAMASI için document.body'ye PORTAL + position:fixed ile
 *   açılır (tablo satırı / kartın overflow:hidden'ına takılmaz). Butona göre
 *   konumlanır, altta yer yoksa yukarı açılır, kaydırınca yeniden konumlanır.
 * - Etiket uçları 'customers' sayfa iznine bağlı; izinsiz kullanıcıda (ör.
 *   yalnız Siparişler yetkili çalışan) SALT-OKUNUR: ekle/× düğmesi çizilmez,
 *   popup açılmaz, etiket listesi sorgusu hiç atılmaz — yoksa sessiz 403.
 */
export function CustomerTagEditor({
  customerId,
  tags,
  autoTags = [],
  onChanged,
}: {
  customerId: string;
  tags: CustomerTag[];
  autoTags?: AutoTag[];
  onChanged?: () => void;
}): React.ReactElement {
  const canEdit = canAccess("customers");
  const toast = useToast();
  const qc = useQueryClient();
  const [assigned, setAssigned] = useState<CustomerTag[]>(tags);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setAssigned(tags);
  }, [tags]);

  const allTagsQuery = useQuery({
    queryKey: ["customer-tags"],
    queryFn: fetchCustomerTags,
    enabled: open && canEdit,
    staleTime: 30_000,
  });
  const allTags = allTagsQuery.data?.tags ?? [];
  const assignedIds = new Set(assigned.map((t) => t.id));

  // Popup'ı tetikleyen butona göre konumla (fixed, viewport-göreli).
  function reposition() {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 320 && r.top > 320; // altta yer yoksa yukarı aç
    const left = Math.max(
      8,
      Math.min(r.left, window.innerWidth - POPUP_WIDTH - 8),
    );
    const top = up ? r.top - 6 : r.bottom + 6;
    setPos({ left, top, up });
  }

  function openPopup(e: React.MouseEvent) {
    anchorRef.current = e.currentTarget as HTMLElement;
    setOpen(true);
  }

  // Açılınca konumla; scroll/resize'da yeniden konumla (capture = iç scroll'lar da).
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const on = () => reposition();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [open]);

  async function commit(next: CustomerTag[]) {
    setBusy(true);
    const prev = assigned;
    setAssigned(next);
    try {
      await setCustomerTags(
        customerId,
        next.map((t) => t.id),
      );
      onChanged?.();
    } catch (e) {
      setAssigned(prev);
      toast.push("error", e instanceof Error ? e.message : "Etiket kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(tag: CustomerTag) {
    const next = assignedIds.has(tag.id)
      ? assigned.filter((t) => t.id !== tag.id)
      : [...assigned, tag];
    void commit(next);
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const tag = await createCustomerTag(name, newColor);
      setNewName("");
      void qc.invalidateQueries({ queryKey: ["customer-tags"] });
      await commit([...assigned, tag]);
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Etiket oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {autoTags.map((t) => (
        <Chip key={t.key} color={t.color} icon={t.icon} label={t.name} />
      ))}

      {assigned.map((t) => (
        <Chip
          key={t.id}
          color={t.color}
          label={t.name}
          onRemove={busy || !canEdit ? undefined : () => toggle(t)}
        />
      ))}

      {!canEdit ? null : assigned.length === 0 && autoTags.length === 0 ? (
        <button
          type="button"
          onClick={(e) => (open ? setOpen(false) : openPopup(e))}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)] opacity-60 transition hover:opacity-100"
        >
          <TagIcon className="h-3 w-3" />
          Etiket ekle
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => (open ? setOpen(false) : openPopup(e))}
          title="Etiket ekle"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] opacity-60 transition hover:opacity-100"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}

      {open &&
        pos &&
        createPortal(
          <>
            {/* Kapatma zemini */}
            <div
              className="fixed inset-0 z-[90]"
              onClick={() => setOpen(false)}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {/* Popup — body seviyesinde, kırpılmaz */}
            <div
              className="fixed z-[100] w-[260px] rounded-xl border border-[var(--color-border)] bg-white p-2.5 shadow-2xl"
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.up ? "translateY(-100%)" : undefined,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Etiketler
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="max-h-44 space-y-0.5 overflow-y-auto">
                {allTagsQuery.isLoading ? (
                  <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">Yükleniyor…</p>
                ) : allTags.length === 0 ? (
                  <p className="px-1 py-1.5 text-xs text-[var(--color-text-muted)]">
                    Henüz etiket yok — aşağıdan oluştur.
                  </p>
                ) : (
                  allTags.map((t) => {
                    const on = assignedIds.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(t)}
                        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="flex-1 truncate text-[var(--color-text)]">{t.name}</span>
                        {on && <Check className="h-3.5 w-3.5 text-[var(--color-brand-blue)]" />}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Yeni etiket
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    title="Etiket rengi"
                    className="h-7 w-8 shrink-0 cursor-pointer rounded border border-[var(--color-border)] bg-white p-0.5"
                  />
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createAndAssign();
                    }}
                    placeholder="Etiket adı…"
                    maxLength={40}
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs outline-none focus:border-[var(--color-brand-blue)]"
                  />
                  <button
                    type="button"
                    disabled={busy || !newName.trim()}
                    onClick={() => void createAndAssign()}
                    className="shrink-0 rounded-lg bg-[var(--color-brand-blue)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Ekle
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** Renkli etiket çipi. onRemove verilirse × gösterir. */
function Chip({
  color,
  label,
  icon,
  onRemove,
}: {
  color: string;
  label: string;
  icon?: string;
  onRemove?: () => void;
}): React.ReactElement {
  return (
    <span
      className="inline-flex max-w-[160px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        backgroundColor: `${color}1f`,
        color,
        border: `1px solid ${color}55`,
      }}
      title={label}
    >
      {icon ? <span className="text-[11px] leading-none">{icon}</span> : null}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
          title="Kaldır"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

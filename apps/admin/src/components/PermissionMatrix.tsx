import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPermissionCatalog,
  fetchUserPermissions,
  updateUserPermissions,
  type EffectivePermissions,
  type OverrideUpdate,
  type PermissionCatalog,
  type Role,
} from "../lib/admin-permissions";
import type { PageKey } from "../lib/permission-keys";
import { useToast } from "./Toast";

/**
 * Sayfa-bazında izin matrisi. Üç durumlu (tri-state) toggle:
 *   - "default" → rol şablonu karar versin (override yok)
 *   - "grant"   → açıkça AÇ (override true)
 *   - "deny"    → açıkça KAPAT (override false)
 *
 * OWNER kullanıcılar için matrix render edilmez — backend zaten override
 * kabul etmez (mutlak yetki). Bunun yerine bilgilendirme metni gösterilir.
 *
 * `dirty` state'i mutation gönderilene kadar lokalde tutulur — backend
 * her zaman tüm `effective` döndüğü için kaydet sonrası query
 * invalidate ile tek doğru kaynağa düşeriz.
 */

type Tri = "default" | "grant" | "deny";

interface PermissionMatrixProps {
  userId: string;
  userRole: Role;
}

export default function PermissionMatrix({
  userId,
  userRole,
}: PermissionMatrixProps): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const catalogQuery = useQuery<PermissionCatalog>({
    queryKey: ["permission-catalog"],
    queryFn: fetchPermissionCatalog,
    // Catalog session başına 1 kez — value değişmez, server-driven.
    staleTime: Infinity,
  });

  const effectiveQuery = useQuery<EffectivePermissions>({
    queryKey: ["user-permissions", userId],
    queryFn: () => fetchUserPermissions(userId),
  });

  // Local dirty buffer — toggle'lar buraya işlenir, "Kaydet"e basılınca
  // tek seferde PUT atılır.
  const [pending, setPending] = useState<Map<PageKey, Tri>>(new Map());

  // Kullanıcı değiştiğinde dirty buffer'ı sıfırla — yanlış kullanıcıya
  // override yazma riskini önler.
  useEffect(() => {
    setPending(new Map());
  }, [userId]);

  const mutation = useMutation({
    mutationFn: async (updates: OverrideUpdate[]) =>
      updateUserPermissions(userId, updates),
    onSuccess: (data) => {
      queryClient.setQueryData(["user-permissions", userId], data);
      setPending(new Map());
      toast.push("success", "Yetkiler güncellendi");
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Yetkiler güncellenemedi",
      ),
  });

  // OWNER için matrix yok — mutlak yetki bilgisi.
  if (userRole === "OWNER") {
    return <OwnerNotice />;
  }

  if (catalogQuery.isLoading || effectiveQuery.isLoading) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Yetkiler yükleniyor…
      </p>
    );
  }

  if (catalogQuery.isError || effectiveQuery.isError) {
    const msg =
      (catalogQuery.error instanceof Error && catalogQuery.error.message) ||
      (effectiveQuery.error instanceof Error && effectiveQuery.error.message) ||
      "Yetkiler yüklenemedi";
    return <p className="text-sm text-red-600">{msg}</p>;
  }

  const catalog = catalogQuery.data;
  const eff = effectiveQuery.data;
  if (!catalog || !eff) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">Yetkiler yükleniyor…</p>
    );
  }

  // Server-side override map → tri-state'e çevir.
  const baseTri = new Map<PageKey, Tri>();
  for (const o of eff.overrides) {
    baseTri.set(o.pageKey, o.granted ? "grant" : "deny");
  }
  // Eksik sayfaları "default" olarak doldur.
  for (const p of catalog.pages) {
    if (!baseTri.has(p.key)) baseTri.set(p.key, "default");
  }

  // Pending değişiklikleri uygula → effective tri.
  function triFor(key: PageKey): Tri {
    return pending.get(key) ?? baseTri.get(key) ?? "default";
  }

  function setTri(key: PageKey, value: Tri): void {
    const base = baseTri.get(key) ?? "default";
    setPending((prev) => {
      const next = new Map(prev);
      if (value === base) {
        // Default'a dönüş = pending'den çıkar (gereksiz PUT yollamayalım).
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  }

  const dirtyCount = pending.size;
  const defaults = new Set(eff.defaults);
  // Yasak liste YOK — patron her sayfayı/yetkiyi açabilir (2026-07-31 kararı).
  const memberBlocked = new Set<PageKey>();

  function handleSave(): void {
    const updates: OverrideUpdate[] = [];
    for (const [pageKey, tri] of pending.entries()) {
      updates.push({
        pageKey,
        granted: tri === "default" ? null : tri === "grant",
      });
    }
    if (updates.length === 0) return;
    mutation.mutate(updates);
  }

  function handleReset(): void {
    setPending(new Map());
  }

  /**
   * Toplu karar: tüm satırları tek seferde "Açık"/"Kapalı"/"Varsayılan"
   * yap (MEMBER'da yapısal kapalı sayfalar atlanır — backend zaten reddeder).
   * Yalnız lokal buffer'ı doldurur; "Kaydet"e basılınca PUT atılır.
   *
   * `pages` sabitlemesi: function declaration hoist edildiği için TS,
   * yukarıdaki `if (!catalog) return` daraltmasını closure'a taşımıyor.
   */
  const bulkPages = catalog.pages;
  function handleBulk(value: Tri): void {
    setPending(() => {
      const next = new Map<PageKey, Tri>();
      for (const p of bulkPages) {
        if (memberBlocked.has(p.key)) continue;
        const base = baseTri.get(p.key) ?? "default";
        if (value !== base) next.set(p.key, value);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <MatrixHeader
        role={userRole}
        roleDefaults={catalog.roleDefaults}
        dirtyCount={dirtyCount}
        saving={mutation.isPending}
        onSave={handleSave}
        onReset={handleReset}
        onBulk={handleBulk}
      />

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Sayfa</th>
              <th className="px-4 py-3 font-medium">Rol Varsayılanı</th>
              <th className="px-4 py-3 font-medium">Karar</th>
              <th className="px-4 py-3 font-medium text-right">Sonuç</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {catalog.pages.map((p) => {
              const isBlocked = memberBlocked.has(p.key);
              const isDefault = defaults.has(p.key);
              const tri = triFor(p.key);
              const effective = isBlocked
                ? false
                : tri === "grant"
                  ? true
                  : tri === "deny"
                    ? false
                    : isDefault;
              const isDirty = pending.has(p.key);
              return (
                <tr
                  key={p.key}
                  className={
                    "hover:bg-[var(--color-surface-muted)]/50 " +
                    (isBlocked ? "opacity-60 " : "") +
                    (isDirty ? "bg-amber-50/40" : "")
                  }
                >
                  <td className="px-4 py-3 font-medium">{p.label}</td>
                  <td className="px-4 py-3">
                    <DefaultBadge granted={isDefault} />
                  </td>
                  <td className="px-4 py-3">
                    {isBlocked ? (
                      <span
                        className="inline-flex rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 ring-1 ring-zinc-200"
                        title="Muhasebe/kâr ve global ayar sayfaları çalışan (MEMBER) rolüne yapısal olarak kapalıdır"
                      >
                        Çalışana kapalı
                      </span>
                    ) : (
                      <TriSwitch
                        value={tri}
                        onChange={(v) => setTri(p.key, v)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ResultBadge granted={effective} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <MatrixLegend />
    </div>
  );
}

// ---------------- subcomponents ----------------

function MatrixHeader({
  role,
  roleDefaults,
  dirtyCount,
  saving,
  onSave,
  onReset,
  onBulk,
}: {
  role: Role;
  roleDefaults: PermissionCatalog["roleDefaults"];
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  onBulk: (value: Tri) => void;
}): React.ReactElement {
  const roleDefault = roleDefaults[role];
  const summary =
    roleDefault === "*"
      ? "Tüm sayfalar"
      : `${roleDefault.length} sayfa varsayılan açık`;

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold">Sayfa İzinleri</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Rol şablonu: <span className="font-medium">{role}</span> — {summary}.
          Override'lar burada rol varsayılanını ezer.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Toplu:</span>
          <button
            type="button"
            onClick={() => onBulk("grant")}
            disabled={saving}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Tümünü Aç
          </button>
          <button
            type="button"
            onClick={() => onBulk("deny")}
            disabled={saving}
            className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Tümünü Kapat
          </button>
          <button
            type="button"
            onClick={() => onBulk("default")}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Tümünü Varsayılana Dön
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {dirtyCount > 0 && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {dirtyCount} bekleyen değişiklik
          </span>
        )}
        <button
          type="button"
          onClick={onReset}
          disabled={dirtyCount === 0 || saving}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Geri al
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={dirtyCount === 0 || saving}
          className="rounded-md bg-[var(--color-brand-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

function TriSwitch({
  value,
  onChange,
}: {
  value: Tri;
  onChange: (v: Tri) => void;
}): React.ReactElement {
  const options: Array<{ key: Tri; label: string; className: string }> = [
    {
      key: "deny",
      label: "Kapalı",
      className:
        "data-[on=true]:bg-rose-600 data-[on=true]:text-white data-[on=true]:border-rose-600",
    },
    {
      key: "default",
      label: "Varsayılan",
      className:
        "data-[on=true]:bg-zinc-700 data-[on=true]:text-white data-[on=true]:border-zinc-700",
    },
    {
      key: "grant",
      label: "Açık",
      className:
        "data-[on=true]:bg-emerald-600 data-[on=true]:text-white data-[on=true]:border-emerald-600",
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="İzin kararı"
      className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]"
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={value === opt.key}
          data-on={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={
            "border-r border-[var(--color-border)] last:border-r-0 bg-white px-3 py-1 text-xs hover:bg-[var(--color-surface-muted)] transition " +
            opt.className
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function DefaultBadge({ granted }: { granted: boolean }): React.ReactElement {
  return (
    <span
      className={
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium " +
        (granted
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200")
      }
    >
      {granted ? "Açık" : "Kapalı"}
    </span>
  );
}

function ResultBadge({ granted }: { granted: boolean }): React.ReactElement {
  return (
    <span
      className={
        "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold " +
        (granted
          ? "bg-emerald-600 text-white"
          : "bg-rose-600 text-white")
      }
    >
      {granted ? "Erişim VAR" : "Erişim YOK"}
    </span>
  );
}

function MatrixLegend(): React.ReactElement {
  return (
    <details className="rounded-xl border border-[var(--color-border)] bg-white p-4 text-xs text-[var(--color-text-muted)]">
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
        Karar nasıl işliyor?
      </summary>
      <ul className="mt-3 space-y-2 list-disc pl-5">
        <li>
          <strong>Varsayılan:</strong> rol şablonu karar verir. ADMIN'in açık
          olduğu bir sayfa "Varsayılan" iken Açık kalır.
        </li>
        <li>
          <strong>Açık:</strong> kullanıcıya bu sayfaya açık erişim ver — rol
          şablonunda olmasa bile.
        </li>
        <li>
          <strong>Kapalı:</strong> kullanıcıya bu sayfayı kapat — rol
          şablonunda olsa bile.
        </li>
        <li>
          Kaydedilen karar API tarafında ANINDA uygulanır (sunucu izinleri
          her istekte canlı kontrol eder, en fazla 30 sn önbellek). Kullanıcının
          menüsü ise açık sekmede en geç 1 dk içinde kendini tazeler.
        </li>
        <li>
          <strong>⚙ Yetki satırları:</strong> "Maliyet &amp; Kâr Görebilir" ve
          "Para İşlemi Yapabilir" sayfa değil, sayfa İÇİ yetkidir. Kapalıyken
          kullanıcı o sayfaya girer ama alış maliyeti/kâr rakamlarını görmez,
          bakiye ve onay işlemlerini yapamaz.
        </li>
      </ul>
    </details>
  );
}

function OwnerNotice(): React.ReactElement {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
      <p className="font-medium text-amber-900">
        OWNER mutlak yetkiye sahip
      </p>
      <p className="mt-1 text-amber-800">
        OWNER kullanıcılarda sayfa-bazlı override uygulanamaz. Yetkiyi
        kısıtlamak için önce kullanıcının rolünü ADMIN ya da MEMBER yapın,
        sonra bu sekmeden gerekli override'ları işleyin.
      </p>
      <p className="mt-1 text-amber-800">
        Sahibin kendi yetkisini kaybetmesini önlemek için son OWNER'ın rolü
        değiştirilemez.
      </p>
    </div>
  );
}


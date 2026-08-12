import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  deleteCategory,
  fetchCategoryTree,
  updateCategory,
  type CategoryNode,
} from "../lib/categories";
import CategoryCreateModal from "../components/CategoryCreateModal";
import { useToast } from "../components/Toast";

interface FlatRow {
  node: CategoryNode;
  depth: number;
}

function flatten(nodes: CategoryNode[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: CategoryNode[], depth: number): void => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.children.length > 0) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

export default function CategoriesPage(): React.ReactElement | null {
  useDocumentTitle("Kategoriler");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [filter, setFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  const treeQuery = useQuery({
    queryKey: ["admin-categories"],
    queryFn: fetchCategoryTree,
    enabled: authed,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      updateCategory(input.id, { name: input.name }),
    onSuccess: () => {
      toast.push("success", "Kategori güncellendi");
      setEditingId(null);
      setEditingName("");
      void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Güncelleme başarısız";
      toast.push("error", message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      toast.push("success", "Kategori silindi");
      void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Silme başarısız";
      toast.push("error", message);
    },
  });

  const flat = useMemo<FlatRow[]>(() => {
    if (!treeQuery.data) return [];
    return flatten(treeQuery.data);
  }, [treeQuery.data]);

  const filtered = useMemo<FlatRow[]>(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return flat;
    return flat.filter(
      (row) =>
        row.node.name.toLowerCase().includes(q) ||
        row.node.path.toLowerCase().includes(q),
    );
  }, [flat, filter]);

  const totalCount = flat.length;
  const totalProductCount = useMemo<number>(
    () => flat.reduce((sum, row) => sum + row.node.productCount, 0),
    [flat],
  );

  const beginEdit = (node: CategoryNode): void => {
    setEditingId(node.id);
    setEditingName(node.name);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEdit = (): void => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (trimmed.length < 2) {
      toast.push("error", "Kategori adı en az 2 karakter olmalı.");
      return;
    }
    if (trimmed.length > 120) {
      toast.push("error", "Kategori adı en fazla 120 karakter olabilir.");
      return;
    }
    updateMutation.mutate({ id: editingId, name: trimmed });
  };

  const askDelete = (node: CategoryNode): void => {
    if (node.children.length > 0) {
      toast.push(
        "error",
        `"${node.name}" altında ${node.children.length} alt kategori var. Önce alt kategorileri silin veya taşıyın.`,
      );
      return;
    }
    if (node.productCount > 0) {
      toast.push(
        "error",
        `"${node.name}" altında ${node.productCount} ürün var. Önce ürünleri başka bir kategoriye taşıyın.`,
      );
      return;
    }
    const ok = window.confirm(
      `"${node.path}" kategorisini silmek istediğinize emin misiniz?`,
    );
    if (!ok) return;
    deleteMutation.mutate(node.id);
  };

  const openCreate = (parentId: string | null): void => {
    setCreateParentId(parentId);
    setShowCreate(true);
  };

  if (!authed) return null;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            Kategoriler
          </h1>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {totalCount} kategori · {totalProductCount} bağlı ürün
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Ad veya yol ara…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
          />
          <button
            type="button"
            onClick={() => openCreate(null)}
            className="rounded-md bg-[var(--color-brand-blue)] px-3 py-2 text-sm text-white hover:bg-[var(--color-brand-navy)] inline-flex items-center gap-1.5"
          >
            <span aria-hidden="true">+</span> Yeni kök kategori
          </button>
        </div>
      </header>

      {treeQuery.isLoading ? (
        <div className="rounded-md border border-[var(--color-border)] bg-white px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
          Yükleniyor…
        </div>
      ) : treeQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Kategoriler yüklenemedi:{" "}
          {treeQuery.error instanceof Error
            ? treeQuery.error.message
            : "Bilinmeyen hata"}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] bg-white px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
          {filter.trim().length > 0
            ? "Arama ile eşleşen kategori yok."
            : "Henüz kategori yok. Yukarıdaki 'Yeni kök kategori' butonu ile başlayın."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-white">
          <table className="min-w-full divide-y divide-[var(--color-border)]">
            <thead className="bg-[var(--color-surface-muted)]">
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-2 font-medium">Kategori</th>
                <th className="px-4 py-2 font-medium">Yol</th>
                <th className="px-4 py-2 font-medium text-right">Ürün</th>
                <th className="px-4 py-2 font-medium text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)] text-sm">
              {filtered.map(({ node, depth }) => {
                const isEditing = editingId === node.id;
                const isSaving =
                  updateMutation.isPending && updateMutation.variables?.id === node.id;
                const isDeleting =
                  deleteMutation.isPending && deleteMutation.variables === node.id;
                return (
                  <tr key={node.id} className="hover:bg-[var(--color-surface-muted)]/50">
                    <td className="px-4 py-2">
                      <div
                        className="flex items-center gap-2"
                        style={{ paddingLeft: `${depth * 16}px` }}
                      >
                        {depth > 0 ? (
                          <span
                            className="text-[var(--color-text-muted)]"
                            aria-hidden="true"
                          >
                            ↳
                          </span>
                        ) : null}
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingName}
                            autoFocus
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveEdit();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                            maxLength={120}
                          />
                        ) : (
                          <span className="font-medium text-[var(--color-text)]">
                            {node.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {node.path}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                      {node.productCount > 0 ? (
                        <Link
                          to={`/products?categorySlug=${encodeURIComponent(node.slug)}`}
                          className="text-[var(--color-brand-blue)] hover:underline"
                          title={`"${node.name}" kategorisindeki ürünleri göster`}
                        >
                          {node.productCount}
                        </Link>
                      ) : (
                        node.productCount
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={isSaving}
                              className="rounded-md bg-[var(--color-brand-blue)] px-2.5 py-1 text-xs text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
                            >
                              {isSaving ? "Kaydediliyor…" : "Kaydet"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                            >
                              İptal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openCreate(node.id)}
                              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                              title="Bu kategorinin altına yeni alt kategori ekle"
                            >
                              + Alt
                            </button>
                            <button
                              type="button"
                              onClick={() => beginEdit(node)}
                              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => askDelete(node)}
                              disabled={isDeleting}
                              className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              {isDeleting ? "Siliniyor…" : "Sil"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && treeQuery.data ? (
        <CategoryCreateModal
          tree={treeQuery.data}
          defaultParentId={createParentId}
          onClose={() => {
            setShowCreate(false);
            setCreateParentId(null);
          }}
          onCreated={(created) => {
            toast.push("success", `"${created.name}" kategorisi oluşturuldu`);
            void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
          }}
        />
      ) : null}
    </div>
  );
}

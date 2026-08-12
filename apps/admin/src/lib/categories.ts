import { apiFetch } from "./auth";

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  productCount: number;
  children: CategoryNode[];
}

export interface CategorySummary {
  id: string;
  name: string;
  path: string;
  depth: number;
}

export async function fetchCategoryTree(): Promise<CategoryNode[]> {
  return apiFetch<CategoryNode[]>("/admin/categories");
}

export async function createCategory(input: {
  name: string;
  parentId?: string | null;
}): Promise<CategorySummary> {
  return apiFetch<CategorySummary>("/admin/categories", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      parentId: input.parentId ?? undefined,
    }),
  });
}

export async function updateCategory(
  id: string,
  input: { name: string },
): Promise<CategorySummary> {
  return apiFetch<CategorySummary>(`/admin/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: input.name }),
  });
}

export async function deleteCategory(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/admin/categories/${id}`, {
    method: "DELETE",
  });
}

// Ağacı tek seviyeli, indent'lenmiş bir liste haline getir; <select> ve dropdown
// kullanımı için. Path zaten "A > B > C" şeklinde olduğundan onu da göstermek
// kullanıcının daha kolay seçim yapmasını sağlar.
export interface FlatCategoryOption {
  id: string;
  label: string;
  depth: number;
  path: string;
}

export function flattenCategoryTree(
  nodes: CategoryNode[],
): FlatCategoryOption[] {
  const out: FlatCategoryOption[] = [];
  const walk = (list: CategoryNode[]): void => {
    for (const node of list) {
      out.push({
        id: node.id,
        label: `${"  ".repeat(node.depth)}${node.name}`,
        depth: node.depth,
        path: node.path,
      });
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

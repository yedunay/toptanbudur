import { apiFetch } from "./auth";

/** Manuel müşteri etiketi (admin oluşturur). */
export interface CustomerTag {
  id: string;
  name: string;
  color: string; // hex "#RRGGBB"
}
export interface CustomerTagWithCount extends CustomerTag {
  customerCount: number;
}
/** Otomatik (sistem) etiket — veriden hesaplanır, salt-okunur. */
export interface AutoTag {
  key: string;
  name: string;
  color: string;
  icon?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchCustomerTags(): Promise<{
  tags: CustomerTagWithCount[];
  autoTags: AutoTag[];
}> {
  const r = await apiFetch<{
    tags: CustomerTagWithCount[];
    autoTags: AutoTag[];
  }>("/admin/customer-tags");
  return { tags: r.tags ?? [], autoTags: r.autoTags ?? [] };
}

export async function createCustomerTag(
  name: string,
  color: string,
): Promise<CustomerTag> {
  const r = await apiFetch<{ tag: CustomerTag }>("/admin/customer-tags", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, color }),
  });
  return r.tag;
}

export async function updateCustomerTag(
  id: string,
  patch: { name?: string; color?: string },
): Promise<CustomerTag> {
  const r = await apiFetch<{ tag: CustomerTag }>(`/admin/customer-tags/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  return r.tag;
}

export async function deleteCustomerTag(id: string): Promise<void> {
  await apiFetch(`/admin/customer-tags/${id}`, { method: "DELETE" });
}

/** Bir müşterinin manuel etiketlerini verilen sete eşitler (set-all). */
export async function setCustomerTags(
  customerId: string,
  tagIds: string[],
): Promise<string[]> {
  const r = await apiFetch<{ tagIds: string[] }>(
    `/admin/customers/${customerId}/tags`,
    {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ tagIds }),
    },
  );
  return r.tagIds ?? [];
}

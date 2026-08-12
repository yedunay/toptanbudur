import { API_BASE } from "@/lib/api";

/**
 * Basit Kargo konum proxy'si (backend `/api/basitkargo/*`). Token backend'de
 * kalır — client asla token görmez. Hata durumunda boş dizi döner (form
 * kullanılabilir kalır, sadece açılır menü boş görünür).
 */

export interface BkLocation {
  id?: string;
  name: string;
}

async function fetchLocations(url: string): Promise<BkLocation[]> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (x): x is BkLocation =>
        !!x && typeof x === "object" && typeof (x as BkLocation).name === "string",
    );
  } catch {
    return [];
  }
}

export function fetchCities(): Promise<BkLocation[]> {
  return fetchLocations(`${API_BASE}/basitkargo/cities`);
}

export function fetchTowns(cityId: string): Promise<BkLocation[]> {
  return fetchLocations(
    `${API_BASE}/basitkargo/cities/${encodeURIComponent(cityId)}/towns`,
  );
}

export function fetchNeighborhoods(
  cityName: string,
  townName: string,
): Promise<BkLocation[]> {
  return fetchLocations(
    `${API_BASE}/basitkargo/neighborhoods?city=${encodeURIComponent(
      cityName,
    )}&town=${encodeURIComponent(townName)}`,
  );
}

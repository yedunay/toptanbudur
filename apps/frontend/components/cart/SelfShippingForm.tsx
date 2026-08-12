"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import {
  fetchCities,
  fetchNeighborhoods,
  fetchTowns,
  type BkLocation,
} from "@/lib/basitkargo";
import type { SelfShipping } from "@/lib/checkout-state";

interface SelfShippingFormProps {
  value: SelfShipping;
  onChange: (patch: Partial<SelfShipping>) => void;
}

const inputCls =
  "w-full rounded-2xl border border-[var(--border)] p-3 text-sm focus:border-[var(--brand-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100";
const labelCls = "mb-1 block text-xs font-black text-[var(--text)]";

/**
 * "Kendim İçin" yapılandırılmış teslimat formu — Basit Kargo etiketine birebir
 * uyar (alıcı ad/tel + il→ilçe→mahalle bağlı açılır menüler + açık adres).
 * İl/ilçe listeleri Basit Kargo konum API'sinden (backend proxy). Liste
 * gelmezse (token yok/servis kapalı) ilgili alan serbest-metne düşer — form
 * her zaman kullanılabilir kalır.
 */
export function SelfShippingForm({ value, onChange }: SelfShippingFormProps) {
  const [cities, setCities] = useState<BkLocation[]>([]);
  const [towns, setTowns] = useState<BkLocation[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<BkLocation[]>([]);
  const [loadingTowns, setLoadingTowns] = useState(false);

  // İl listesi — mount'ta bir kez.
  useEffect(() => {
    let cancelled = false;
    void fetchCities().then((list) => {
      if (!cancelled) setCities(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // İl seçilince ilçe listesi. İl DEĞİŞİNCE eski ilin ilçelerini hemen temizle —
  // aksi halde fetch bitene kadar önceki ilin ilçeleri seçilebilir kalır ve
  // yeni il'e ait olmayan bir ilçe gönderilebilir.
  useEffect(() => {
    setTowns([]);
    if (!value.cityId) {
      return;
    }
    let cancelled = false;
    setLoadingTowns(true);
    void fetchTowns(value.cityId)
      .then((list) => {
        if (!cancelled) setTowns(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingTowns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value.cityId]);

  // İlçe seçilince mahalle listesi (isim bazlı).
  useEffect(() => {
    if (!value.cityName || !value.townName) {
      setNeighborhoods([]);
      return;
    }
    let cancelled = false;
    void fetchNeighborhoods(value.cityName, value.townName).then((list) => {
      if (!cancelled) setNeighborhoods(list);
    });
    return () => {
      cancelled = true;
    };
  }, [value.cityName, value.townName]);

  const hasCityList = cities.length > 0;
  const hasTownList = towns.length > 0;

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-black text-[var(--text)]">
        Teslimat Adresi
      </h2>
      <p className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Info className="h-4 w-4 shrink-0 text-[var(--brand-blue)]" />
        Kargo etiketi bu bilgilerle otomatik oluşturulur — kargo firması ve
        barkod sizden istenmez.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Alıcı ad-soyad */}
        <div>
          <label className={labelCls}>Alıcı Ad Soyad</label>
          <input
            type="text"
            value={value.recipientName}
            onChange={(e) => onChange({ recipientName: e.target.value })}
            maxLength={120}
            placeholder="Ad Soyad"
            className={inputCls}
          />
        </div>

        {/* Telefon */}
        <div>
          <label className={labelCls}>Telefon</label>
          <input
            type="tel"
            inputMode="tel"
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            maxLength={20}
            placeholder="5xx xxx xx xx"
            className={inputCls}
          />
        </div>

        {/* İl */}
        <div>
          <label className={labelCls}>İl</label>
          {hasCityList ? (
            <select
              value={value.cityId}
              onChange={(e) => {
                const city = cities.find((c) => String(c.id) === e.target.value);
                onChange({
                  cityId: e.target.value,
                  cityName: city?.name ?? "",
                  townName: "",
                  neighborhood: "",
                });
              }}
              className={inputCls}
            >
              <option value="">İl seçin</option>
              {cities.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={value.cityName}
              onChange={(e) =>
                onChange({
                  cityName: e.target.value,
                  cityId: "",
                  townName: "",
                  neighborhood: "",
                })
              }
              maxLength={80}
              placeholder="İl"
              className={inputCls}
            />
          )}
        </div>

        {/* İlçe */}
        <div>
          <label className={labelCls}>İlçe</label>
          {hasTownList ? (
            <select
              value={value.townName}
              onChange={(e) =>
                onChange({ townName: e.target.value, neighborhood: "" })
              }
              className={inputCls}
            >
              <option value="">
                {loadingTowns ? "Yükleniyor…" : "İlçe seçin"}
              </option>
              {towns.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={value.townName}
              onChange={(e) =>
                onChange({ townName: e.target.value, neighborhood: "" })
              }
              maxLength={80}
              placeholder={
                loadingTowns ? "Yükleniyor…" : "İlçe (önce il seçin)"
              }
              className={inputCls}
            />
          )}
        </div>

        {/* Mahalle */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Mahalle</label>
          <input
            type="text"
            list="bk-neighborhoods"
            value={value.neighborhood}
            onChange={(e) => onChange({ neighborhood: e.target.value })}
            maxLength={80}
            placeholder="Mahalle"
            className={inputCls}
          />
          <datalist id="bk-neighborhoods">
            {neighborhoods.map((n) => (
              <option key={n.name} value={n.name} />
            ))}
          </datalist>
        </div>

        {/* Açık adres */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Açık Adres</label>
          <textarea
            value={value.addressLine}
            onChange={(e) => onChange({ addressLine: e.target.value })}
            rows={2}
            maxLength={200}
            placeholder="Cadde / sokak, bina no, daire…"
            className={inputCls}
          />
        </div>
      </div>
    </section>
  );
}

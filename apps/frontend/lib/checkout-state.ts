"use client";

import { create } from "zustand";

/**
 * "Kendim İçin" (marketplace='self') teslimat bilgisi. Basit Kargo etiketine
 * (client alanları: name/phone/city/town/address) birebir uyacak şekilde
 * YAPILANDIRILMIŞ toplanır — böylece backend eksiksiz sipariş açar. Yalnızca
 * self akışında doldurulur; diğer pazaryerlerinde boş kalır.
 */
export interface SelfShipping {
  /** Alıcı ad-soyad (Basit Kargo client.name). */
  recipientName: string;
  /** Alıcı telefon (client.phone). */
  phone: string;
  /** İl — Basit Kargo şehir id'si (ilçe listesini çekmek için). */
  cityId: string;
  /** İl adı (client.city + mahalle listesi için). */
  cityName: string;
  /** İlçe adı (client.town + mahalle listesi için). */
  townName: string;
  /** Mahalle. */
  neighborhood: string;
  /** Açık adres (sokak, no, daire…). */
  addressLine: string;
}

export const EMPTY_SELF_SHIPPING: SelfShipping = {
  recipientName: "",
  phone: "",
  cityId: "",
  cityName: "",
  townName: "",
  neighborhood: "",
  addressLine: "",
};

/**
 * Tüm zorunlu self alanları dolu mu? (posta kodu Basit Kargo'da gerekmez.)
 * recipientName ≥ 2 — backend OrderCustomerDto.name @MinLength(2) ile hizalı,
 * böylece istemci gate'i geçen kayıt backend'de 400 yemez.
 */
export function isSelfShippingComplete(s: SelfShipping): boolean {
  return (
    s.recipientName.trim().length >= 2 &&
    // Telefon backend OrderCustomerDto.phone regex'i ile birebir — gate'i geçen
    // kayıt submit'te 400 yemez. (odeme sayfası phone.trim() yollar.)
    /^[+0-9 ()-]{7,20}$/.test(s.phone.trim()) &&
    s.cityName.trim().length > 0 &&
    s.townName.trim().length > 0 &&
    s.neighborhood.trim().length > 0 &&
    s.addressLine.trim().length > 0
  );
}

/** Basit Kargo `client.address` = mahalle + açık adres (tek satır). */
export function buildSelfAddressLine(s: SelfShipping): string {
  return [s.neighborhood.trim(), s.addressLine.trim()]
    .filter(Boolean)
    .join(", ");
}

interface CheckoutSessionState {
  marketplace: string;
  cargoCompany: string;
  cargoBarcode: string;
  /** Müşteri ismi — Bayi'nin KENDİ son müşterisinin adı (sipariş başına farklı). */
  endCustomerName: string;
  /** "Kendim İçin" yapılandırılmış teslimat bilgisi. */
  selfShipping: SelfShipping;
  pdfUrl: string | null;
  pdfKey: string | null;
  orderNote: string;
  setMarketplace: (v: string) => void;
  setCargoCompany: (v: string) => void;
  setCargoBarcode: (v: string) => void;
  setEndCustomerName: (v: string) => void;
  setSelfShipping: (patch: Partial<SelfShipping>) => void;
  setPdfUrl: (v: string | null) => void;
  setPdfKey: (v: string | null) => void;
  setOrderNote: (v: string) => void;
  reset: () => void;
}

const INITIAL: Omit<
  CheckoutSessionState,
  | "setMarketplace"
  | "setCargoCompany"
  | "setCargoBarcode"
  | "setEndCustomerName"
  | "setSelfShipping"
  | "setPdfUrl"
  | "setPdfKey"
  | "setOrderNote"
  | "reset"
> = {
  marketplace: "",
  cargoCompany: "",
  cargoBarcode: "",
  endCustomerName: "",
  selfShipping: { ...EMPTY_SELF_SHIPPING },
  pdfUrl: null,
  pdfKey: null,
  orderNote: "",
};

export const useCheckoutStore = create<CheckoutSessionState>((set) => ({
  ...INITIAL,
  setMarketplace: (v) => set({ marketplace: v }),
  setCargoCompany: (v) => set({ cargoCompany: v }),
  setCargoBarcode: (v) => set({ cargoBarcode: v }),
  setEndCustomerName: (v) => set({ endCustomerName: v }),
  setSelfShipping: (patch) =>
    set((s) => ({ selfShipping: { ...s.selfShipping, ...patch } })),
  setPdfUrl: (v) => set({ pdfUrl: v }),
  setPdfKey: (v) => set({ pdfKey: v }),
  setOrderNote: (v) => set({ orderNote: v }),
  reset: () => set({ ...INITIAL, selfShipping: { ...EMPTY_SELF_SHIPPING } }),
}));

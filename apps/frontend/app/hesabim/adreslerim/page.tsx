import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/hesabim/adreslerim` artık emekliye ayrıldı: fatura ve kargo adresleri
 * `/hesabim/ayarlar#billing` altında tek noktada yönetiliyor. Eski URL'lerden
 * gelen linkler için kalıcı redirect.
 */
export default function AdreslerimPage(): never {
  redirect("/hesabim/ayarlar#billing");
}

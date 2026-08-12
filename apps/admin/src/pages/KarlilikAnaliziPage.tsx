import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import KarlilikAnaliziAnaliz from "./KarlilikAnaliziAnaliz";

export default function KarlilikAnaliziPage() {
  useRequireAuth();
  useDocumentTitle("Karlılık Analizi");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-brand-navy)]">
            Karlılık Analizi
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Tedarikçi bazlı gerçek maliyet ve kar hesaplama. Alış / KDV / indirim
            ayarları artık TEK KAYNAK olarak Tedarikçiler sayfasındaki tedarikçi
            formundadır.
          </p>
        </div>
      </div>

      <KarlilikAnaliziAnaliz />
    </div>
  );
}

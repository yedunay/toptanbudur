import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Mesafeli Satış Sözleşmesi — Toptan Budur",
};

export default function MesafeliSatisPage() {
  return <LegalPage title="Mesafeli Satış Sözleşmesi" intro="Toptan Budur üzerinden verilen siparişlere ilişkin mesafeli satış sözleşmesi metni." />;
}

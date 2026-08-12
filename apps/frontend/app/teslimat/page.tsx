import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Teslimat ve Kargo — Toptan Budur",
};

export default function TeslimatPage() {
  return <LegalPage title="Teslimat ve Kargo" intro="Teslimat süreleri ve kargo süreçlerine ilişkin bilgiler." />;
}

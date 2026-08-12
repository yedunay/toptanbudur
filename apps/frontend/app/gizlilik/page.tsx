import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Gizlilik Politikası — Toptan Budur",
};

export default function GizlilikPage() {
  return <LegalPage title="Gizlilik Politikası" intro="Kişisel verilerinizin nasıl işlendiğine ilişkin gizlilik politikası." />;
}

import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Çerez Politikası — Toptan Budur",
};

export default function CerezPage() {
  return <LegalPage title="Çerez Politikası" intro="Sitemizde kullanılan çerezlere ilişkin politika." />;
}

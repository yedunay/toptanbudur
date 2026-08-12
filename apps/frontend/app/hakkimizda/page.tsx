import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Hakkımızda — Toptan Budur",
};

export default function HakkimizdaPage() {
  return <LegalPage title="Hakkımızda" intro="Toptan Budur kurumsal bilgileri." />;
}

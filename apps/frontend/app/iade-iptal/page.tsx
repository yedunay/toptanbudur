import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "İptal ve İade Şartları — Toptan Budur",
};

export default function IadeIptalPage() {
  return <LegalPage title="İptal ve İade Şartları" intro="Sipariş iptali ve iade süreçlerine ilişkin şartlar." />;
}

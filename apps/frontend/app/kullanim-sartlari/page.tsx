import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Kullanım Şartları — Toptan Budur",
};

export default function KullanimSartlariPage() {
  return <LegalPage title="Kullanım Şartları" intro="Toptan Budur platformunun kullanımına ilişkin şartlar." />;
}

import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni — Toptan Budur",
};

export default function KvkkPage() {
  return <LegalPage title="KVKK Aydınlatma Metni" intro="6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aydınlatma metni." />;
}

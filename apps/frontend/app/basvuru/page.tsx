import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { DealerApplyForm } from "@/components/DealerApplyForm";

export const metadata: Metadata = {
  title: "Bayilik Başvurusu — Toptan Budur",
};

export default function BasvuruPage() {
  return (
    <LegalPage
      title="Bayilik Başvurusu"
      intro="Formu doldurun; başvurunuz incelendikten sonra e-posta ile bilgilendirilirsiniz. Hesaplar yalnızca onaylı başvurular için açılır."
    >
      <DealerApplyForm />
    </LegalPage>
  );
}

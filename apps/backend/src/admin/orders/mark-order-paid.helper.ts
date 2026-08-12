import type { Prisma } from '@prisma/client';
import type { AppSettingsService } from '../../app-settings/app-settings.service';

const DEFAULT_HOLD_HOURS = 144;

interface CustomerSnapshotInput {
  id: string;
  name: string | null;
  companyTitle: string | null;
  vergiNo: string | null;
  vergiDairesi: string | null;
  tcKimlik: string | null;
  email: string | null;
  phone: string | null;
  contactPhone: string | null;
  companyAddress: string | null;
}

interface CustomerAddressSnapshotInput {
  line1: string;
  city: string;
  district: string | null;
  postalCode: string | null;
}

/**
 * Sipariş `paid` statüsüne geçtiğinde çağırılır. Üç yerden tetiklenmek
 * üzere tasarlandı:
 *
 *   1. Admin manuel "ödendi" tikler — admin-orders.service.ts updateOrder
 *   2. Kart ödeme webhook'u (PayTR) ileride eklendiğinde
 *   3. Cari onay flow (cariApprovalStatus pending → approved) ileride
 *
 * Atomic olarak şunları yapar:
 *   - paidAt = now
 *   - invoiceHoldUntil = now + AppSetting `birfatura.invoiceHoldHours` saat
 *   - billingHold = false (yeniden açma — manuel hold varsa admin yapar)
 *   - billing snapshot Customer ve seçili adresten kopyalar
 *
 * Snapshot bir kez yazıldıktan sonra Customer/Address sonradan değişse bile
 * sipariş üstü billing değişmez — BirFatura aynı OrderId'yi tekrar çekerse
 * tutarlı veri görür.
 */
export async function markOrderPaid(params: {
  tx: Prisma.TransactionClient;
  settings: AppSettingsService;
  orderId: string;
  customer: CustomerSnapshotInput;
  customerAddress: CustomerAddressSnapshotInput | null;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const holdHours = await params.settings.getNumber(
    'birfatura.invoiceHoldHours',
    DEFAULT_HOLD_HOURS,
  );
  const invoiceHoldUntil = new Date(now.getTime() + holdHours * 3_600_000);

  await params.tx.order.update({
    where: { id: params.orderId },
    data: {
      paidAt: now,
      invoiceHoldUntil,
      billingHold: false,
      // Billing snapshot
      billingName: params.customer.name,
      billingCompanyTitle: params.customer.companyTitle,
      billingVergiNo: params.customer.vergiNo,
      billingVergiDairesi: params.customer.vergiDairesi,
      billingTcNo: params.customer.tcKimlik,
      billingEmail: params.customer.email,
      billingPhone: params.customer.phone,
      billingMobilePhone: params.customer.contactPhone ?? params.customer.phone,
      billingAddressLine:
        params.customerAddress?.line1 ?? params.customer.companyAddress,
      billingDistrict: params.customerAddress?.district ?? null,
      billingCity: params.customerAddress?.city ?? null,
      billingPostal: params.customerAddress?.postalCode ?? null,
      shippingDistrict: params.customerAddress?.district ?? null,
    },
  });
}

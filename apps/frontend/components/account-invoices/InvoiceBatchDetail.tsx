"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/api";
import type { DealerInvoiceBatchDetail } from "@/lib/customer-types";
import { formatShortDate } from "./invoice-format";

interface InvoiceBatchDetailProps {
  detail: DealerInvoiceBatchDetail;
}

/**
 * Tek bir toplu faturanın tüm detayları: kapsadığı siparişler (members) ve
 * KDV-hariç/dahil kırılımlı kalem listesi (lines). "Tüm detaylarıyla eksiksiz"
 * gereksinimini karşılar.
 */
export function InvoiceBatchDetail({ detail }: InvoiceBatchDetailProps) {
  return (
    <div className="space-y-6 border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-5 sm:px-5">
      {/* Kapsanan siparişler */}
      <section>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Kapsanan siparişler ({detail.members.length})
        </h4>
        {detail.members.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Bu faturada sipariş bulunmuyor.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-3 py-2.5 font-medium">Sipariş</th>
                  <th className="px-3 py-2.5 font-medium">Kargo tarihi</th>
                  <th className="px-3 py-2.5 text-right font-medium">Adet</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Tutar (KDV dahil)
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/hesabim/siparislerim/${encodeURIComponent(m.id)}`}
                        className="font-semibold text-[var(--brand-blue)] hover:underline"
                      >
                        #{m.humanOrderNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-muted)]">
                      {formatShortDate(m.shippedAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text)]">
                      {m.quantity}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[var(--text)]">
                      {formatPrice(m.totalTaxIncluding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Kalem kırılımı */}
      <section>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Fatura kalemleri ({detail.lines.length})
        </h4>
        {detail.lines.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Kalem bilgisi bulunmuyor.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-3 py-2.5 font-medium">Sıra No</th>
                  <th className="px-3 py-2.5 font-medium">Stok Kodu</th>
                  <th className="px-3 py-2.5 font-medium">Mal Hizmet</th>
                  <th className="px-3 py-2.5 text-right font-medium">Miktar</th>
                  <th className="px-3 py-2.5 text-right font-medium">Birim Fiyat</th>
                  <th className="px-3 py-2.5 text-right font-medium">KDV Oranı</th>
                  <th className="px-3 py-2.5 text-right font-medium">KDV Tutarı</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Mal Hizmet Tutarı
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line, idx) => (
                  <tr
                    key={`${line.productCode}-${idx}`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-[var(--text-muted)]">
                      {line.productCode || "—"}
                    </td>
                    {/* Mal Hizmet = sipariş no (önek) + ürün adı — BirFatura ile birebir */}
                    <td className="px-3 py-2.5 text-[var(--text)]">
                      {line.orderCode ? `${line.orderCode} · ` : ""}
                      {line.productName}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text)]">
                      {line.quantity} Adet
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                      {formatPrice(line.unitPriceTaxExcluding)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                      %{line.vatRate}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                      {formatPrice(
                        line.lineTotalTaxIncluding - line.lineTotalTaxExcluding,
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[var(--text)]">
                      {formatPrice(line.lineTotalTaxExcluding)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)]">
                  <td colSpan={6} />
                  <td className="px-3 py-2 text-right text-xs font-medium text-[var(--text-muted)]">
                    Mal Hizmet Toplam Tutarı
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {formatPrice(detail.productsTotalTaxExcluding)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} />
                  <td className="px-3 py-2 text-right text-xs font-medium text-[var(--text-muted)]">
                    Hesaplanan KDV (%20)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {formatPrice(
                      detail.totalPaidTaxIncluding -
                        detail.productsTotalTaxExcluding,
                    )}
                  </td>
                </tr>
                <tr className="bg-[var(--surface-muted)]">
                  <td colSpan={6} />
                  <td className="px-3 py-2.5 text-right text-xs font-bold uppercase text-[var(--text)]">
                    Vergiler Dahil Toplam
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[var(--text)]">
                    {formatPrice(detail.totalPaidTaxIncluding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

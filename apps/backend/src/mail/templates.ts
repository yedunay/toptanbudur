/**
 * HTML e-posta şablonları — inline CSS, lacivert/mavi/beyaz tema.
 *
 * Firma kimliği (ad / site / logo) env'den okunur; env boşsa varsayılanlar
 * kullanılır:
 *   COMPANY_NAME      → e-postalarda görünen firma adı
 *   COMPANY_URL       → footer ve buton linklerinin kök adresi
 *   COMPANY_LOGO_URL  → header logosu (boşsa `${COMPANY_URL}/logo.png`)
 *
 * Şablonlar saf string'dir; ekstra bağımlılık yok. Her şablon `wrap()` ile
 * sarılır — header (logo + başlık) + body + footer'ı garanti eder.
 */

const COMPANY_NAME = process.env.COMPANY_NAME?.trim() || 'Toptan Budur';
const COMPANY_URL = (
  process.env.COMPANY_URL?.trim() || 'https://toptanbudur.com'
).replace(/\/+$/, '');
const LOGO_URL =
  process.env.COMPANY_LOGO_URL?.trim() || `${COMPANY_URL}/logo.png`;

export const NAVY = '#0b2545';
export const BLUE = '#1d4ed8';
export const SOFT_BG = '#f4f7fb';
export const TEXT = '#1f2937';
export const MUTED = '#64748b';
export const BORDER = '#e2e8f0';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(value: number, currency: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = safe.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${escapeHtml(currency)}`;
}

/**
 * Ham satış kanalı slug'ının (order.marketplace) müşteriye gösterilecek Türkçe
 * etiketi. Bilinmeyen slug Title-Case'e çevrilir (asla boş dönmez).
 */
const MARKETPLACE_LABEL_TR: Record<string, string> = {
  self: 'Kendim İçin',
  other: 'Diğer Satış Kanalı',
};

export function marketplaceLabelTr(value: string): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const hit = MARKETPLACE_LABEL_TR[v.toLowerCase()];
  if (hit) return hit;
  // Bilinmeyen slug → Title-Case (kelime başları büyük); yine de asla boş.
  return v
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w))
    .join(' ');
}

export interface WrapOpts {
  title: string;
  preheader?: string;
  body: string;
}

/**
 * Her maile benzersiz, görünür referans kodu üretir (footer'da "Ref: ...").
 *
 * Neden: relay'in (kurumsaleposta) giden-posta spam filtresi "kısa sürede
 * benzer içerikli ardışık gönderim"i toplu mail sayıp 550 ile durduruyor
 * (2026-07-13 destek yanıtı). Benzersiz referans, şablon mailleri birbirinin
 * birebir kopyası olmaktan çıkarır; ayrıca destek yazışmalarında tekil mail
 * takibine yarar.
 */
function mailRef(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AB-${t}-${r}`;
}

export function wrap({ title, preheader, body }: WrapOpts): string {
  const safeTitle = escapeHtml(title);
  const pre = preheader ? escapeHtml(preheader) : '';
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:${SOFT_BG};font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${TEXT};">
    <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${pre}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT_BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
            <tr>
              <td style="background:${NAVY};padding:24px;text-align:center;">
                <img src="${LOGO_URL}" alt="${COMPANY_NAME}" width="56" height="56" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:8px;background:#ffffff;padding:6px;" />
                <div style="color:#ffffff;font-size:18px;font-weight:600;margin-top:12px;letter-spacing:0.3px;">${COMPANY_NAME}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <h1 style="margin:0 0 12px 0;font-size:20px;color:${NAVY};font-weight:600;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;font-size:15px;line-height:1.6;color:${TEXT};">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="background:${SOFT_BG};padding:18px 28px;text-align:center;color:${MUTED};font-size:12px;border-top:1px solid ${BORDER};">
                <div>${COMPANY_NAME} &mdash; <a href="${COMPANY_URL}" style="color:${BLUE};text-decoration:none;">${COMPANY_URL}</a></div>
                <div style="margin-top:6px;">Bu e-posta otomatik olarak gönderildi; lütfen yanıtlamayınız.</div>
                <div style="margin-top:4px;color:#94a3b8;font-size:11px;">Ref: ${mailRef()}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface OrderItemPayload {
  name: string;
  qty: number;
  unitPrice: number;
}

interface OrderConfirmationInput {
  customerName: string;
  humanOrderNo: string | null;
  total: number;
  subtotal: number;
  kdvAmount: number;
  // Paketleme ücreti (KDV-hariç). Null/0 ise satır gizlenir.
  packagingCost?: number | null;
  // Kart komisyonu (KDV dahil brüt) — yalnızca kartlı ödemede; null/0 gizli.
  // Gösterilen "Ödenen Toplam" = total + cardCommissionAmount.
  cardCommissionAmount?: number | null;
  currency: string;
  items: OrderItemPayload[];
  paymentType?: string | null;
  marketplace?: string | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  cariBalanceBefore?: number | null;
  cariBalanceAfter?: number | null;
}

export function renderOrderConfirmation(p: OrderConfirmationInput): string {
  const rows = p.items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(it.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};text-align:center;">${it.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};text-align:right;">${formatMoney(it.unitPrice, p.currency)}</td>
      </tr>`,
    )
    .join('');

  const orderNoBadge = p.humanOrderNo
    ? `<span style="display:inline-block;background:${BLUE};color:#fff;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:0.4px;">${escapeHtml(p.humanOrderNo)}</span>`
    : '';

  const isCari = p.paymentType === 'cari' || p.paymentType === 'cari_balance';
  const paymentLabel = isCari
    ? 'Cari bakiye'
    : p.paymentType === 'card'
      ? 'Kredi / Banka kartı'
      : (p.paymentType ?? '');

  const paymentRow = paymentLabel
    ? `<tr><td style="padding:4px 0;color:${MUTED};">Ödeme yöntemi</td><td style="padding:4px 0;text-align:right;">${escapeHtml(paymentLabel)}</td></tr>`
    : '';

  const cariRows =
    isCari && p.cariBalanceBefore != null && p.cariBalanceAfter != null
      ? `<tr><td style="padding:4px 0;color:${MUTED};">Cari bakiye (öncesi)</td><td style="padding:4px 0;text-align:right;">${formatMoney(p.cariBalanceBefore, p.currency)}</td></tr>
         <tr><td style="padding:4px 0;color:${MUTED};">Ödenen tutar</td><td style="padding:4px 0;text-align:right;">${formatMoney(p.total, p.currency)}</td></tr>
         <tr><td style="padding:4px 0;color:${MUTED};">Cari bakiye (sonrası)</td><td style="padding:4px 0;text-align:right;font-weight:700;color:${NAVY};">${formatMoney(p.cariBalanceAfter, p.currency)}</td></tr>`
      : '';

  const cargoRows: string[] = [];
  if (p.marketplace)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};width:160px;">Satış Kanalı</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(marketplaceLabelTr(p.marketplace))}</td></tr>`,
    );
  if (p.cargoCompany)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Firması</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoCompany)}</td></tr>`,
    );
  if (p.cargoBarcode)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Barkodu</td><td style="padding:8px 14px;color:${NAVY};font-weight:700;letter-spacing:0.5px;font-family:Consolas,Menlo,monospace;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoBarcode)}</td></tr>`,
    );
  const cargoTable = cargoRows.length
    ? `<p style="margin:20px 0 8px 0;font-weight:600;color:${NAVY};font-size:14px;">Kargo Bilgileri</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">${cargoRows.join('')}</table>`
    : '';

  const body = `
    <p style="margin:0 0 8px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Siparişiniz başarıyla alındı. ${orderNoBadge}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="color:${MUTED};text-align:left;">
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};">Ürün</th>
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};text-align:center;">Adet</th>
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};text-align:right;">Birim</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
      <tr>
        <td style="padding:4px 0;color:${MUTED};">Ara toplam</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.subtotal, p.currency)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:${MUTED};">KDV</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.kdvAmount, p.currency)}</td>
      </tr>
      ${
        p.packagingCost && p.packagingCost > 0
          ? `<tr>
        <td style="padding:4px 0;color:${MUTED};">Paketleme</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.packagingCost, p.currency)}</td>
      </tr>`
          : ''
      }
      ${
        p.cardCommissionAmount && p.cardCommissionAmount > 0
          ? `<tr>
        <td style="padding:4px 0;color:${MUTED};">Kart Komisyonu</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.cardCommissionAmount, p.currency)}</td>
      </tr>`
          : ''
      }
      <tr>
        <td style="padding:8px 0;color:${NAVY};font-weight:700;border-top:1px solid ${BORDER};">${p.cardCommissionAmount && p.cardCommissionAmount > 0 ? 'Ödenen Toplam' : 'Toplam'}</td>
        <td style="padding:8px 0;text-align:right;color:${NAVY};font-weight:700;border-top:1px solid ${BORDER};">${formatMoney(p.total + (p.cardCommissionAmount ?? 0), p.currency)}</td>
      </tr>
      ${paymentRow}
      ${cariRows}
    </table>
    ${cargoTable}
    <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;">Sipariş hazırlanıp kargoya verildiğinde tekrar bilgilendirileceksiniz.</p>`;

  return wrap({
    title: 'Siparişiniz alındı',
    preheader: 'Siparişiniz başarıyla alındı.',
    body,
  });
}

interface CariRequestReceivedInput {
  customerName: string;
  humanOrderNo: string | null;
  amount: number;
  currency: string;
}

export function renderCariRequestReceived(p: CariRequestReceivedInput): string {
  const orderRef = p.humanOrderNo ? ` (${escapeHtml(p.humanOrderNo)})` : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Siparişiniz${orderRef} için <strong>cariden ödeme</strong> talebiniz alındı.</p>
    <p style="margin:0 0 12px 0;color:${MUTED};">Ekibimiz cari hesabınızı kontrol edip en kısa sürede karar verecektir.</p>
    <p style="margin:0;font-size:14px;">Talep tutarı: <strong style="color:${NAVY};">${formatMoney(p.amount, p.currency)}</strong></p>`;
  return wrap({
    title: 'Cariden ödeme talebiniz alındı',
    preheader: 'Cariden ödeme talebiniz incelemeye alındı.',
    body,
  });
}

interface CariDecisionInput {
  customerName: string;
  humanOrderNo: string | null;
  amount: number;
  currency: string;
  note?: string | null;
}

export function renderCariApproved(p: CariDecisionInput): string {
  const orderRef = p.humanOrderNo ? ` (${escapeHtml(p.humanOrderNo)})` : '';
  const noteBlock = p.note
    ? `<p style="margin:12px 0 0 0;padding:10px 12px;background:${SOFT_BG};border-left:3px solid ${BLUE};color:${TEXT};font-size:14px;">${escapeHtml(p.note)}</p>`
    : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Siparişiniz${orderRef} için cariden ödeme talebiniz <strong style="color:#15803d;">ONAYLANDI</strong>.</p>
    <p style="margin:0;font-size:14px;">Onaylanan tutar: <strong style="color:${NAVY};">${formatMoney(p.amount, p.currency)}</strong></p>
    ${noteBlock}
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Siparişiniz hazırlığa alınmıştır.</p>`;
  return wrap({
    title: 'Cariden ödeme onaylandı',
    preheader: 'Cariden ödeme talebiniz onaylandı.',
    body,
  });
}

export function renderCariRejected(p: CariDecisionInput): string {
  const orderRef = p.humanOrderNo ? ` (${escapeHtml(p.humanOrderNo)})` : '';
  const noteBlock = p.note
    ? `<p style="margin:12px 0 0 0;padding:10px 12px;background:${SOFT_BG};border-left:3px solid #dc2626;color:${TEXT};font-size:14px;">${escapeHtml(p.note)}</p>`
    : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Siparişiniz${orderRef} için cariden ödeme talebiniz <strong style="color:#b91c1c;">REDDEDİLDİ</strong>.</p>
    <p style="margin:0;font-size:14px;">Talep tutarı: <strong style="color:${NAVY};">${formatMoney(p.amount, p.currency)}</strong></p>
    ${noteBlock}
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Sipariş için farklı bir ödeme yöntemi seçebilir veya bizimle iletişime geçebilirsiniz.</p>`;
  return wrap({
    title: 'Cariden ödeme reddedildi',
    preheader: 'Cariden ödeme talebiniz reddedildi.',
    body,
  });
}

interface TopupRequestReceivedInput {
  customerName: string;
  amount: number;
  currency: string;
  humanTopupNo?: string | null;
}

export function renderTopupRequestReceived(
  p: TopupRequestReceivedInput,
): string {
  const refLine = p.humanTopupNo
    ? `<p style="margin:0 0 12px 0;color:${MUTED};font-size:13px;">Talep no: <strong style="color:${TEXT};">${escapeHtml(p.humanTopupNo)}</strong></p>`
    : '';
  const titleSuffix = p.humanTopupNo ? ` — ${escapeHtml(p.humanTopupNo)}` : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    ${refLine}
    <p style="margin:0 0 12px 0;">Cari bakiyenize <strong>${formatMoney(p.amount, p.currency)}</strong> tutarında yükleme talebiniz alındı.</p>
    <p style="margin:0 0 12px 0;color:${MUTED};">Havalenizi/EFT'nizi yapmadıysanız lütfen müşteri sayfanızdaki banka bilgilerini kullanarak gerçekleştirin. Ödemeniz teyit edildikten sonra cari bakiyeniz güncellenecektir.</p>
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Onay süreciyle ilgili soru için bizimle iletişime geçebilirsiniz.</p>`;
  return wrap({
    title: `Cari yükleme talebiniz alındı${titleSuffix}`,
    preheader: 'Cari bakiye yükleme talebiniz incelemeye alındı.',
    body,
  });
}

interface TopupDecisionInput {
  customerName: string;
  amount: number;
  currency: string;
  note?: string | null;
  humanTopupNo?: string | null;
}

export function renderTopupApproved(p: TopupDecisionInput): string {
  const noteBlock = p.note
    ? `<p style="margin:12px 0 0 0;padding:10px 12px;background:${SOFT_BG};border-left:3px solid ${BLUE};color:${TEXT};font-size:14px;">${escapeHtml(p.note)}</p>`
    : '';
  const refLine = p.humanTopupNo
    ? `<p style="margin:0 0 12px 0;color:${MUTED};font-size:13px;">Talep no: <strong style="color:${TEXT};">${escapeHtml(p.humanTopupNo)}</strong></p>`
    : '';
  const titleSuffix = p.humanTopupNo ? ` — ${escapeHtml(p.humanTopupNo)}` : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    ${refLine}
    <p style="margin:0 0 12px 0;">Cari bakiyenize <strong style="color:#15803d;">${formatMoney(p.amount, p.currency)}</strong> tutarındaki yükleme onaylandı.</p>
    <p style="margin:0 0 12px 0;color:${MUTED};">Yeni bakiyeniz müşteri panelinizde görüntülenebilir. Cariden ödeme yöntemiyle siparişlerinizi tamamlayabilirsiniz.</p>
    ${noteBlock}`;
  return wrap({
    title: `Cari yüklemeniz onaylandı${titleSuffix}`,
    preheader: 'Cari bakiye yüklemeniz onaylandı.',
    body,
  });
}

export function renderTopupRejected(p: TopupDecisionInput): string {
  const noteBlock = p.note
    ? `<p style="margin:12px 0 0 0;padding:10px 12px;background:${SOFT_BG};border-left:3px solid #dc2626;color:${TEXT};font-size:14px;">${escapeHtml(p.note)}</p>`
    : '';
  const refLine = p.humanTopupNo
    ? `<p style="margin:0 0 12px 0;color:${MUTED};font-size:13px;">Talep no: <strong style="color:${TEXT};">${escapeHtml(p.humanTopupNo)}</strong></p>`
    : '';
  const titleSuffix = p.humanTopupNo ? ` — ${escapeHtml(p.humanTopupNo)}` : '';
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    ${refLine}
    <p style="margin:0 0 12px 0;">Cari bakiyenize <strong style="color:#b91c1c;">${formatMoney(p.amount, p.currency)}</strong> tutarındaki yükleme talebi <strong style="color:#b91c1c;">REDDEDİLDİ</strong>.</p>
    ${noteBlock}
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Detaylar için bizimle iletişime geçebilir veya yeni bir talep oluşturabilirsiniz.</p>`;
  return wrap({
    title: `Cari yüklemeniz reddedildi${titleSuffix}`,
    preheader: 'Cari bakiye yükleme talebiniz reddedildi.',
    body,
  });
}

interface GiftBalanceInput {
  customerName: string;
  amount: number;
  previousBalance: number;
  newBalance: number;
  currency: string;
  note?: string | null;
}

/**
 * HEDİYE BAKİYE bildirimi — admin bir müşteriye kampanya/jest olarak hediye
 * bakiye tanımladığında gönderilir. Sektöre uygun, sıcak ve "kampanya" hissi
 * veren premium bir şablon: yeşil hediye hero kartı, önceki + hediye = yeni
 * bakiye dökümü, opsiyonel kişisel not ve bakiyeye yönlendiren CTA.
 */
export function renderGiftBalanceGranted(p: GiftBalanceInput): string {
  const GIFT_GREEN = '#15803d';
  const GIFT_GREEN_SOFT = '#f0fdf4';
  const GIFT_BORDER = '#bbf7d0';
  const name = escapeHtml(p.customerName?.trim() || 'değerli müşterimiz');
  const balanceUrl = `${COMPANY_URL}/hesabim/bakiyem`;

  const noteBlock = p.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0 0;">
         <tr>
           <td style="padding:14px 16px;background:${SOFT_BG};border-left:4px solid ${GIFT_GREEN};border-radius:6px;color:${TEXT};font-size:14px;line-height:1.6;">
             <span style="display:block;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${GIFT_GREEN};margin-bottom:4px;">Size özel not</span>
             ${escapeHtml(p.note)}
           </td>
         </tr>
       </table>`
    : '';

  const body = `
    <p style="margin:0 0 14px 0;">Merhaba <strong>${name}</strong>,</p>
    <p style="margin:0 0 18px 0;">Sizi <strong>${COMPANY_NAME}</strong> ailesinin değerli bir üyesi olarak görüyoruz ve bu değeri somut bir şekilde göstermek istedik. Cari hesabınıza <strong style="color:${GIFT_GREEN};">size özel bir hediye bakiye</strong> tanımladık. 🎉</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px 0;border-collapse:separate;">
      <tr>
        <td style="padding:28px 24px;text-align:center;background:${GIFT_GREEN_SOFT};border:1px solid ${GIFT_BORDER};border-radius:14px;">
          <div style="font-size:40px;line-height:1;margin-bottom:10px;">🎁</div>
          <div style="font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${GIFT_GREEN};">Hediye Bakiye</div>
          <div style="margin-top:8px;font-size:38px;font-weight:800;color:${GIFT_GREEN};letter-spacing:-0.5px;">+ ${formatMoney(p.amount, p.currency)}</div>
          <div style="margin-top:6px;font-size:13px;color:${MUTED};">cari hesabınıza tanımlandı</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0 0;border-collapse:separate;border-spacing:0;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;font-size:14px;">
      <tr>
        <td style="padding:12px 16px;color:${MUTED};">Önceki bakiyeniz</td>
        <td style="padding:12px 16px;text-align:right;color:${TEXT};font-weight:600;">${formatMoney(p.previousBalance, p.currency)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;color:${MUTED};border-top:1px solid ${BORDER};">Hediye bakiye</td>
        <td style="padding:12px 16px;text-align:right;color:${GIFT_GREEN};font-weight:700;border-top:1px solid ${BORDER};">+ ${formatMoney(p.amount, p.currency)}</td>
      </tr>
      <tr>
        <td style="padding:14px 16px;color:${NAVY};font-weight:700;border-top:2px solid ${NAVY};background:${SOFT_BG};">Yeni bakiyeniz</td>
        <td style="padding:14px 16px;text-align:right;color:${NAVY};font-weight:800;font-size:17px;border-top:2px solid ${NAVY};background:${SOFT_BG};">${formatMoney(p.newBalance, p.currency)}</td>
      </tr>
    </table>

    ${noteBlock}

    <p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;">Bu bakiyeyi <strong>hemen kullanmaya başlayabilirsiniz</strong>. Siparişlerinizde cari bakiyenizden otomatik olarak düşülür; ekstra bir işlem yapmanıza gerek yoktur.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px 0;">
      <tr>
        <td align="center">
          <a href="${balanceUrl}" style="display:inline-block;background:${GIFT_GREEN};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:10px;">Bakiyemi Görüntüle</a>
        </td>
      </tr>
    </table>

    <p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Bu hediye, bize gösterdiğiniz güvene küçük bir teşekkürümüzdür. İyi alışverişler dileriz! 💚<br/><strong style="color:${TEXT};">${COMPANY_NAME}</strong> ekibi</p>`;

  return wrap({
    title: '🎁 Size özel hediye bakiye tanımlandı',
    preheader: `Cari hesabınıza ${formatMoney(p.amount, p.currency)} hediye bakiye tanımlandı.`,
    body,
  });
}

interface SupportReplyInput {
  recipientName: string;
  subject: string;
  /** Bizim müşteriye verdiğimiz yanıt (adminNote). */
  body: string;
  /** Müşterinin ilk açtığı talep metni — mailde birebir gösterilir. */
  originalMessage?: string | null;
  orderNumber?: string | null;
  category?: string | null;
  createdAt?: Date | null;
}

/** Talep kategori kodu → müşteriye gösterilecek Türkçe etiket. */
const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  kargo: 'Kargo',
  iptal: 'İptal',
  iade: 'İade',
  diger: 'Diğer',
  // Eski taleplerde kalan (artık seçilemeyen) kategoriler — mail'de düzgün
  // görünmeye devam etsin.
  siparis: 'Sipariş',
  fatura: 'Fatura',
  teknik: 'Teknik',
  odeme: 'Ödeme',
  urun: 'Ürün',
  hesap: 'Hesap',
};

export function renderSupportReply(p: SupportReplyInput): string {
  const safeReply = escapeHtml(p.body).replace(/\r?\n/g, '<br/>');
  const safeOriginal = p.originalMessage
    ? escapeHtml(p.originalMessage).replace(/\r?\n/g, '<br/>')
    : '';

  // Talep künyesi: konu / sipariş no / kategori / talep tarihi. Müşteri hangi
  // talebinin yanıtlandığını tereddütsüz anlasın (spam'e düşse bile içerik net).
  const metaRows: string[] = [];
  const addRow = (label: string, value: string) =>
    metaRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};width:130px;border-top:1px solid ${BORDER};">${label}</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(value)}</td></tr>`,
    );
  if (p.subject) addRow('Konu', p.subject);
  if (p.orderNumber) addRow('Sipariş No', p.orderNumber);
  if (p.category)
    addRow('Kategori', SUPPORT_CATEGORY_LABELS[p.category] ?? p.category);
  if (p.createdAt)
    addRow(
      'Talep Tarihi',
      p.createdAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
    );

  const metaBlock = metaRows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:13px;margin:0 0 18px 0;">${metaRows.join('')}</table>`
    : '';

  const originalBlock = safeOriginal
    ? `<p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;font-weight:600;">Talebiniz</p>
    <div style="margin:0 0 18px 0;padding:12px 14px;background:#ffffff;border:1px solid ${BORDER};border-left:3px solid ${MUTED};border-radius:6px;font-size:14px;line-height:1.6;color:${TEXT};">${safeOriginal}</div>`
    : '';

  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.recipientName)}</strong>,</p>
    <p style="margin:0 0 18px 0;color:${MUTED};">Aşağıdaki talebiniz yanıtlanmıştır.</p>
    ${metaBlock}
    ${originalBlock}
    <p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;font-weight:600;">Yanıtımız</p>
    <div style="margin:0;padding:14px 16px;background:${SOFT_BG};border-left:3px solid ${BLUE};border-radius:6px;font-size:14px;line-height:1.6;color:${TEXT};">${safeReply}</div>
    <p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;">İhtiyacınız olursa bu e-postayı yanıtlayabilir veya hesabınızdaki aynı talep üzerinden tekrar yazabilirsiniz.</p>`;
  return wrap({
    title: p.subject || 'Destek talebiniz yanıtlandı',
    preheader: 'Destek talebinize yanıt verildi.',
    body,
  });
}

// ─── Bayilik başvurusu alındı ────────────────────────────────────────────────

interface DealerApplicationReceivedInput {
  name: string;
  email: string;
  phone: string;
  company?: string | null;
  message?: string | null;
}

export function renderDealerApplicationReceived(
  p: DealerApplicationReceivedInput,
): string {
  const companyRow = p.company
    ? `<tr><td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Firma</td><td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.company)}</td></tr>`
    : '';
  const messageRow = p.message
    ? `<tr><td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Notunuz</td><td style="padding:10px 14px;color:${TEXT};border-top:1px solid ${BORDER};">${escapeHtml(p.message)}</td></tr>`
    : '';

  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.name)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Bayilik başvurunuz başarıyla alındı. Ekibimiz en kısa sürede değerlendirip size dönecektir.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr>
        <td style="padding:10px 14px;color:${MUTED};width:140px;">Ad Soyad</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;">${escapeHtml(p.name)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">E-posta</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.email)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Telefon</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.phone)}</td>
      </tr>
      ${companyRow}
      ${messageRow}
    </table>
    <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;">Başvurunuz onaylandığında giriş bilgileriniz bu adrese iletilecektir.</p>`;

  return wrap({
    title: 'Bayilik başvurunuz alındı',
    preheader: 'Bayilik başvurunuz alındı — en kısa sürede değerlendireceğiz.',
    body,
  });
}

// ─── Destek talebi alındı ─────────────────────────────────────────────────────

interface SupportReceivedInput {
  recipientName: string;
  subject?: string | null;
  message: string;
}

export function renderSupportReceived(p: SupportReceivedInput): string {
  const safeMsg = escapeHtml(p.message).replace(/\r?\n/g, '<br/>');
  const subjectLine = p.subject
    ? `<p style="margin:0 0 12px 0;color:${MUTED};font-size:14px;">Konu: <strong style="color:${NAVY};">${escapeHtml(p.subject)}</strong></p>`
    : '';

  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.recipientName)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Destek talebiniz alındı. Ekibimiz en kısa sürede sizinle iletişime geçecektir.</p>
    ${subjectLine}
    <div style="margin:0 0 16px 0;padding:14px 16px;background:${SOFT_BG};border-left:3px solid ${BLUE};border-radius:6px;font-size:14px;line-height:1.6;color:${TEXT};">${safeMsg}</div>
    <p style="margin:0;color:${MUTED};font-size:13px;">Talebinizle ilgili herhangi bir ek bilgi iletmek isterseniz bize yazabilirsiniz.</p>`;

  return wrap({
    title: 'Destek talebiniz alındı',
    preheader: 'Destek talebiniz alındı — ekibimiz en kısa sürede dönecektir.',
    body,
  });
}

// ─── Şifre değiştirildi ───────────────────────────────────────────────────────

interface PasswordChangedInput {
  recipientName: string;
}

export function renderPasswordChanged(p: PasswordChangedInput): string {
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.recipientName)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Hesabınızın şifresi başarıyla değiştirildi.</p>
    <div style="margin:0 0 16px 0;padding:14px 16px;background:#fef9c3;border-left:3px solid #ca8a04;border-radius:6px;font-size:14px;color:#713f12;">
      Bu işlemi siz yapmadıysanız lütfen hemen bizimle iletişime geçin.
    </div>
    <p style="margin:0;color:${MUTED};font-size:13px;">Güvenliğiniz için şifrenizi kimseyle paylaşmayınız.</p>`;

  return wrap({
    title: 'Şifreniz değiştirildi',
    preheader: 'Hesabınızın şifresi başarıyla değiştirildi.',
    body,
  });
}

// ─── Şifre sıfırlama linki ────────────────────────────────────────────────────

interface PasswordResetInput {
  recipientName: string;
  /** 5 dk geçerli tek-kullanımlık sıfırlama URL'i (ham token URL'de). */
  resetUrl: string;
}

export function renderPasswordReset(p: PasswordResetInput): string {
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.recipientName)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Hesabınız için bir şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki butona tıklayın:</p>
    <div style="text-align:center;margin:0 0 20px 0;">
      <a href="${escapeHtml(p.resetUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;font-size:15px;">Şifremi Sıfırla</a>
    </div>
    <div style="margin:0 0 16px 0;padding:14px 16px;background:#fef9c3;border-left:3px solid #ca8a04;border-radius:6px;font-size:14px;color:#713f12;">
      Bu bağlantı <strong>yalnızca 5 dakika</strong> geçerlidir. Süre dolarsa giriş ekranından tekrar &ldquo;Şifremi unuttum&rdquo; adımını başlatabilirsiniz.
    </div>
    <p style="margin:0 0 12px 0;font-size:13px;color:${MUTED};">Buton çalışmıyorsa bu bağlantıyı tarayıcınıza kopyalayın:<br /><span style="word-break:break-all;color:${BLUE};">${escapeHtml(p.resetUrl)}</span></p>
    <p style="margin:0 0 12px 0;font-size:13px;color:${MUTED};">Bu e-posta <strong>spam / gereksiz</strong> kutunuza düşmüş olabilir; bulamazsanız oralara da bakınız.</p>
    <p style="margin:0;font-size:13px;color:${MUTED};">Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.</p>`;

  return wrap({
    title: 'Şifre sıfırlama talebi',
    preheader: 'Yeni şifrenizi belirlemek için bağlantıya tıklayın (5 dk geçerli).',
    body,
  });
}

// ─── Siparişiniz hazırlanıyor ─────────────────────────────────────────────────

interface OrderPreparingInput {
  customerName: string;
  humanOrderNo: string | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  marketplace?: string | null;
}

export function renderOrderPreparing(p: OrderPreparingInput): string {
  const orderBadge = p.humanOrderNo
    ? `<span style="display:inline-block;background:${BLUE};color:#fff;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;">${escapeHtml(p.humanOrderNo)}</span>`
    : '';

  const rows: string[] = [];
  if (p.marketplace) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};width:160px;">Satış Kanalı</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(marketplaceLabelTr(p.marketplace))}</td></tr>`,
    );
  }
  if (p.cargoCompany) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Firması</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoCompany)}</td></tr>`,
    );
  }
  if (p.cargoBarcode) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Barkodu</td><td style="padding:8px 14px;color:${NAVY};font-weight:700;letter-spacing:0.5px;font-family:Consolas,Menlo,monospace;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoBarcode)}</td></tr>`,
    );
  }

  const cargoTable = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">${rows.join('')}</table>`
    : '';

  const body = `
    <p style="margin:0 0 8px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Siparişiniz hazırlanıyor. ${orderBadge}</p>
    ${cargoTable}
    <p style="margin:0;color:${MUTED};font-size:13px;">Kargoya verildiğinde ayrıca bilgilendirileceksiniz.</p>`;

  return wrap({
    title: 'Siparişiniz hazırlanıyor',
    preheader:
      'Siparişiniz hazırlanıyor — kargoya verilince bilgilendireceğiz.',
    body,
  });
}

// ─── Sipariş durumu değişti (genel) ──────────────────────────────────────────

interface OrderStatusChangedInput {
  customerName: string;
  humanOrderNo: string | null;
  fromLabel: string;
  toLabel: string;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  marketplace?: string | null;
  note?: string | null;
}

export function renderOrderStatusChanged(p: OrderStatusChangedInput): string {
  const orderBadge = p.humanOrderNo
    ? `<span style="display:inline-block;background:${BLUE};color:#fff;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;">${escapeHtml(p.humanOrderNo)}</span>`
    : '';

  const rows: string[] = [];
  rows.push(
    `<tr><td style="padding:8px 14px;color:${MUTED};width:160px;">Önceki Durum</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(p.fromLabel)}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Yeni Durum</td><td style="padding:8px 14px;color:${BLUE};font-weight:700;border-top:1px solid ${BORDER};">${escapeHtml(p.toLabel)}</td></tr>`,
  );
  if (p.marketplace) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Satış Kanalı</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(marketplaceLabelTr(p.marketplace))}</td></tr>`,
    );
  }
  if (p.cargoCompany) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Firması</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoCompany)}</td></tr>`,
    );
  }
  if (p.cargoBarcode) {
    rows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Barkodu</td><td style="padding:8px 14px;color:${NAVY};font-weight:700;letter-spacing:0.5px;font-family:Consolas,Menlo,monospace;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoBarcode)}</td></tr>`,
    );
  }

  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">${rows.join('')}</table>`;

  const noteBlock = p.note
    ? `<p style="margin:12px 0 0 0;padding:10px 14px;background:${SOFT_BG};border-left:3px solid ${BLUE};color:${NAVY};font-size:13px;">${escapeHtml(p.note)}</p>`
    : '';

  const body = `
    <p style="margin:0 0 8px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Siparişinizin durumu güncellendi. ${orderBadge}</p>
    ${table}
    ${noteBlock}
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Sipariş detayınızı hesap sayfanızdan görüntüleyebilirsiniz.</p>`;

  return wrap({
    title: 'Sipariş durumunuz güncellendi',
    preheader: `Sipariş ${p.humanOrderNo ?? ''} → ${p.toLabel}`,
    body,
  });
}

// ─── Admin: Yeni admin eklendi ────────────────────────────────────────────────

interface AdminNewAdminInput {
  newAdminName: string;
  newAdminEmail: string;
  addedByName: string;
}

export function renderAdminNewAdmin(p: AdminNewAdminInput): string {
  const body = `
    <p style="margin:0 0 12px 0;">Sisteme yeni bir yönetici eklendi:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr>
        <td style="padding:10px 14px;color:${MUTED};width:140px;">Ad Soyad</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;">${escapeHtml(p.newAdminName)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">E-posta</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.newAdminEmail)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Ekleyen</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.addedByName)}</td>
      </tr>
    </table>
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Bu işlemi siz yapmadıysanız lütfen güvenlik ekibinizle iletişime geçin.</p>`;

  return wrap({
    title: 'Yeni yönetici eklendi',
    preheader: `${p.newAdminEmail} sisteme yönetici olarak eklendi.`,
    body,
  });
}

// ─── Admin: Farklı cihazdan giriş ────────────────────────────────────────────

interface AdminNewDeviceLoginInput {
  adminName: string;
  ip?: string | null;
  userAgent?: string | null;
  loginAt: Date;
}

export function renderAdminNewDeviceLogin(p: AdminNewDeviceLoginInput): string {
  const dateStr = p.loginAt.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
  });
  const ipRow = p.ip
    ? `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">IP Adresi</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;font-family:Consolas,Menlo,monospace;border-top:1px solid ${BORDER};">${escapeHtml(p.ip)}</td></tr>`
    : '';
  const uaRow = p.userAgent
    ? `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Tarayıcı/Cihaz</td><td style="padding:8px 14px;color:${TEXT};border-top:1px solid ${BORDER};font-size:12px;word-break:break-all;">${escapeHtml(p.userAgent)}</td></tr>`
    : '';

  const body = `
    <div style="margin:0 0 16px 0;padding:14px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;font-size:14px;color:#7f1d1d;">
      Hesabınıza <strong>yeni bir cihazdan</strong> giriş yapıldı.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr>
        <td style="padding:8px 14px;color:${MUTED};width:160px;">Hesap</td>
        <td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(p.adminName)}</td>
      </tr>
      <tr>
        <td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Giriş Zamanı</td>
        <td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(dateStr)}</td>
      </tr>
      ${ipRow}
      ${uaRow}
    </table>
    <p style="margin:16px 0 0 0;color:${MUTED};font-size:13px;">Bu işlemi siz yapmadıysanız hemen şifrenizi değiştirin ve ekibinizi bilgilendirin.</p>`;

  return wrap({
    title: 'Yeni cihazdan giriş yapıldı',
    preheader: 'Yönetici hesabınıza yeni bir cihazdan giriş yapıldı.',
    body,
  });
}

// ─── Admin: Yeni tedarikçi eklendi ───────────────────────────────────────────

interface AdminNewSupplierInput {
  supplierName: string;
  addedByName: string;
}

export function renderAdminNewSupplier(p: AdminNewSupplierInput): string {
  const body = `
    <p style="margin:0 0 12px 0;">Sisteme yeni bir tedarikçi eklendi:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr>
        <td style="padding:10px 14px;color:${MUTED};width:140px;">Tedarikçi</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:700;">${escapeHtml(p.supplierName)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Ekleyen</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.addedByName)}</td>
      </tr>
    </table>`;

  return wrap({
    title: 'Yeni tedarikçi eklendi',
    preheader: `${p.supplierName} tedarikçisi sisteme eklendi.`,
    body,
  });
}

// ─── Admin: Büyük cari bakiye onayı ──────────────────────────────────────────

interface AdminLargeTopupInput {
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  approvedByName: string;
  humanTopupNo?: string | null;
}

export function renderAdminLargeTopup(p: AdminLargeTopupInput): string {
  const topupNoRow = p.humanTopupNo
    ? `
      <tr>
        <td style="padding:10px 14px;color:${MUTED};width:140px;">Talep no</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:700;letter-spacing:0.5px;">${escapeHtml(p.humanTopupNo)}</td>
      </tr>`
    : '';
  const firstRowBorderTop = p.humanTopupNo
    ? `border-top:1px solid ${BORDER};`
    : '';
  const titleSuffix = p.humanTopupNo ? ` — ${escapeHtml(p.humanTopupNo)}` : '';
  const body = `
    <p style="margin:0 0 12px 0;">Yüksek tutarlı bir cari bakiye yüklemesi onaylandı:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      ${topupNoRow}
      <tr>
        <td style="padding:10px 14px;color:${MUTED};width:140px;${firstRowBorderTop}">Müşteri</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;${firstRowBorderTop}">${escapeHtml(p.customerName)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">E-posta</td>
        <td style="padding:10px 14px;color:${NAVY};border-top:1px solid ${BORDER};">${escapeHtml(p.customerEmail)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Tutar</td>
        <td style="padding:10px 14px;border-top:1px solid ${BORDER};font-size:18px;font-weight:700;color:#15803d;">${formatMoney(p.amount, p.currency)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Onaylayan</td>
        <td style="padding:10px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.approvedByName)}</td>
      </tr>
    </table>`;

  return wrap({
    title: `Yüksek tutarlı cari yükleme onaylandı${titleSuffix}`,
    preheader: `${formatMoney(p.amount, p.currency)} tutarında cari yükleme onaylandı.`,
    body,
  });
}

// ─── Admin: Yeni sipariş bildirimi ───────────────────────────────────────────

interface AdminNewOrderInput {
  humanOrderNo: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  subtotal: number;
  kdvAmount: number;
  // Paketleme ücreti (KDV-hariç). Null/0 ise satır gizlenir.
  packagingCost?: number | null;
  total: number;
  currency: string;
  paymentType: string | null;
  items: { name: string; qty: number; unitPrice: number }[];
  cariBalanceBefore: number | null;
  cariBalanceAfter: number | null;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
}

export function renderAdminNewOrder(p: AdminNewOrderInput): string {
  const orderNoBadge = p.humanOrderNo
    ? `<span style="display:inline-block;background:${BLUE};color:#fff;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:0.4px;">${escapeHtml(p.humanOrderNo)}</span>`
    : '';

  const isCari = p.paymentType === 'cari' || p.paymentType === 'cari_balance';
  const paymentLabel = isCari
    ? 'Cari bakiye'
    : p.paymentType === 'card'
      ? 'Kredi / Banka kartı'
      : (p.paymentType ?? '—');

  const itemRows = p.items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(it.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};text-align:center;">${it.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${BORDER};text-align:right;">${formatMoney(it.unitPrice, p.currency)}</td>
      </tr>`,
    )
    .join('');

  const customerRows: string[] = [];
  customerRows.push(
    `<tr><td style="padding:8px 14px;color:${MUTED};width:140px;">Müşteri</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(p.customerName)}</td></tr>`,
  );
  if (p.customerEmail) {
    customerRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">E-posta</td><td style="padding:8px 14px;color:${NAVY};border-top:1px solid ${BORDER};">${escapeHtml(p.customerEmail)}</td></tr>`,
    );
  }
  if (p.customerPhone) {
    customerRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Telefon</td><td style="padding:8px 14px;color:${NAVY};border-top:1px solid ${BORDER};">${escapeHtml(p.customerPhone)}</td></tr>`,
    );
  }
  customerRows.push(
    `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Ödeme yöntemi</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(paymentLabel)}</td></tr>`,
  );

  const cariRows =
    isCari && p.cariBalanceBefore != null && p.cariBalanceAfter != null
      ? `<tr><td style="padding:4px 0;color:${MUTED};">Cari bakiye (öncesi)</td><td style="padding:4px 0;text-align:right;">${formatMoney(p.cariBalanceBefore, p.currency)}</td></tr>
         <tr><td style="padding:4px 0;color:${MUTED};">Düşülen tutar</td><td style="padding:4px 0;text-align:right;">${formatMoney(p.total, p.currency)}</td></tr>
         <tr><td style="padding:4px 0;color:${MUTED};">Cari bakiye (sonrası)</td><td style="padding:4px 0;text-align:right;font-weight:700;color:${NAVY};">${formatMoney(p.cariBalanceAfter, p.currency)}</td></tr>`
      : '';

  const cargoRows: string[] = [];
  if (p.marketplace)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};width:160px;">Satış Kanalı</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;">${escapeHtml(marketplaceLabelTr(p.marketplace))}</td></tr>`,
    );
  if (p.cargoCompany)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Firması</td><td style="padding:8px 14px;color:${NAVY};font-weight:600;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoCompany)}</td></tr>`,
    );
  if (p.cargoBarcode)
    cargoRows.push(
      `<tr><td style="padding:8px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Kargo Barkodu</td><td style="padding:8px 14px;color:${NAVY};font-weight:700;letter-spacing:0.5px;font-family:Consolas,Menlo,monospace;border-top:1px solid ${BORDER};">${escapeHtml(p.cargoBarcode)}</td></tr>`,
    );
  const cargoTable = cargoRows.length
    ? `<p style="margin:20px 0 8px 0;font-weight:600;color:${NAVY};font-size:14px;">Kargo Bilgileri</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">${cargoRows.join('')}</table>`
    : '';

  const body = `
    <p style="margin:0 0 8px 0;">Yeni bir sipariş alındı. ${orderNoBadge}</p>
    <p style="margin:20px 0 8px 0;font-weight:600;color:${NAVY};font-size:14px;">Müşteri</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      ${customerRows.join('')}
    </table>
    <p style="margin:20px 0 8px 0;font-weight:600;color:${NAVY};font-size:14px;">Ürünler</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="color:${MUTED};text-align:left;">
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};">Ürün</th>
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};text-align:center;">Adet</th>
          <th style="padding:8px 0;border-bottom:2px solid ${NAVY};text-align:right;">Birim</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
      <tr>
        <td style="padding:4px 0;color:${MUTED};">Ara toplam</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.subtotal, p.currency)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:${MUTED};">KDV</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.kdvAmount, p.currency)}</td>
      </tr>
      ${
        p.packagingCost && p.packagingCost > 0
          ? `<tr>
        <td style="padding:4px 0;color:${MUTED};">Paketleme</td>
        <td style="padding:4px 0;text-align:right;">${formatMoney(p.packagingCost, p.currency)}</td>
      </tr>`
          : ''
      }
      <tr>
        <td style="padding:8px 0;color:${NAVY};font-weight:700;border-top:1px solid ${BORDER};">Toplam</td>
        <td style="padding:8px 0;text-align:right;color:${NAVY};font-weight:700;border-top:1px solid ${BORDER};">${formatMoney(p.total, p.currency)}</td>
      </tr>
      ${cariRows}
    </table>
    ${cargoTable}`;

  return wrap({
    title: 'Yeni sipariş alındı',
    preheader: `${p.customerName} ${formatMoney(p.total, p.currency)} tutarında sipariş verdi.`,
    body,
  });
}

// ─── Sipariş onayı (geliştirilmiş) ───────────────────────────────────────────

interface DealerWelcomeInput {
  name: string;
  email: string;
  tempPassword: string;
  loginUrl?: string;
}

/**
 * Bayi WhatsApp topluluğu davet linki. `COMPANY_WHATSAPP_COMMUNITY_URL` env'i
 * boşsa e-postada topluluk bloğu HİÇ gösterilmez.
 */
const WHATSAPP_COMMUNITY_URL =
  process.env.COMPANY_WHATSAPP_COMMUNITY_URL?.trim() || '';

export function renderDealerWelcome(p: DealerWelcomeInput): string {
  const loginUrl = p.loginUrl ?? `${COMPANY_URL}/giris`;
  const body = `
    <p style="margin:0 0 12px 0;">Merhaba <strong>${escapeHtml(p.name)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Bayi başvurunuz <strong style="color:#15803d;">onaylandı</strong> ve hesabınız aktif hale getirildi. 🎉 Aşağıdaki bilgilerle hemen giriş yapabilirsiniz:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr>
        <td style="padding:12px 14px;color:${MUTED};width:140px;">E-posta</td>
        <td style="padding:12px 14px;color:${NAVY};font-weight:600;word-break:break-all;">${escapeHtml(p.email)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Geçici parola</td>
        <td style="padding:12px 14px;border-top:1px solid ${BORDER};"><span translate="no" style="display:inline-block;background:#ffffff;border:1px dashed ${BLUE};border-radius:6px;padding:6px 12px;color:${NAVY};font-weight:700;font-size:16px;letter-spacing:1px;font-family:Consolas,Menlo,monospace;">${escapeHtml(p.tempPassword)}</span></td>
      </tr>
    </table>
    <p style="margin:14px 0 18px 0;font-size:13px;color:${MUTED};">Güvenliğiniz için <strong style="color:${NAVY};">ilk girişte</strong> parolanızı değiştirmeniz <strong>zorunludur</strong>.</p>
    <p style="margin:0 0 18px 0;text-align:center;">
      <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">Giriş Yap</a>
    </p>
    <div style="margin:18px 0;padding:16px;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;color:${NAVY};">
      <p style="margin:0 0 10px 0;color:${MUTED};">Artık bayi panelinden tüm kataloğa ve toptan fiyatlara erişebilirsiniz.</p>
      <p style="margin:0 0 6px 0;font-weight:600;">Sizi bekleyen bazı avantajlar:</p>
      <ul style="margin:0 0 10px 0;padding-left:18px;line-height:1.7;">
        <li>Geniş ürün kataloğuna erişim</li>
        <li>XML desteği</li>
        <li>Hızlı ve modern panel altyapısı</li>
        <li>Toplu ve hızlı sipariş oluşturmayı kolaylaştıran satın alma araçları</li>
        <li>XML yüklemeden de kullanım imkanı</li>
        <li>Hızlı operasyon ve sürdürülebilir stok yönetimi</li>
      </ul>
      <p style="margin:0;color:${MUTED};">${COMPANY_NAME} altyapısı sayesinde satış süreçlerinizi daha hızlı, daha pratik ve daha kârlı şekilde yönetebilirsiniz. Keyifli satışlar dileriz 🚀</p>
    </div>
    <p style="margin:0 0 0 0;color:${MUTED};font-size:13px;">Sorularınız için bize yazabilirsiniz. ${COMPANY_NAME} ailesine hoş geldiniz!</p>
    ${
      WHATSAPP_COMMUNITY_URL
        ? `<div style="margin:20px 0 0 0;padding:18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;text-align:center;">
      <p style="margin:0 0 12px 0;color:#166534;font-size:14px;font-weight:600;">💬 Bu bağlantıyı açarak bayi WhatsApp topluluğumuza katılabilirsiniz:</p>
      <p style="margin:0 0 14px 0;">
        <a href="${escapeHtml(WHATSAPP_COMMUNITY_URL)}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px;">WhatsApp Topluluğuna Katıl</a>
      </p>
      <p style="margin:0;"><a href="${escapeHtml(WHATSAPP_COMMUNITY_URL)}" style="color:#16a34a;font-size:12px;text-decoration:underline;word-break:break-all;">${escapeHtml(WHATSAPP_COMMUNITY_URL)}</a></p>
    </div>`
        : ''
    }`;
  return wrap({
    title: 'Bayi başvurunuz onaylandı',
    preheader: 'Bayi başvurunuz onaylandı — geçici parolanız ve giriş bilgileriniz hazır.',
    body,
  });
}

// ─── Günlük Z raporu ─────────────────────────────────────────────────────────

// Z raporu renk paleti — e-posta istemcilerinde güvenli düz renkler.
const Z_GREEN = '#15803d';
const Z_GREEN_BG = '#dcfce7';
const Z_RED = '#b91c1c';
const Z_RED_BG = '#fee2e2';
const Z_BAR = '#60a5fa';
const Z_BAR_TRACK = '#e8eef6';

interface ZReportKpi {
  /** Etiket, ör. "Toplam Ciro". */
  label: string;
  /** Para birimi ile biçimlenmiş değer. */
  value: string;
  /** Vurgu rengi (varsayılan NAVY). */
  accent?: string;
}

/** Düne / geçen haftaya kıyas rozeti. */
export interface ZReportDelta {
  /** Biçimlenmiş yüzde, ör. "%12,4" — ok işareti şablonda eklenir. */
  text: string;
  dir: 'up' | 'down' | 'flat';
  /** Ör. "düne göre", "geçen haftaya göre". */
  caption: string;
}

/** Üstteki büyük özet kartı (Net Ciro / Net Kâr). */
export interface ZReportHeroCard {
  label: string;
  value: string;
  /** Değer rengi (beyaz kart için). `inverse` true ise yok sayılır. */
  accent?: string;
  /** true → lacivert zemin, beyaz yazı (ana kart). */
  inverse?: boolean;
  deltas: ZReportDelta[];
}

/** Yatay çubuk grafik satırı. */
export interface ZReportBarRow {
  label: string;
  /** Etiket altındaki küçük yazı, ör. "12 sip.". */
  sub?: string;
  valueText: string;
  /** 0–100 çubuk doluluk yüzdesi. */
  pct: number;
  /** Çubuk rengi (varsayılan mavi). */
  color?: string;
  /** Satırı vurgula (rapor günü). */
  highlight?: boolean;
}

export interface ZReportBarChart {
  title: string;
  rows: ZReportBarRow[];
  /** Satır yoksa gösterilecek metin. */
  emptyText?: string;
}

/** "Günün rekorları" mini kartı. */
export interface ZReportRecordCard {
  icon: string;
  title: string;
  value: string;
  sub?: string;
}

/** Sıralı (madalyalı) bayi tablosu satırı. */
export interface ZReportRankedRow {
  /** 1 tabanlı sıra — ilk üçe madalya konur. */
  rank: number;
  name: string;
  /** İsim altındaki pay çubuğu doluluk yüzdesi (0–100). */
  pct: number;
  /** Sağa hizalı hücreler (sipariş, ciro, kâr). */
  cells: string[];
}

export interface ZReportRankedTable {
  title: string;
  headers: string[];
  rows: ZReportRankedRow[];
  emptyText?: string;
}

interface ZReportTableRow {
  /** İlk kolon — etiket. */
  label: string;
  /** Sıralı hücre değerleri (zaten biçimlenmiş string'ler). */
  cells: string[];
  /** Satırı vurgula (toplam satırı vb.). */
  emphasis?: boolean;
}

interface ZReportSection {
  title: string;
  /** Tablo başlık hücreleri — ilk kolon etiket olduğu için 1 + N hücre. */
  headers: string[];
  rows: ZReportTableRow[];
}

interface ZReportInput {
  /** İnsan-okur dönem etiketi, ör. "14.05.2026". */
  periodLabel: string;
  /** Uzun Türkçe gün adı etiketi, ör. "Cumartesi". Boş olabilir. */
  weekdayLabel?: string;
  currency: string;
  /** Üstteki büyük özet kartları (Net Ciro, Net Kâr). */
  heroes: ZReportHeroCard[];
  kpis: ZReportKpi[];
  /** Günün rekorları mini kartları. */
  records: ZReportRecordCard[];
  /** Son 8 gün ciro trendi. */
  trendChart: ZReportBarChart;
  /** Saatlik yoğunluk grafiği. */
  hourlyChart: ZReportBarChart;
  /** En çok alan bayiler. */
  topCustomers: ZReportRankedTable;
  /** Maliyet snapshot'ı eksik kalem varsa uyarı metni. */
  warning?: string;
  sections: ZReportSection[];
  /** CSV ekinin satır adedi — gövdede bilgilendirme için. */
  csvRowCount: number;
  /** Gizli önizleme metni (inbox listesinde görünen satır). */
  preheader?: string;
}

/** Kıyas rozeti — yeşil/kırmızı/gri hap. */
function renderZReportDeltaChip(d: ZReportDelta, inverse: boolean): string {
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•';
  let bg: string;
  let fg: string;
  if (inverse) {
    // Lacivert kart üstünde: yarı saydam yerine düz açık lacivert hap.
    bg = '#1d3a6b';
    fg = d.dir === 'up' ? '#86efac' : d.dir === 'down' ? '#fca5a5' : '#cbd5e1';
  } else {
    bg = d.dir === 'up' ? Z_GREEN_BG : d.dir === 'down' ? Z_RED_BG : SOFT_BG;
    fg = d.dir === 'up' ? Z_GREEN : d.dir === 'down' ? Z_RED : MUTED;
  }
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;margin:0 6px 4px 0;">${arrow} ${escapeHtml(d.text)} <span style="font-weight:400;">${escapeHtml(d.caption)}</span></span>`;
}

/** Üst özet kartları — yan yana 2 büyük kart. */
function renderZReportHeroes(heroes: ZReportHeroCard[]): string {
  const cards = heroes
    .map((h) => {
      const bg = h.inverse ? NAVY : '#ffffff';
      const labelColor = h.inverse ? '#9db3d4' : MUTED;
      const valueColor = h.inverse ? '#ffffff' : (h.accent ?? NAVY);
      const border = h.inverse ? NAVY : BORDER;
      const chips = h.deltas.map((d) => renderZReportDeltaChip(d, !!h.inverse)).join('');
      return `
      <td width="50%" style="padding:6px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:12px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-size:12px;color:${labelColor};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">${escapeHtml(h.label)}</div>
            <div style="font-size:26px;font-weight:800;color:${valueColor};margin:6px 0 10px 0;">${h.value}</div>
            <div>${chips}</div>
          </td></tr>
        </table>
      </td>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px -6px 2px -6px;"><tr>${cards}</tr></table>`;
}

/** E-posta güvenli yatay çubuk — iç içe tablo, div yok. */
function renderZReportBar(
  pct: number,
  color: string,
  height: number,
): string {
  const safePct = Math.max(0, Math.min(100, Math.round(pct)));
  // Görünürlük: 0 dışında en az %2 doluluk çiz.
  const fill = safePct === 0 ? 0 : Math.max(2, safePct);
  const fillTd =
    fill > 0
      ? `<td width="${fill}%" style="background:${color};height:${height}px;line-height:${height}px;font-size:1px;border-radius:${Math.floor(height / 2)}px;">&nbsp;</td>`
      : '';
  const rest =
    fill < 100
      ? `<td width="${100 - fill}%" style="height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</td>`
      : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${Z_BAR_TRACK};border-radius:${Math.floor(height / 2)}px;"><tr>${fillTd}${rest}</tr></table>`;
}

/** Yatay çubuk grafik bölümü. */
function renderZReportBarChart(chart: ZReportBarChart): string {
  const rows = chart.rows.length
    ? chart.rows
        .map((r) => {
          const color = r.color ?? Z_BAR;
          const labelWeight = r.highlight ? '800' : '600';
          const labelColor = r.highlight ? NAVY : TEXT;
          const sub = r.sub
            ? `<div style="font-size:11px;color:${MUTED};">${escapeHtml(r.sub)}</div>`
            : '';
          return `
        <tr>
          <td width="92" style="padding:5px 10px 5px 0;font-size:13px;font-weight:${labelWeight};color:${labelColor};white-space:nowrap;">${escapeHtml(r.label)}${sub}</td>
          <td style="padding:5px 0;vertical-align:middle;">${renderZReportBar(r.pct, color, 14)}</td>
          <td width="112" align="right" style="padding:5px 0 5px 10px;font-size:13px;font-weight:${labelWeight};color:${labelColor};white-space:nowrap;">${r.valueText}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td style="padding:10px 0;color:${MUTED};font-size:13px;">${escapeHtml(chart.emptyText ?? 'Kayıt yok')}</td></tr>`;

  return `
    <p style="margin:22px 0 8px 0;font-weight:700;color:${NAVY};font-size:15px;">${escapeHtml(chart.title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
}

/** Günün rekorları — 2×2 mini kart ızgarası. */
function renderZReportRecordCards(records: ZReportRecordCard[]): string {
  if (records.length === 0) return '';
  const cells = records.map(
    (r) => `
      <td width="50%" style="padding:6px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT_BG};border:1px solid ${BORDER};border-radius:10px;">
          <tr><td style="padding:12px 14px;">
            <div style="font-size:12px;color:${MUTED};font-weight:600;">${r.icon} ${escapeHtml(r.title)}</div>
            <div style="font-size:17px;font-weight:800;color:${NAVY};margin-top:5px;">${r.value}</div>
            ${r.sub ? `<div style="font-size:12px;color:${MUTED};margin-top:3px;">${escapeHtml(r.sub)}</div>` : ''}
          </td></tr>
        </table>
      </td>`,
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>${cells.slice(i, i + 2).join('')}</tr>`);
  }
  return `
    <p style="margin:22px 0 2px 0;font-weight:700;color:${NAVY};font-size:15px;">🏅 Günün Rekorları</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;">${rows.join('')}</table>`;
}

const RANK_BADGES = ['🥇', '🥈', '🥉'] as const;

/** En çok alan bayiler — madalyalı, pay çubuklu tablo. */
function renderZReportRankedTable(table: ZReportRankedTable): string {
  const headerCells = table.headers
    .map(
      (h, idx) =>
        `<th style="padding:8px 10px;border-bottom:2px solid ${NAVY};text-align:${idx === 0 ? 'left' : 'right'};color:${MUTED};font-size:13px;">${escapeHtml(h)}</th>`,
    )
    .join('');

  const bodyRows = table.rows.length
    ? table.rows
        .map((r) => {
          const badge = RANK_BADGES[r.rank - 1] ?? `${r.rank}.`;
          const labelCell = `
            <td style="padding:9px 10px;border-bottom:1px solid ${BORDER};">
              <div style="font-weight:600;color:${NAVY};font-size:14px;">${badge} ${escapeHtml(r.name)}</div>
              <div style="margin-top:5px;max-width:180px;">${renderZReportBar(r.pct, Z_BAR, 8)}</div>
            </td>`;
          const valueCells = r.cells
            .map(
              (c) =>
                `<td style="padding:9px 10px;border-bottom:1px solid ${BORDER};text-align:right;color:${TEXT};font-size:13px;white-space:nowrap;">${c}</td>`,
            )
            .join('');
          return `<tr>${labelCell}${valueCells}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${table.headers.length}" style="padding:12px 10px;color:${MUTED};font-size:13px;text-align:center;">${escapeHtml(table.emptyText ?? 'Kayıt yok')}</td></tr>`;

  return `
    <p style="margin:22px 0 6px 0;font-weight:700;color:${NAVY};font-size:15px;">${escapeHtml(table.title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

function renderZReportKpiCard(k: ZReportKpi): string {
  return `
      <td width="50%" style="padding:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT_BG};border:1px solid ${BORDER};border-radius:10px;">
          <tr><td style="padding:14px 16px;">
            <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(k.label)}</div>
            <div style="font-size:22px;font-weight:700;color:${k.accent ?? NAVY};margin-top:6px;">${k.value}</div>
          </td></tr>
        </table>
      </td>`;
}

function renderZReportKpiCards(kpis: ZReportKpi[]): string {
  // İki sütunlu grid — her satırda 2 kart.
  const rows: string[] = [];
  for (let i = 0; i < kpis.length; i += 2) {
    const pair = kpis
      .slice(i, i + 2)
      .map(renderZReportKpiCard)
      .join('');
    rows.push(`<tr>${pair}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px -6px 8px -6px;">${rows.join('')}</table>`;
}

function renderZReportSection(section: ZReportSection): string {
  const headerCells = section.headers
    .map(
      (h, idx) =>
        `<th style="padding:8px 10px;border-bottom:2px solid ${NAVY};text-align:${idx === 0 ? 'left' : 'right'};color:${MUTED};font-size:13px;">${escapeHtml(h)}</th>`,
    )
    .join('');

  const bodyRows = section.rows.length
    ? section.rows
        .map((r) => {
          const bg = r.emphasis ? `background:${SOFT_BG};` : '';
          const weight = r.emphasis ? 'font-weight:700;' : '';
          const labelCell = `<td style="padding:8px 10px;border-bottom:1px solid ${BORDER};color:${NAVY};${weight}${bg}">${escapeHtml(r.label)}</td>`;
          const valueCells = r.cells
            .map(
              (c) =>
                `<td style="padding:8px 10px;border-bottom:1px solid ${BORDER};text-align:right;color:${TEXT};${weight}${bg}">${c}</td>`,
            )
            .join('');
          return `<tr>${labelCell}${valueCells}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${section.headers.length}" style="padding:12px 10px;color:${MUTED};font-size:13px;text-align:center;">Kayıt yok</td></tr>`;

  return `
    <p style="margin:22px 0 6px 0;font-weight:600;color:${NAVY};font-size:15px;">${escapeHtml(section.title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

/**
 * Günlük Z raporu e-postası. Tüm sayısal değerler çağıran tarafça
 * biçimlenmiş string olarak geçirilir; bu şablon yalnız düzenler.
 */
export function renderZReport(p: ZReportInput): string {
  const warningBanner = p.warning
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;">
         <tr><td style="padding:12px 14px;color:#92400e;font-size:13px;">⚠️ ${escapeHtml(p.warning)}</td></tr>
       </table>`
    : '';

  const sectionsHtml = p.sections.map(renderZReportSection).join('');
  const weekdaySuffix = p.weekdayLabel
    ? ` <span style="color:${MUTED};font-weight:600;font-size:15px;">· ${escapeHtml(p.weekdayLabel)}</span>`
    : '';

  const body = `
    <p style="margin:0 0 4px 0;color:${MUTED};font-size:13px;">Dönem</p>
    <p style="margin:0 0 14px 0;color:${NAVY};font-size:18px;font-weight:700;">${escapeHtml(p.periodLabel)}${weekdaySuffix}</p>
    ${renderZReportHeroes(p.heroes)}
    ${renderZReportKpiCards(p.kpis)}
    ${warningBanner}
    ${renderZReportRecordCards(p.records)}
    ${renderZReportBarChart(p.trendChart)}
    ${renderZReportRankedTable(p.topCustomers)}
    ${renderZReportBarChart(p.hourlyChart)}
    ${sectionsHtml}
    <p style="margin:24px 0 0 0;color:${MUTED};font-size:13px;">
      Sipariş detayları ekteki CSV dosyasındadır (${p.csvRowCount} satır).
    </p>`;

  return wrap({
    title: `Z Raporu — ${escapeHtml(p.periodLabel)}`,
    preheader:
      p.preheader ?? `${p.periodLabel} günlük iş özeti: ciro, maliyet, kâr.`,
    body,
  });
}

// ─── Sipariş iptal edildi — bedel cari hesaba iade ─────────────────────────────

export interface OrderCancelledRefundInput {
  customerName: string;
  humanOrderNo: string | null;
  refundAmount: number;
  /** İade işlenmeden ÖNCEKİ cari bakiye (negatif = borç). */
  previousBalance: number;
  /** İade işlendikten SONRAKİ cari bakiye. */
  newBalance: number;
  currency: string;
  reason?: string | null;
}

export function renderOrderCancelledRefund(
  p: OrderCancelledRefundInput,
): string {
  const orderBadge = p.humanOrderNo
    ? `<span style="display:inline-block;background:${BLUE};color:#fff;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;">${escapeHtml(p.humanOrderNo)}</span>`
    : '';

  const body = `
    <p style="margin:0 0 8px 0;">Merhaba <strong>${escapeHtml(p.customerName)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Siparişiniz iptal edildi. ${orderBadge}</p>
    <p style="margin:0 0 16px 0;">Sipariş bedeli <strong>cari hesabınıza eklenmiştir</strong>. Tutarı dilediğiniz yeni siparişte kullanabilirsiniz.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      <tr><td style="padding:10px 14px;color:${MUTED};width:200px;">Önceki cari bakiye</td><td style="padding:10px 14px;color:${NAVY};border-top:0;">${formatMoney(p.previousBalance, p.currency)}</td></tr>
      <tr><td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Cari hesabınıza eklenen</td><td style="padding:10px 14px;color:#15803d;font-weight:700;border-top:1px solid ${BORDER};">+ ${formatMoney(p.refundAmount, p.currency)}</td></tr>
      <tr><td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Yeni cari bakiye</td><td style="padding:10px 14px;color:${NAVY};font-weight:700;border-top:1px solid ${BORDER};">${formatMoney(p.newBalance, p.currency)}</td></tr>
      ${p.reason ? `<tr><td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">İptal gerekçesi</td><td style="padding:10px 14px;color:${NAVY};border-top:1px solid ${BORDER};">${escapeHtml(p.reason)}</td></tr>` : ''}
    </table>
    <p style="margin:0;color:${MUTED};font-size:13px;">Cari bakiyenizi hesap sayfanızdan görüntüleyebilirsiniz.</p>`;

  return wrap({
    title: 'Siparişiniz iptal edildi — bedel cari hesabınıza eklendi',
    preheader: `${p.humanOrderNo ?? 'Siparişiniz'} iptal edildi — ${formatMoney(p.refundAmount, p.currency)} cari hesabınıza eklendi.`,
    body,
  });
}

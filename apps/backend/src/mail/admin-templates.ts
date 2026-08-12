/**
 * Admin'lere gönderilen "yeni X talebi/mesajı geldi" şablonları.
 *
 * Mevcut `templates.ts` 800+ satıra dayandı; bu dosya yalnız yeni eklenen
 * admin bildirimleri için yapıldı. Ortak helper ve tema sabitleri
 * templates.ts'den re-export edilmiş hâliyle paylaşılır.
 */
import {
  BLUE,
  BORDER,
  MUTED,
  NAVY,
  SOFT_BG,
  escapeHtml,
  formatMoney,
  wrap,
} from './templates';

function infoRow(
  label: string,
  value: string,
  opts?: { strong?: boolean; first?: boolean },
): string {
  const border = opts?.first ? '' : `border-top:1px solid ${BORDER};`;
  const weight = opts?.strong ? 'font-weight:700;' : '';
  return `
    <tr>
      <td style="padding:10px 14px;color:${MUTED};width:160px;${border}">${escapeHtml(label)}</td>
      <td style="padding:10px 14px;color:${NAVY};${weight}${border}">${value}</td>
    </tr>`;
}

function infoTable(rows: string[]): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:${SOFT_BG};border:1px solid ${BORDER};border-radius:8px;font-size:14px;">
      ${rows.join('')}
    </table>`;
}

function messageBlock(title: string, body: string): string {
  return `
    <p style="margin:18px 0 6px 0;color:${MUTED};font-size:13px;">${escapeHtml(title)}</p>
    <div style="padding:14px 16px;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;color:${NAVY};font-size:14px;white-space:pre-wrap;">${escapeHtml(body)}</div>`;
}

function ctaButton(href: string, label: string): string {
  return `
    <p style="margin:22px 0 0 0;text-align:center;">
      <a href="${href}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
    </p>`;
}

// ─── Admin: Yeni iletişim formu (CONTACT / CALLBACK) ─────────────────────────

export interface AdminNewContactFormInput {
  formType: 'CONTACT' | 'CALLBACK' | 'INTEGRATION';
  name: string;
  email: string | null;
  phone: string | null;
  company?: string | null;
  subject?: string | null;
  message: string;
  adminUrl?: string | null;
}

export function contactFormTypeLabel(
  formType: AdminNewContactFormInput['formType'],
): string {
  if (formType === 'CALLBACK') return 'Geri arama talebi';
  if (formType === 'INTEGRATION') return 'Entegrasyon başvurusu';
  return 'İletişim mesajı';
}

export function renderAdminNewContactForm(p: AdminNewContactFormInput): string {
  const typeLabel = contactFormTypeLabel(p.formType);
  const rows: string[] = [];
  rows.push(infoRow('Form tipi', escapeHtml(typeLabel), { strong: true, first: true }));
  rows.push(infoRow('Ad Soyad', escapeHtml(p.name)));
  if (p.email) rows.push(infoRow('E-posta', escapeHtml(p.email)));
  if (p.phone) rows.push(infoRow('Telefon', escapeHtml(p.phone)));
  if (p.company) rows.push(infoRow('Şirket', escapeHtml(p.company)));
  if (p.subject) rows.push(infoRow('Konu', escapeHtml(p.subject)));

  const body = `
    <p style="margin:0 0 12px 0;">Yeni bir ${escapeHtml(typeLabel.toLowerCase())} alındı.</p>
    ${infoTable(rows)}
    ${messageBlock('Mesaj', p.message)}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Yönetim panelinde aç') : ''}`;

  return wrap({
    title: `Yeni ${typeLabel.toLowerCase()}`,
    preheader: `${p.name} — ${(p.subject ?? p.message).slice(0, 80)}`,
    body,
  });
}

// ─── Admin: Yeni bayilik başvurusu ───────────────────────────────────────────

export interface AdminNewDealerApplicationInput {
  applicantName: string;
  email: string;
  phone: string;
  company?: string | null;
  city?: string | null;
  message?: string | null;
  adminUrl?: string | null;
}

export function renderAdminNewDealerApplication(
  p: AdminNewDealerApplicationInput,
): string {
  const rows: string[] = [];
  rows.push(infoRow('Ad Soyad', escapeHtml(p.applicantName), { strong: true, first: true }));
  rows.push(infoRow('E-posta', escapeHtml(p.email)));
  rows.push(infoRow('Telefon', escapeHtml(p.phone)));
  if (p.company) rows.push(infoRow('Şirket', escapeHtml(p.company)));
  if (p.city) rows.push(infoRow('Şehir', escapeHtml(p.city)));

  const body = `
    <p style="margin:0 0 12px 0;">Yeni bir bayilik başvurusu alındı. İnceleyip karar vermek gerekiyor.</p>
    ${infoTable(rows)}
    ${p.message ? messageBlock('Başvuru notu', p.message) : ''}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Başvuruyu incele') : ''}`;

  return wrap({
    title: 'Yeni bayilik başvurusu',
    preheader: `${p.applicantName} bayilik için başvurdu.`,
    body,
  });
}

// ─── Admin: Yeni destek mesajı ───────────────────────────────────────────────

export interface AdminNewSupportMessageInput {
  senderName: string;
  senderEmail: string;
  senderPhone?: string | null;
  subject?: string | null;
  message: string;
  adminUrl?: string | null;
}

export function renderAdminNewSupportMessage(
  p: AdminNewSupportMessageInput,
): string {
  const rows: string[] = [];
  rows.push(infoRow('Gönderen', escapeHtml(p.senderName), { strong: true, first: true }));
  rows.push(infoRow('E-posta', escapeHtml(p.senderEmail)));
  if (p.senderPhone) rows.push(infoRow('Telefon', escapeHtml(p.senderPhone)));
  if (p.subject) rows.push(infoRow('Konu', escapeHtml(p.subject)));

  const body = `
    <p style="margin:0 0 12px 0;">Yeni bir destek talebi geldi.</p>
    ${infoTable(rows)}
    ${messageBlock('Mesaj', p.message)}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Destek talebini aç') : ''}`;

  return wrap({
    title: 'Yeni destek talebi',
    preheader: `${p.senderName} destek talebi gönderdi.`,
    body,
  });
}

// ─── Admin: Yeni cari yükleme talebi ─────────────────────────────────────────

export interface AdminNewTopupRequestInput {
  customerName: string;
  customerEmail: string | null;
  amount: number;
  currency: string;
  note?: string | null;
  adminUrl?: string | null;
  humanTopupNo?: string | null;
}

export function renderAdminNewTopupRequest(
  p: AdminNewTopupRequestInput,
): string {
  const rows: string[] = [];
  const hasTopupNo = Boolean(p.humanTopupNo);
  if (p.humanTopupNo) {
    rows.push(
      infoRow('Talep No', escapeHtml(p.humanTopupNo), { strong: true, first: true }),
    );
  }
  rows.push(
    infoRow('Müşteri', escapeHtml(p.customerName), { strong: true, first: !hasTopupNo }),
  );
  if (p.customerEmail) rows.push(infoRow('E-posta', escapeHtml(p.customerEmail)));
  rows.push(
    `<tr>
       <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Tutar</td>
       <td style="padding:10px 14px;border-top:1px solid ${BORDER};font-size:18px;font-weight:700;color:#15803d;">${formatMoney(p.amount, p.currency)}</td>
     </tr>`,
  );

  const titleSuffix = p.humanTopupNo ? ` — ${escapeHtml(p.humanTopupNo)}` : '';
  const preheaderPrefix = p.humanTopupNo ? `${p.humanTopupNo} · ` : '';

  const body = `
    <p style="margin:0 0 12px 0;">Yeni bir cari bakiye yükleme talebi geldi. Onay bekliyor.</p>
    ${infoTable(rows)}
    ${p.note ? messageBlock('Müşteri notu', p.note) : ''}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Talebi incele') : ''}`;

  return wrap({
    title: `Yeni cari yükleme talebi${titleSuffix}`,
    preheader: `${preheaderPrefix}${p.customerName} — ${formatMoney(p.amount, p.currency)}`,
    body,
  });
}

// ─── Admin: Yeni cariden-ödeme talebi (sipariş için) ────────────────────────

export interface AdminNewCariPaymentRequestInput {
  customerName: string;
  customerEmail: string | null;
  humanOrderNo: string | null;
  amount: number;
  currency: string;
  adminUrl?: string | null;
}

export function renderAdminNewCariPaymentRequest(
  p: AdminNewCariPaymentRequestInput,
): string {
  const rows: string[] = [];
  rows.push(infoRow('Müşteri', escapeHtml(p.customerName), { strong: true, first: true }));
  if (p.customerEmail) rows.push(infoRow('E-posta', escapeHtml(p.customerEmail)));
  if (p.humanOrderNo) rows.push(infoRow('Sipariş No', escapeHtml(p.humanOrderNo)));
  rows.push(
    `<tr>
       <td style="padding:10px 14px;color:${MUTED};border-top:1px solid ${BORDER};">Tutar</td>
       <td style="padding:10px 14px;border-top:1px solid ${BORDER};font-size:18px;font-weight:700;color:${NAVY};">${formatMoney(p.amount, p.currency)}</td>
     </tr>`,
  );

  const body = `
    <p style="margin:0 0 12px 0;">Bir sipariş için cariden ödeme talebi geldi. Onay bekliyor.</p>
    ${infoTable(rows)}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Talebi incele') : ''}`;

  return wrap({
    title: 'Yeni cariden ödeme talebi',
    preheader: `${p.customerName} — ${formatMoney(p.amount, p.currency)}`,
    body,
  });
}

// ─── Admin: Sipariş dökümü dışa aktarıldı (yalnızca OWNER bildirimi) ─────────

function formatTrDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface AdminOrdersExportedInput {
  /** Dışa aktarmayı yapan kullanıcının e-postası. */
  actorEmail: string;
  /** Üretilen Excel dosyasının adı. */
  filename: string;
  /** Dosyadaki sipariş satırı sayısı. */
  count: number;
  /** Uygulanan filtreler (label/value çiftleri). Boşsa "filtresiz" yazılır. */
  filters: { label: string; value: string }[];
}

export function renderAdminOrdersExported(p: AdminOrdersExportedInput): string {
  const rows: string[] = [];
  rows.push(
    infoRow('Dışa aktaran', escapeHtml(p.actorEmail), {
      strong: true,
      first: true,
    }),
  );
  rows.push(infoRow('Tarih', escapeHtml(formatTrDateTime(new Date()))));
  rows.push(infoRow('Dosya', escapeHtml(p.filename)));
  rows.push(infoRow('Kayıt sayısı', `${p.count} sipariş`));
  if (p.filters.length === 0) {
    rows.push(infoRow('Filtre', 'Tüm siparişler (filtresiz)'));
  } else {
    for (const f of p.filters) {
      rows.push(infoRow(f.label, escapeHtml(f.value)));
    }
  }

  const body = `
    <p style="margin:0 0 12px 0;">Yönetim panelinde <strong>sipariş dökümü (cari hesap)</strong> Excel olarak dışa aktarıldı.</p>
    ${infoTable(rows)}
    <p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;">
      Bu dosya <strong>maliyet ve kâr</strong> bilgisi içerir; yalnızca yetkili
      kişilerle paylaşılmalıdır. Sipariş dökümü dışa aktarma yalnızca OWNER
      rolündeki kullanıcılar tarafından yapılabilir ve her aktarımda tüm
      OWNER'lara bu bilgilendirme gönderilir.
    </p>`;

  return wrap({
    title: 'Sipariş dökümü dışa aktarıldı',
    preheader: `${p.actorEmail} — ${p.count} sipariş`,
    body,
  });
}

// ─── Admin: Tedarikçi bakiyesi düşük ─────────────────────────────────────────

export interface AdminSupplierLowBalanceInput {
  supplierName: string;
  balance: number;
  threshold: number;
}

export function renderAdminSupplierLowBalance(
  p: AdminSupplierLowBalanceInput,
): string {
  const rows: string[] = [];
  rows.push(
    infoRow('Tedarikçi', escapeHtml(p.supplierName), {
      strong: true,
      first: true,
    }),
  );
  rows.push(
    infoRow(
      'Güncel bakiye',
      `<span style="color:#dc2626;font-weight:700;">${formatMoney(p.balance, 'TRY')}</span>`,
    ),
  );
  rows.push(infoRow('Uyarı eşiği', formatMoney(p.threshold, 'TRY')));

  const body = `
    <p style="margin:0 0 12px 0;">Bir tedarikçideki cüzdan bakiyeniz uyarı eşiğinin altına indi. Sipariş açma işlemlerinin aksamaması için tedarikçi sitesine para yatırmanız önerilir.</p>
    ${infoTable(rows)}`;

  return wrap({
    title: 'Tedarikçi bakiyesi düşük',
    preheader: `${p.supplierName} — ${formatMoney(p.balance, 'TRY')}`,
    body,
  });
}

// ─── Admin: Talebe/sohbete yeni müşteri mesajı ───────────────────────────────

export interface AdminConversationMessageInput {
  /** 'support' → destek talebi sohbeti, 'return' → iade satışı sohbeti */
  kind: 'support' | 'return';
  senderName: string;
  senderEmail?: string | null;
  subject?: string | null;
  humanOrderNo?: string | null;
  message: string;
  adminUrl?: string | null;
}

export function renderAdminConversationMessage(
  p: AdminConversationMessageInput,
): string {
  const title =
    p.kind === 'return' ? 'İade sohbetine yeni mesaj' : 'Talebe yeni mesaj';
  const rows: string[] = [];
  rows.push(infoRow('Gönderen', escapeHtml(p.senderName), { strong: true, first: true }));
  if (p.senderEmail) rows.push(infoRow('E-posta', escapeHtml(p.senderEmail)));
  if (p.subject) rows.push(infoRow('Konu', escapeHtml(p.subject)));
  if (p.humanOrderNo) rows.push(infoRow('Sipariş No', escapeHtml(p.humanOrderNo)));

  const body = `
    <p style="margin:0 0 12px 0;">${
      p.kind === 'return'
        ? 'Bir iade satışı sohbetine yeni mesaj yazıldı.'
        : 'Mevcut bir destek talebine/sohbete yeni mesaj yazıldı.'
    }</p>
    ${infoTable(rows)}
    ${messageBlock('Mesaj', p.message)}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Sohbeti aç') : ''}`;

  return wrap({
    title,
    preheader: `${p.senderName} — ${p.message.slice(0, 80)}`,
    body,
  });
}

// ─── Admin: Bot siparişi alamadı ─────────────────────────────────────────────

export interface AdminBotPurchaseFailedInput {
  humanOrderNo: string | null;
  customerName: string | null;
  supplierKey: string;
  lastError: string | null;
  adminUrl?: string | null;
}

export function renderAdminBotPurchaseFailed(
  p: AdminBotPurchaseFailedInput,
): string {
  const rows: string[] = [];
  if (p.humanOrderNo) {
    rows.push(infoRow('Sipariş No', escapeHtml(p.humanOrderNo), { strong: true, first: true }));
  }
  if (p.customerName) {
    rows.push(infoRow('Bayi', escapeHtml(p.customerName), { first: rows.length === 0 }));
  }
  rows.push(infoRow('Tedarikçi', escapeHtml(p.supplierKey), { first: rows.length === 0 }));

  const body = `
    <p style="margin:0 0 12px 0;">Satın alma botu bu siparişi tedarikçiden <strong>alamadı</strong>. Siparişin manuel olarak verilmesi gerekiyor.</p>
    ${infoTable(rows)}
    ${p.lastError ? messageBlock('Bot hatası', p.lastError) : ''}
    ${p.adminUrl ? ctaButton(p.adminUrl, 'Siparişi aç') : ''}`;

  return wrap({
    title: 'Bot siparişi alamadı',
    preheader: `${p.humanOrderNo ?? 'Sipariş'} — ${p.supplierKey} bot alamadı, manuel alım gerekli.`,
    body,
  });
}

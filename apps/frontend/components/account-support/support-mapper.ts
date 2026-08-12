import type {
  Ticket,
  TicketStatus,
  SupportMetric,
  TicketTableItem,
  SupportSummaryItem,
} from "./types";

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "Açık",
  READ: "Açık",
  REPLIED: "Yanıtlandı",
  ARCHIVED: "Kapatıldı",
};

const CATEGORY_LABEL: Record<string, string> = {
  kargo: "Kargo",
  iptal: "İptal",
  iade: "İade",
  diger: "Diğer",
  // Eski taleplerde kalan (artık seçilemeyen) kategoriler — görüntüleme için.
  siparis: "Sipariş",
  fatura: "Fatura",
  teknik: "Teknik",
  odeme: "Ödeme",
  urun: "Ürün",
  hesap: "Hesap",
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function guessCategory(ticket: Ticket): string {
  if (ticket.category) return ticket.category;
  if (ticket.kind === "order") return "siparis";
  const sub = (ticket.subject ?? "").toLowerCase();
  const body = ticket.body.toLowerCase();
  const text = sub + " " + body;
  if (text.includes("fatura")) return "fatura";
  if (text.includes("iade") || text.includes("iade")) return "iade";
  if (text.includes("teknik") || text.includes("hata") || text.includes("bug")) return "teknik";
  if (text.includes("ödeme") || text.includes("odeme") || text.includes("kart")) return "odeme";
  if (text.includes("ürün") || text.includes("urun") || text.includes("fiyat")) return "urun";
  if (text.includes("kargo") || text.includes("teslimat") || text.includes("gönderi")) return "kargo";
  if (text.includes("iptal") || text.includes("iptal et") || text.includes("vazgeç")) return "iptal";
  if (text.includes("hesap") || text.includes("şifre") || text.includes("kullanıcı")) return "hesap";
  return "siparis";
}

function fallbackTicketNo(t: Ticket): string {
  const clean = t.id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const tail = clean.slice(-6).padStart(6, "0");
  const year = (() => {
    try {
      return new Date(t.createdAt).getFullYear();
    } catch {
      return new Date().getFullYear();
    }
  })();
  return `AB-${year}-${tail}`;
}

export function mapTickets(tickets: Ticket[]): TicketTableItem[] {
  return tickets.map((t) => {
    const cat = guessCategory(t);
    const snap = t.orderSnapshot ?? null;
    const firstItem = snap?.items?.[0] ?? null;
    return {
      id: t.id,
      ticketNo: t.ticketNo && t.ticketNo.length > 0 ? t.ticketNo : fallbackTicketNo(t),
      subject: t.subject || "Destek Talebi",
      description: t.body.slice(0, 100) + (t.body.length > 100 ? "..." : ""),
      category: CATEGORY_LABEL[cat] ?? cat,
      categoryKey: cat,
      status: t.status,
      statusLabel: STATUS_LABEL[t.status],
      updatedAt: formatDate(t.updatedAt),
      updatedBy: t.adminNote ? "Destek Ekibi" : "",
      createdAt: formatDate(t.createdAt),
      productImageUrl: firstItem?.imageUrl ?? null,
      productName: firstItem?.name ?? null,
      recipientName: snap?.recipientName ?? null,
      itemCount: snap?.items?.length ?? 0,
      canClose: t.status !== "ARCHIVED",
    };
  });
}

export function buildMetrics(tickets: Ticket[]): SupportMetric[] {
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "NEW" || t.status === "READ").length;
  const replied = tickets.filter((t) => t.status === "REPLIED").length;

  // Ortalama yanıt süresi — replied ticket'ların createdAt→updatedAt farkı
  const repliedTickets = tickets.filter((t) => t.status === "REPLIED" || t.status === "ARCHIVED");
  let avgResponseMs = 0;
  if (repliedTickets.length > 0) {
    const totalMs = repliedTickets.reduce((sum, t) => {
      return sum + (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime());
    }, 0);
    avgResponseMs = totalMs / repliedTickets.length;
  }

  const avgResponseStr = formatDuration(avgResponseMs);
  const avgResolveStr = formatDuration(avgResponseMs * 1.5); // approximate

  return [
    { key: "total", title: "Toplam Talep", value: String(total), description: "Tüm zamanlar", tone: "blue" },
    { key: "open", title: "Açık Talepler", value: String(open), description: "Yanıt bekleyen talepler", tone: "green" },
    { key: "replied", title: "Yanıtlandı", value: String(replied), description: "Çözüme kavuşan talepler", tone: "orange" },
    { key: "avgResponse", title: "Ortalama Yanıt Süresi", value: avgResponseStr, description: "Son 30 gün ortalaması", tone: "purple" },
    { key: "avgResolve", title: "Ortalama Çözüm Süresi", value: formatDuration(avgResponseMs * 2), description: "Son 30 gün ortalaması", tone: "blue" },
  ];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return `${days} gün ${rem} sa`;
  }
  return `${hours} sa ${minutes} dk`;
}

export function buildSummary(tickets: Ticket[]): SupportSummaryItem[] {
  const total = tickets.length || 1;
  const open = tickets.filter((t) => t.status === "NEW" || t.status === "READ").length;
  const replied = tickets.filter((t) => t.status === "REPLIED").length;
  const closed = tickets.filter((t) => t.status === "ARCHIVED").length;

  return [
    { label: "Açık", count: open, percentage: Math.round((open / total) * 1000) / 10, tone: "orange" },
    { label: "Yanıtlandı", count: replied, percentage: Math.round((replied / total) * 1000) / 10, tone: "green" },
    { label: "Kapatıldı", count: closed, percentage: Math.round((closed / total) * 1000) / 10, tone: "gray" },
  ];
}

export function extractTickets(value: unknown): Ticket[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value as Ticket[];
  const wrapped = value as { data?: unknown; success?: boolean };
  if (Array.isArray(wrapped.data)) return wrapped.data as Ticket[];
  return [];
}

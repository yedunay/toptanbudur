import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  SUPPORT_TICKET_FILTER_LABELS,
  SUPPORT_TICKET_FILTER_ORDER,
  RETURN_FLOW_STATUS_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  closeSupportTicket,
  decideReturn,
  fetchSupportTicket,
  fetchSupportTickets,
  markTicketAsRead,
  replyToSupportTicket,
  reopenSupportTicket,
  type SupportTicket,
  type SupportTicketFilter,
  type SupportTicketListResponse,
  type SupportTicketStatus,
} from "../lib/support-tickets";
import {
  ORDER_STATUS_LABELS,
  fetchOrder,
  formatDateTime,
  formatOrderNo,
  updateOrderWithMeta,
  type OrderDetail,
  type OrderUpdateRefundMeta,
} from "../lib/orders";
import { useToast } from "../components/Toast";
import { useDebounce } from "../lib/useDebounce";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import AttachmentGallery from "../components/AttachmentGallery";
import ConversationChat, {
  type ConversationChatHandle,
} from "../components/ConversationChat";
import { TicketOrderPanel } from "../components/support/TicketOrderPanel";
import { canAccess } from "../lib/permissions";
import {
  ResolutionResultDialog,
  type ResolutionDialogKind,
} from "../components/support/ResolutionResultDialog";
import QuickRepliesModal from "../components/support/QuickRepliesModal";
import {
  fetchQuickReplies,
  fillQuickReply,
  type QuickReply,
  type QuickReplyIntent,
} from "../lib/support-quick-replies";

/** Karar panelinde admin'in seçebileceği iki nihai statü. */
type DecisionStatus = "cancelled" | "refunded";

/** Müşterinin niyetinden seçili default. */
type TicketIntent = "cancel" | "refund" | "neutral";

const PAGE_SIZE = 50;

/** Telefonu wa.me URL'ine uygun rakam-string'e çevirir. */
function normalizePhoneForWa(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 7) return null;
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  if (digits.length === 11 && digits.startsWith("05")) return `90${digits.slice(1)}`;
  return digits;
}

function statusColor(status: SupportTicketStatus): string {
  switch (status) {
    case "NEW":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "READ":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "REPLIED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ARCHIVED":
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function isPendingStatus(status: SupportTicketStatus): boolean {
  return status === "NEW" || status === "READ";
}

const CANCEL_KEYWORDS = [
  "iptal",
  "iptal et",
  "iptal edilsin",
  "iptal edebilir",
  "iptal istiyorum",
  "iptal talep",
  "vazgec",
  "vazgeç",
  "cancel",
];
const REFUND_KEYWORDS = [
  "iade",
  "iade et",
  "iade istiyorum",
  "iade talep",
  "geri ode",
  "geri öde",
  "para iade",
  "refund",
];

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function containsAny(haystack: string, needles: ReadonlyArray<string>): boolean {
  for (const needle of needles) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

/**
 * Müşterinin ne istediğini hem `category` hem de subject/body metninden çıkarır.
 * Eski talepler `category=iade` ile açılmış olsa bile metin "iptal" diyorsa
 * iptal akışını gösteririz; tersi de geçerli. Böylece yanlış kategorize edilmiş
 * talepler de doğru aksiyon butonunu üretir.
 */
function detectTicketIntent(ticket: SupportTicket): TicketIntent {
  const category = (ticket.category ?? "").toLocaleLowerCase("tr-TR").trim();
  if (category === "iptal") return "cancel";
  if (category === "iade") return "refund";

  const text = `${normalizeText(ticket.subject)} ${normalizeText(ticket.body)}`;
  const wantsCancel = containsAny(text, CANCEL_KEYWORDS);
  const wantsRefund = containsAny(text, REFUND_KEYWORDS);
  if (wantsCancel && !wantsRefund) return "cancel";
  if (wantsRefund && !wantsCancel) return "refund";
  if (wantsCancel && wantsRefund) {
    // Her ikisi de geçiyorsa subject'i öncelikleyelim — başlık çoğu zaman
    // gerçek niyeti taşır.
    const subj = normalizeText(ticket.subject);
    if (containsAny(subj, CANCEL_KEYWORDS)) return "cancel";
    if (containsAny(subj, REFUND_KEYWORDS)) return "refund";
    return "cancel";
  }
  return "neutral";
}

// Eski yerel `CargoCard` kaldırıldı — kargo bilgisi (pazaryeri/firma/takip
// kodu + tıklanabilir "Kargo Takip" linki) artık `TicketOrderPanel` içinde,
// sipariş kaydını tek kaynak alıp talepten gelen değerleri fallback olarak
// kullanacak şekilde tek yerde gösteriliyor (tekrar eden bilgi yok).

function statusLabelFor(status: SupportTicketStatus): string {
  return SUPPORT_TICKET_STATUS_LABELS[status];
}

/** Talep kategori kodu → Türkçe etiket. */
const CATEGORY_LABELS: Record<string, string> = {
  kargo: "Kargo",
  iptal: "İptal",
  iade: "İade",
  diger: "Diğer",
  // Müşteri artık yalnız yukarıdaki 4 türü seçebiliyor (2026-08-01);
  // aşağıdakiler ESKİ taleplerin rozetleri doğru görünsün diye duruyor.
  siparis: "Sipariş",
  fatura: "Fatura",
  teknik: "Teknik",
  odeme: "Ödeme",
  urun: "Ürün",
  hesap: "Hesap",
};

/** Kategoriye göre badge rengi — listede/detayda hızlı tanısınlar. */
const CATEGORY_BADGE_CLASS: Record<string, string> = {
  iptal: "border-rose-300 bg-rose-50 text-rose-700",
  iade: "border-amber-300 bg-amber-50 text-amber-700",
  kargo: "border-sky-300 bg-sky-50 text-sky-700",
  fatura: "border-violet-300 bg-violet-50 text-violet-700",
  odeme: "border-emerald-300 bg-emerald-50 text-emerald-700",
  teknik: "border-slate-300 bg-slate-50 text-slate-700",
  urun: "border-teal-300 bg-teal-50 text-teal-700",
  hesap: "border-indigo-300 bg-indigo-50 text-indigo-700",
  siparis: "border-blue-300 bg-blue-50 text-blue-700",
};

const NEUTRAL_BADGE_CLASS =
  "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]";

/**
 * Talebin "türü" için etiket + renk. Öncelik `category` alanında; boşsa
 * niyet tespitinden (iptal/iade) türetir, o da yoksa "Genel". Admin talebi
 * açmadan ne olduğunu anlasın diye.
 */
function ticketTypeBadge(ticket: SupportTicket): {
  label: string;
  className: string;
} {
  const cat = (ticket.category ?? "").toLocaleLowerCase("tr-TR").trim();
  if (cat && CATEGORY_LABELS[cat]) {
    return {
      label: CATEGORY_LABELS[cat],
      className: CATEGORY_BADGE_CLASS[cat] ?? NEUTRAL_BADGE_CLASS,
    };
  }
  const intent = detectTicketIntent(ticket);
  if (intent === "cancel")
    return { label: "İptal", className: CATEGORY_BADGE_CLASS.iptal };
  if (intent === "refund")
    return { label: "İade", className: CATEGORY_BADGE_CLASS.iade };
  return { label: "Genel", className: NEUTRAL_BADGE_CLASS };
}

/** Talep gövdesinden tek satırlık kısa önizleme (konu boşsa listede gösterilir). */
function ticketPreview(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export default function SupportTicketsPage(): React.ReactElement | null {
  useDocumentTitle("Sipariş Talepleri");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const ticketIdParam = searchParams.get("ticketId");

  const [filter, setFilter] = useState<SupportTicketFilter>("PENDING");
  const [searchInput, setSearchInput] = useState<string>("");
  const search = useDebounce(searchInput, 250);
  const [page, setPage] = useState<number>(1);

  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>("");

  // Konuşma composer'ına hızlı yanıt yazabilmek için imperative ref.
  const chatRef = useRef<ConversationChatHandle | null>(null);

  // Karar Paneli state — drawer içinde, modal yok. Panel yalnız iptal
  // taleplerinde açıldığı için nihai statü daima "cancelled"; ayrı bir seçim
  // (sürgü) yok. Onay ve red için GÖNDERİLECEK mesaj kutularda önceden dolu
  // durur (şablon + sipariş no/ad işlenmiş) — admin görür, isterse düzenler.
  // dirty: admin kutuya dokunduysa şablon geç yüklense bile üzerine yazmayız.
  const [approveMessage, setApproveMessage] = useState<string>("");
  const [rejectMessage, setRejectMessage] = useState<string>("");
  const [approveDirty, setApproveDirty] = useState<boolean>(false);
  const [rejectDirty, setRejectDirty] = useState<boolean>(false);
  // İADE karar paneli: adres (onay için) + ek mesaj.
  const [returnAddress, setReturnAddress] = useState<string>("");
  const [returnNote, setReturnNote] = useState<string>("");

  // Hızlı Yanıtlar (hazır cevaplar) yönetim modal'ı
  const [quickRepliesOpen, setQuickRepliesOpen] = useState<boolean>(false);

  // Karar verildikten sonra ekrana basılan tam-ekran pop-up
  const [resultDialog, setResultDialog] = useState<{
    kind: ResolutionDialogKind;
    customerName: string;
    refund: OrderUpdateRefundMeta | null;
  } | null>(null);

  // Filter / search değiştiğinde page'i sıfırla
  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  // Selected değiştiğinde reply draft'ı seçili talebin admin notuna eşitle
  useEffect(() => {
    if (selected) {
      setReplyDraft(selected.adminNote ?? "");
    } else {
      setReplyDraft("");
    }
  }, [selected?.id, selected?.adminNote]);

  // Selected değiştiğinde karar paneli mesajları sıfırlansın (dirty düşer,
  // aşağıdaki prefill effect'i taze şablonla doldurur).
  useEffect(() => {
    if (selected) {
      setApproveDirty(false);
      setRejectDirty(false);
      setReturnAddress("");
      setReturnNote("");
    }
  }, [selected?.id]);

  const ticketsQuery = useQuery<SupportTicketListResponse>({
    queryKey: ["support-tickets", { filter, page }],
    queryFn: () => fetchSupportTickets({ filter, page, pageSize: PAGE_SIZE }),
    enabled: authed,
    refetchInterval: 60_000,
  });

  // NEW olan bir talep açıldığında otomatik READ'e çek
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== "NEW") return;
    markTicketAsRead(selected.id)
      .then((updated) => {
        setSelected(updated);
        void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
        void queryClient.invalidateQueries({
          queryKey: ["support-tickets", "count"],
        });
      })
      .catch(() => {
        // Sessiz geç — admin yine de elle yanıtlayabilir
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Bildirimden gelen `?ticketId=...` query param'ı: ilgili talebi otomatik aç
  useEffect(() => {
    if (!authed) return;
    if (!ticketIdParam) return;
    if (selected?.id === ticketIdParam) return;

    const inList = ticketsQuery.data?.data.find((t) => t.id === ticketIdParam);
    if (inList) {
      openTicket(inList);
      const next = new URLSearchParams(searchParams);
      next.delete("ticketId");
      setSearchParams(next, { replace: true });
      return;
    }

    let cancelled = false;
    fetchSupportTicket(ticketIdParam)
      .then((ticket) => {
        if (cancelled) return;
        setSelected(ticket);
        const next = new URLSearchParams(searchParams);
        next.delete("ticketId");
        setSearchParams(next, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.push("error", "Bu sipariş talebi bulunamadı");
        const next = new URLSearchParams(searchParams);
        next.delete("ticketId");
        setSearchParams(next, { replace: true });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, ticketIdParam, ticketsQuery.data]);

  const replyMutation = useMutation({
    mutationFn: (vars: { id: string; note: string }) =>
      replyToSupportTicket(vars.id, vars.note),
    onSuccess: (data) => {
      toast.push("success", "Yanıt gönderildi");
      setSelected(data);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      void queryClient.invalidateQueries({
        queryKey: ["support-tickets", "count"],
      });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Yanıt gönderilemedi",
      );
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => closeSupportTicket(id),
    onSuccess: (data) => {
      toast.push("success", "Talep kapatıldı");
      setSelected(data);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Kapatma başarısız",
      );
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (vars: { id: string; hadReply: boolean }) =>
      reopenSupportTicket(vars.id, vars.hadReply),
    onSuccess: (data) => {
      toast.push("success", "Talep yeniden açıldı");
      setSelected(data);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Yeniden açma başarısız",
      );
    },
  });

  /**
   * Karar paneli akışı — modal yok, drawer içi inline panel:
   *  - approve: sipariş seçilen statüye geçer ('cancelled' veya 'refunded').
   *    cancelled'da backend ledger'a bakıp net ödenmiş tutarı cariye iade eder.
   *    refunded'da otomatik cari iadesi YAPILMAZ (kullanıcı isteği).
   *  - reject: sipariş durumu değişmez, sadece REPLIED yanıt yazılır.
   * Sipariş güncelleme başarısızsa ticket güncellenmez.
   * Başarılı olunca tam-ekran pop-up basılır; pop-up kapanınca drawer da kapanır.
   */
  const DEFAULT_APPROVE_NOTE = "Talebiniz onaylanmıştır.";
  const DEFAULT_REJECT_NOTE = "Talebiniz reddedilmiştir.";

  type DecisionVars =
    | {
        mode: "approve";
        ticketId: string;
        orderId: string;
        status: DecisionStatus;
        note: string;
        customerName: string;
      }
    | {
        mode: "reject";
        ticketId: string;
        note: string;
        customerName: string;
      };

  /** Karar sonrası oto-kapatma — geçici ağ/deploy kesintisine dayanıklı:
   *  3 deneme (artan bekleme). Yine olmazsa null döner; çağıran görünür
   *  uyarı basar (2026-08-01: nginx restart anına denk gelen kapatma
   *  isteği sessizce yutulmuş, talep "Cevaplandı"da asılı kalmıştı). */
  async function closeTicketWithRetry(
    ticketId: string,
  ): Promise<SupportTicket | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await closeSupportTicket(ticketId);
      } catch {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return null;
  }

  const decisionMutation = useMutation({
    mutationFn: async (vars: DecisionVars) => {
      if (vars.mode === "approve") {
        // confirmReactivation:true → "riskli" statü geçişini (özellikle
        // shipped→cancelled) backend'in 409 STATUS_TRANSITION_NEEDS_CONFIRM
        // engelini aşarak uygular. Admin bu paneldeki "İptali Onayla"ya BİLEREK
        // bastığı (ve butonun altında ayrı bir onay popup'ı çıktığı) için kesin
        // onay sayılır; "Kargoya Verildi" siparişi bile iptal edilebilir
        // (müşteri carisi iade + stok geri ekleme updateOrder içinde yapılır).
        const result = await updateOrderWithMeta(vars.orderId, {
          status: vars.status,
          confirmReactivation: true,
        });
        const finalNote =
          vars.note.trim().length >= 2 ? vars.note.trim() : DEFAULT_APPROVE_NOTE;
        const replied = await replyToSupportTicket(vars.ticketId, finalNote);
        // Kesin onaydan sonra talep önce "Cevaplandı" olur, ardından otomatik
        // kapatılır (Kapalı). Kapatma hatası onayı gölgelemesin diye akışı
        // KIRMAZ ama artık sessiz de kalmaz: retry biter, uyarı basılır.
        const closed = await closeTicketWithRetry(vars.ticketId);
        if (!closed) {
          toast.push(
            "error",
            "Talep yanıtlandı ancak otomatik kapatılamadı — listeden elle kapatabilirsiniz.",
          );
        }
        return {
          mode: "approve" as const,
          ticket: closed ?? replied,
          status: vars.status,
          refund: result.meta?.refund ?? null,
          customerName: vars.customerName,
        };
      }
      const finalNote =
        vars.note.trim().length >= 2 ? vars.note.trim() : DEFAULT_REJECT_NOTE;
      const replied = await replyToSupportTicket(vars.ticketId, finalNote);
      // Kesin retten sonra da aynı: önce "Cevaplandı", ardından otomatik kapat.
      const closed = await closeTicketWithRetry(vars.ticketId);
      if (!closed) {
        toast.push(
          "error",
          "Talep yanıtlandı ancak otomatik kapatılamadı — listeden elle kapatabilirsiniz.",
        );
      }
      return {
        mode: "reject" as const,
        ticket: closed ?? replied,
        customerName: vars.customerName,
      };
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      void queryClient.invalidateQueries({
        queryKey: ["support-tickets", "count"],
      });
      if (data.mode === "approve") {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        void queryClient.invalidateQueries({
          queryKey: ["ticket-order-detail", data.ticket.orderId],
        });
        setResultDialog({
          kind:
            data.status === "cancelled"
              ? "approved-cancel"
              : "approved-refund",
          customerName: data.customerName,
          refund: data.refund,
        });
      } else {
        setResultDialog({
          kind: "rejected",
          customerName: data.customerName,
          refund: null,
        });
      }
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "İşlem başarısız",
      );
    },
  });

  /**
   * İADE karar akışı (approve/reject/finalize) — backend decideReturn tek
   * uçtan konuşma mesajını + statü/para işlemlerini yapar. Başarıda taze ticket
   * çekilip drawer güncellenir.
   */
  const returnMutation = useMutation({
    mutationFn: async (vars: {
      ticketId: string;
      action: "approve" | "reject" | "finalize";
      address?: string;
      note?: string;
    }) => {
      const res = await decideReturn(vars.ticketId, {
        action: vars.action,
        address: vars.address,
        note: vars.note,
      });
      const ticket = await fetchSupportTicket(vars.ticketId).catch(() => null);
      return { action: vars.action, returnStatus: res.returnStatus, ticket };
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      void queryClient.invalidateQueries({
        queryKey: ["support-tickets", "count"],
      });
      if (data.ticket) setSelected(data.ticket);
      if (data.action === "finalize") {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        void queryClient.invalidateQueries({
          queryKey: ["ticket-order-detail", data.ticket?.orderId],
        });
      }
      setReturnAddress("");
      setReturnNote("");
      toast.push(
        "success",
        data.action === "approve"
          ? "İade onaylandı — adres müşteriye iletildi."
          : data.action === "reject"
            ? "İade reddedildi."
            : "İade tamamlandı: sipariş İade Edildi + cari iade yapıldı.",
      );
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "İade işlemi başarısız",
      );
    },
  });

  // Sipariş uçları ('orders' izni) olmayan çalışanda sipariş detayı 403 döner:
  // statü bilinemez, orderIsTerminal false kalır ve "İptali Onayla" AÇIK
  // görünürdü (tıklayınca da 403). Bu yüzden izin yoksa sorguyu hiç atmıyor,
  // karar panelini ve sipariş içeriği panelini tümden gizliyoruz.
  const canSeeOrders = canAccess("orders");

  // Karar paneli için sipariş statüsünü gösterebilmek üzere lazy fetch
  const decisionOrderQuery = useQuery<OrderDetail>({
    queryKey: ["ticket-order-detail", selected?.orderId ?? ""],
    queryFn: () => fetchOrder(selected!.orderId!),
    enabled: canSeeOrders && !!selected?.orderId,
    staleTime: 30_000,
  });

  const orderIsTerminal =
    decisionOrderQuery.data?.status === "cancelled" ||
    decisionOrderQuery.data?.status === "refunded";

  // ── Hızlı Yanıtlar (hazır cevaplar) ──────────────────────────────────────
  const quickRepliesQuery = useQuery({
    queryKey: ["support-quick-replies"],
    queryFn: fetchQuickReplies,
    staleTime: 60_000,
  });
  const activeQuickReplies = useMemo(
    () => (quickRepliesQuery.data ?? []).filter((r) => r.isActive),
    [quickRepliesQuery.data],
  );

  /** Seçili talebin sipariş no'su ve adıyla {siparisNo}/{ad} doldurur. */
  function fillForSelected(body: string): string {
    return fillQuickReply(body, {
      orderNumber: selected?.orderNumber ?? null,
      name: selected?.name ?? null,
    });
  }

  /**
   * Hızlı yanıta tıklayınca mesajı ANINDA GÖNDERMEZ — ilgili mesaj kutusuna
   * yazar (konuşma varsa composer'a, yoksa klasik yanıt alanına). Admin
   * "Gönder"e basınca yollanır.
   */
  function insertQuickReply(qr: QuickReply): void {
    if (!selected) return;
    const text = fillForSelected(qr.body);
    if (selected.conversationId) {
      chatRef.current?.setDraft(text);
    } else {
      setReplyDraft(text);
    }
  }

  /** Karar paneli varsayılan onay/ret mesajları — şablon (cancel_approve /
   *  cancel_reject) bulunur, {siparisNo}/{ad} doldurulur. Kutular bu metinle
   *  önceden dolar; admin göndermeden önce görür ve düzenleyebilir. */
  const defaultDecisionNotes = useMemo(() => {
    const forIntent = (intent: QuickReplyIntent, fallback: string): string => {
      const tpl = activeQuickReplies.find((r) => r.intent === intent);
      return fillQuickReply(tpl ? tpl.body : fallback, {
        orderNumber: selected?.orderNumber ?? null,
        name: selected?.name ?? null,
      });
    };
    return {
      approve: forIntent("cancel_approve", "İptal talebiniz onaylanmıştır."),
      reject: forIntent("cancel_reject", "Talebiniz reddedilmiştir."),
    };
  }, [activeQuickReplies, selected?.orderNumber, selected?.name]);

  // Kutuları GÖNDERİLECEK varsayılanla doldur. Şablonlar sorgudan geç
  // gelirse de tazelenir; admin kutuya dokunduysa (dirty) üzerine yazılmaz.
  useEffect(() => {
    if (!approveDirty) setApproveMessage(defaultDecisionNotes.approve);
  }, [defaultDecisionNotes.approve, approveDirty]);
  useEffect(() => {
    if (!rejectDirty) setRejectMessage(defaultDecisionNotes.reject);
  }, [defaultDecisionNotes.reject, rejectDirty]);

  /** Karar paneli onay/ret notu: kutudaki (önceden dolu, belki düzenlenmiş)
   *  metin gider; kutu boşaltıldıysa şablon varsayılanına geri döner. */
  function resolveDecisionNote(kind: "approve" | "reject"): string {
    const typed = (kind === "approve" ? approveMessage : rejectMessage).trim();
    if (typed.length >= 2) return fillForSelected(typed);
    return kind === "approve"
      ? defaultDecisionNotes.approve
      : defaultDecisionNotes.reject;
  }

  // Genel "kutuya yaz" çipleri: onay/ret şablonlarını (cancel/refund approve +
  // reject) HARİÇ tutar. Bu mesajlar Karar Paneli'ndeki "İptali Onayla / İptali
  // Reddet" butonlarıyla otomatik gittiği için ayrıca hazır-yanıt çipi olarak
  // gösterilmez.
  const informationalQuickReplies = useMemo(
    () =>
      activeQuickReplies.filter(
        (r) =>
          r.intent !== "cancel_approve" &&
          r.intent !== "cancel_reject" &&
          r.intent !== "refund_approve" &&
          r.intent !== "refund_reject",
      ),
    [activeQuickReplies],
  );

  /** Talep yanıt alanlarında hazır-yanıt çip satırı. */
  function renderQuickReplyChips(
    items: QuickReply[],
    onPick: (qr: QuickReply) => void,
    hint: string,
  ): React.ReactElement {
    return (
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Hızlı Yanıtlar
          </span>
          <button
            type="button"
            onClick={() => setQuickRepliesOpen(true)}
            className="text-[11px] font-medium text-sky-600 hover:underline"
          >
            Yönet / Düzenle
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Henüz hazır yanıt yok. "Yönet" ile ekleyebilirsiniz.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {items.map((qr) => (
                <button
                  key={qr.id}
                  type="button"
                  onClick={() => onPick(qr)}
                  title={fillForSelected(qr.body)}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100"
                >
                  {qr.title}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {hint}
            </p>
          </>
        )}
      </div>
    );
  }

  const items = ticketsQuery.data?.data ?? [];
  const meta = ticketsQuery.data?.meta;

  // PENDING filter'ı backend'den NEW+READ olarak iki çağrı ile döner; ek
  // olarak client tarafı emniyet filtresi uyguluyoruz.
  const filteredItems = useMemo(() => {
    let arr = items;
    if (filter === "PENDING") {
      arr = items.filter((t) => isPendingStatus(t.status));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((t) =>
        [
          t.name,
          t.email,
          t.subject ?? "",
          t.body,
          t.orderNumber ?? "",
          t.carrier ?? "",
          t.trackingCode ?? "",
          t.marketplace ?? "",
          t.supplierName ?? "",
          t.supplierOrderNo ?? "",
          t.cargoCompany ?? "",
          t.cargoBarcode ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return arr;
  }, [items, filter, search]);

  /**
   * Bir talebi açar: drawer'ı ANINDA gösterir (liste satırıyla), ardından taze
   * detayı çeker. Backend detay uçunda sohbet thread'ini lazily garanti edip
   * `conversationId` döndürdüğü için, liste satırında henüz sohbet yokken bile
   * chat görünümü kesin gelir — eski "kutucuk" görünümüne düşmeyiz.
   */
  function openTicket(t: SupportTicket): void {
    setSelected(t);
    fetchSupportTicket(t.id)
      .then((fresh) => {
        setSelected((cur) => (cur?.id === t.id ? fresh : cur));
      })
      .catch(() => {
        // Sessiz geç — liste satırıyla açık kalır; 60sn refetch tazeler.
      });
  }

  function handleReplySubmit(): void {
    if (!selected) return;
    const trimmed = replyDraft.trim();
    if (trimmed.length < 2) {
      toast.push("info", "Yanıt en az 2 karakter olmalı");
      return;
    }
    replyMutation.mutate({ id: selected.id, note: trimmed });
  }

  function handleClose(): void {
    if (!selected) return;
    closeMutation.mutate(selected.id);
  }

  function handleReopen(): void {
    if (!selected) return;
    reopenMutation.mutate({
      id: selected.id,
      hadReply: !!selected.adminNote && selected.adminNote.trim().length > 0,
    });
  }

  /**
   * Konuşma thread'inden (composer) mesaj gönderildiğinde çağrılır. Backend
   * admin SUPPORT mesajında talebi otomatik "Cevaplandı" (REPLIED) yapar ve
   * müşteriye e-posta gönderir — burada listeyi ve drawer'daki durum rozetini
   * güncel tutmak için talebi yeniden çekeriz.
   */
  function handleConversationSent(): void {
    void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    void queryClient.invalidateQueries({
      queryKey: ["support-tickets", "count"],
    });
    const id = selected?.id;
    if (!id) return;
    fetchSupportTicket(id)
      .then((ticket) => {
        // Yarış durumuna karşı: arada başka bir talep seçildiyse ezme.
        setSelected((cur) => (cur?.id === id ? ticket : cur));
      })
      .catch(() => {
        // Sessiz geç — liste invalidation durum rozetini yine de tazeler.
      });
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Sipariş Talepleri
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Müşterilerin sipariş üzerinden açtığı destek talepleri burada
          görüntülenir. Genel iletişim mesajları için "Mesajlar &amp; İstekler"
          sayfasına gidin.
        </p>
      </header>

      {/* Filter pills */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SUPPORT_TICKET_FILTER_ORDER.map((f) => {
          const isActive = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {SUPPORT_TICKET_FILTER_LABELS[f]}
            </button>
          );
        })}
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Müşteri, sipariş no, konu, kargo kodu…"
          className="ml-auto w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
      </div>

      {ticketsQuery.isError ? (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>
            {ticketsQuery.error instanceof Error
              ? ticketsQuery.error.message
              : "Veri alınamadı"}
          </span>
          <button
            type="button"
            onClick={() => void ticketsQuery.refetch()}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            Tekrar dene
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Müşteri</th>
                  <th className="px-3 py-2 text-left">Sipariş No</th>
                  <th className="px-3 py-2 text-left">Tür / Konu</th>
                  <th className="px-3 py-2 text-left">Tedarikçi</th>
                  <th className="px-3 py-2 text-left">Kargo Firması</th>
                  <th className="px-3 py-2 text-left">Kargo Barkodu</th>
                  <th className="px-3 py-2 text-left">Son Mesaj</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {ticketsQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Sipariş talebi bulunmuyor
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((t) => {
                    return (
                      <tr
                        key={t.id}
                        className={`border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer ${
                          t.status === "NEW" ? "font-medium" : ""
                        }`}
                        onClick={() => openTicket(t)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-[var(--color-text)]">
                            {t.customerId ? (
                              <Link
                                to={`/customers/${t.customerId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[var(--color-brand-blue)] hover:underline"
                              >
                                {t.name}
                              </Link>
                            ) : (
                              t.name
                            )}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {t.email}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {t.orderId ? (
                            <Link
                              to={`/orders/${t.orderId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[var(--color-brand-blue)] hover:underline"
                            >
                              {formatOrderNo(t.orderNumber, t.orderId.slice(0, 8))}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text)]">
                          {(() => {
                            const badge = ticketTypeBadge(t);
                            const konu =
                              t.subject?.trim() || ticketPreview(t.body) || "(konusuz)";
                            return (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                  {t.attachments && t.attachments.length > 0 ? (
                                    <span
                                      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
                                      title={`${t.attachments.length} ek görsel`}
                                      aria-label={`${t.attachments.length} ek`}
                                    >
                                      <span aria-hidden="true">📎</span>
                                      {t.attachments.length}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className="block max-w-[260px] truncate text-xs text-[var(--color-text-muted)]"
                                  title={konu}
                                >
                                  {konu}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[var(--color-text)]">
                              {t.supplierName || "—"}
                            </span>
                            {t.supplierOrderNo ? (
                              <span className="font-mono text-[var(--color-text-muted)]">
                                {t.supplierOrderNo}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                          {t.cargoCompany || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {t.cargoBarcode ? (
                            <span className="font-mono text-[var(--color-text)]">
                              {t.cargoBarcode}
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                          {formatDateTime(t.updatedAt)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(
                              t.status,
                            )}`}
                          >
                            {statusLabelFor(t.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTicket(t);
                            }}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                          >
                            Aç
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-sm">
              <span className="text-[var(--color-text-muted)]">
                Sayfa {meta.page} / {meta.totalPages} ·{" "}
                {meta.total.toLocaleString("tr-TR")} talep
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1 || ticketsQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={
                    meta.page >= meta.totalPages || ticketsQuery.isFetching
                  }
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Sonraki
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40"
          onClick={() => setSelected(null)}
        >
          <aside
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="min-w-0 pr-4">
                <h2 className="truncate text-lg font-semibold text-[var(--color-text)]">
                  {selected.subject ?? "(konusuz)"}
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {selected.name} · {selected.email}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Açılış: {formatDateTime(selected.createdAt)} · Güncellendi:{" "}
                  {formatDateTime(selected.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${statusColor(
                  selected.status,
                )}`}
              >
                {statusLabelFor(selected.status)}
              </span>
              {(() => {
                const badge = ticketTypeBadge(selected);
                return (
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                );
              })()}
              {selected.orderId ? (
                <Link
                  to={`/orders/${selected.orderId}`}
                  className="rounded-full border border-[var(--color-border)] bg-white px-2 py-0.5 text-[var(--color-brand-blue)] hover:underline"
                >
                  Sipariş #{formatOrderNo(selected.orderNumber, selected.orderId.slice(0, 8))}
                </Link>
              ) : null}
              {selected.customerId ? (
                <Link
                  to={`/customers/${selected.customerId}`}
                  className="rounded-full border border-[var(--color-border)] bg-white px-2 py-0.5 text-[var(--color-brand-blue)] hover:underline"
                >
                  Müşteri kartı
                </Link>
              ) : null}
              {(() => {
                const wa = normalizePhoneForWa(selected.customerPhone);
                if (!wa) return null;
                return (
                  <a
                    href={`https://wa.me/${wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`WhatsApp ile yaz · ${selected.customerPhone ?? ""}`}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="currentColor"
                    >
                      <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.74.45 3.45 1.32 4.96L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.02ZM12.04 20.15h-.01a8.18 8.18 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.16 8.16 0 0 1-1.25-4.38c0-4.52 3.68-8.2 8.21-8.2a8.15 8.15 0 0 1 5.8 2.4 8.16 8.16 0 0 1 2.41 5.81c0 4.53-3.69 8.23-8.19 8.23Zm4.5-6.16c-.25-.12-1.46-.72-1.68-.8-.23-.08-.39-.12-.55.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.22-1.45-1.37-1.7-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.33-.75-1.82-.2-.48-.4-.41-.55-.42l-.47-.01a.9.9 0 0 0-.65.31c-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.55.12.16 1.73 2.64 4.2 3.71.59.25 1.05.4 1.41.51.59.19 1.13.16 1.55.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
                    </svg>
                    WhatsApp
                  </a>
                );
              })()}
            </div>

            {selected.orderId && selected.kind === "order" && canSeeOrders ? (
              <TicketOrderPanel
                orderId={selected.orderId}
                orderNumberHint={selected.orderNumber}
                carrier={selected.carrier}
                trackingCode={selected.trackingCode}
                marketplace={selected.marketplace}
              />
            ) : null}

            {/* Müşteri mesajı: konuşma thread'i varsa zaten thread'in ilk
                mesajı olarak görünür — burada tekrar göstermeyiz. Yalnızca
                thread yoksa (anonim talep) fallback olarak basılır. */}
            {!selected.conversationId ? (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Müşteri Mesajı
                </div>
                <div className="mt-1 whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)]">
                  {selected.body}
                </div>
              </div>
            ) : null}

            <AttachmentGallery attachments={selected.attachments ?? []} />

            {selected.conversationId ? (
              <div className="mt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Konuşma (Bayi ↔ Destek)
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    Mesaj gönderince talep otomatik "Cevaplandı" olur ve
                    müşteriye e-posta gider.
                  </span>
                </div>
                <ConversationChat
                  ref={chatRef}
                  conversationId={selected.conversationId}
                  heightClass="max-h-[24rem]"
                  showHeader={false}
                  onMessageSent={handleConversationSent}
                />
              </div>
            ) : (
              /* Konuşma thread'i olmayan (anonim) talepler için klasik yanıt
                 kutusu — kaydedince durum "Cevaplandı" olur ve müşteriye
                 e-posta gider. */
              <div className="mt-4">
                <label
                  htmlFor="reply-note"
                  className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  Yanıt
                </label>
                <textarea
                  id="reply-note"
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  placeholder="Müşteriye gidecek yanıtı yazın…"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Yanıtı kaydettiğinizde durum otomatik "Cevaplandı" olur ve
                  müşteriye e-posta gönderilir.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleReplySubmit}
                    disabled={replyMutation.isPending}
                    className="rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
                  >
                    Yanıt gönder
                  </button>
                </div>
              </div>
            )}

            {selected.status !== "ARCHIVED"
              ? renderQuickReplyChips(
                  informationalQuickReplies,
                  insertQuickReply,
                  'Tıklayınca mesaj kutusuna yazılır; "Gönder" ile yollayabilirsiniz.',
                )
              : null}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {selected.status === "ARCHIVED" ? (
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={reopenMutation.isPending}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                >
                  Yeniden aç
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={closeMutation.isPending}
                  className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                >
                  Kapat
                </button>
              )}
            </div>

            {selected.orderId &&
            selected.status !== "ARCHIVED" &&
            canSeeOrders &&
            detectTicketIntent(selected) === "cancel" ? (
              <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    Karar Paneli
                  </h3>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    Mevcut durum:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {decisionOrderQuery.data
                        ? (ORDER_STATUS_LABELS[
                            decisionOrderQuery.data.status
                          ] ?? decisionOrderQuery.data.status)
                        : decisionOrderQuery.isLoading
                          ? "Yükleniyor…"
                          : "—"}
                    </span>
                  </div>
                </div>

                {/* Gönderilecek mesajlar önceden dolu ve düzenlenebilir —
                    admin karar vermeden ne gideceğini AYNEN görür. */}
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setQuickRepliesOpen(true)}
                    className="text-[11px] font-medium text-sky-600 hover:underline"
                    title="Varsayılan şablonları kalıcı olarak düzenle"
                  >
                    Şablonları kalıcı düzenle
                  </button>
                </div>

                {orderIsTerminal ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Bu sipariş zaten kapatılmış (
                    {decisionOrderQuery.data
                      ? (ORDER_STATUS_LABELS[
                          decisionOrderQuery.data.status
                        ] ?? decisionOrderQuery.data.status)
                      : "—"}
                    ). Onaylama devre dışı — yine de talebi reddederek
                    müşteriye bildirim atabilirsiniz.
                  </p>
                ) : null}

                {/* ONAY KARTI — mesaj + butonu tek kutuda: admin butona
                    basmadan bu siparişe özel NE GİDECEĞİNİ aynen görür. */}
                <div
                  className={`mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 ${
                    orderIsTerminal ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white"
                    >
                      ✓
                    </span>
                    <label
                      htmlFor="decision-approve-message"
                      className="text-sm font-semibold text-emerald-800"
                    >
                      İptali Onayla
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-800/80">
                    Onaylarsanız müşteriye aşağıdaki mesaj gönderilir —
                    göndermeden önce düzenleyebilirsiniz.
                  </p>
                  <textarea
                    id="decision-approve-message"
                    value={approveMessage}
                    onChange={(e) => {
                      setApproveDirty(true);
                      setApproveMessage(e.target.value);
                    }}
                    rows={5}
                    disabled={decisionMutation.isPending || orderIsTerminal}
                    className="mt-2 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm leading-relaxed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // Admin "İptali Onayla"ya basınca kısa bir kesin-onay
                      // popup'ı göster; onaylarsa iptal KESİN uygulanır. Sipariş
                      // "Kargoya Verildi" (shipped) olsa bile iptal edilir —
                      // mutasyon confirmReactivation:true gönderir.
                      const st = decisionOrderQuery.data?.status;
                      const ok = window.confirm(
                        st === "shipped"
                          ? 'Bu sipariş "Kargoya Verildi" durumunda. Yine de İPTAL edilecek:\n' +
                              "• Müşteri carisi iade edilecek\n" +
                              "• Stok geri eklenecek\n\n" +
                              "İptali kesin olarak onaylıyor musunuz?"
                          : "Sipariş İPTAL edilecek ve müşteriye iade yapılacak.\n\n" +
                              "İptali onaylıyor musunuz?",
                      );
                      if (!ok) return;
                      decisionMutation.mutate({
                        mode: "approve",
                        ticketId: selected.id,
                        orderId: selected.orderId!,
                        status: "cancelled",
                        note: resolveDecisionNote("approve"),
                        customerName: selected.name,
                      });
                    }}
                    disabled={
                      decisionMutation.isPending || orderIsTerminal
                    }
                    className="mt-2 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    İptali Onayla — bu mesajla gönder
                  </button>
                </div>

                {/* RED KARTI — aynı düzen, kırmızı tema. */}
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white"
                    >
                      ✕
                    </span>
                    <label
                      htmlFor="decision-reject-message"
                      className="text-sm font-semibold text-rose-800"
                    >
                      İptali Reddet
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] text-rose-800/80">
                    Reddederseniz müşteriye aşağıdaki mesaj gönderilir —
                    göndermeden önce düzenleyebilirsiniz.
                  </p>
                  <textarea
                    id="decision-reject-message"
                    value={rejectMessage}
                    onChange={(e) => {
                      setRejectDirty(true);
                      setRejectMessage(e.target.value);
                    }}
                    rows={5}
                    disabled={decisionMutation.isPending}
                    className="mt-2 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm leading-relaxed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      decisionMutation.mutate({
                        mode: "reject",
                        ticketId: selected.id,
                        note: resolveDecisionNote("reject"),
                        customerName: selected.name,
                      })
                    }
                    disabled={decisionMutation.isPending}
                    className="mt-2 w-full rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    İptali Reddet — bu mesajla gönder
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    Kutuyu boşaltırsanız hazır şablon otomatik gönderilir;
                    düzenleme yalnız bu talep için geçerlidir.
                  </p>
                  {decisionMutation.isPending ? (
                    <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                      İşleniyor…
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {selected.orderId &&
            selected.status !== "ARCHIVED" &&
            detectTicketIntent(selected) === "refund" ? (
              <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    İade Karar Paneli
                  </h3>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    İade durumu:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {RETURN_FLOW_STATUS_LABELS[
                        selected.returnStatus ?? "REQUESTED"
                      ]}
                    </span>
                  </div>
                </div>

                {/* Müşterinin yüklediği iade faturası (varsa) */}
                {selected.returnInvoiceUrl ? (
                  <a
                    href={selected.returnInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-slate-50"
                  >
                    📄 İade Faturası (PDF)
                    {selected.returnInvoiceName
                      ? ` — ${selected.returnInvoiceName}`
                      : ""}
                  </a>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                    İade faturası bulunmuyor.
                  </p>
                )}

                {/* REQUESTED (veya eski akış-öncesi boş durum) → onayla / reddet */}
                {(selected.returnStatus ?? "REQUESTED") === "REQUESTED" ? (
                  <>
                    <div className="mt-3">
                      <label
                        htmlFor="return-address"
                        className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]"
                      >
                        İade Adresi (onay için zorunlu)
                      </label>
                      <textarea
                        id="return-address"
                        value={returnAddress}
                        onChange={(e) => setReturnAddress(e.target.value)}
                        rows={3}
                        disabled={returnMutation.isPending}
                        placeholder="Ürünün gönderileceği iade adresi (ad soyad, açık adres, ilçe/il, telefon)…"
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm disabled:opacity-60"
                      />
                    </div>
                    <div className="mt-3">
                      <label
                        htmlFor="return-note"
                        className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]"
                      >
                        Ek Mesaj (opsiyonel)
                      </label>
                      <textarea
                        id="return-note"
                        value={returnNote}
                        onChange={(e) => setReturnNote(e.target.value)}
                        rows={2}
                        disabled={returnMutation.isPending}
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm disabled:opacity-60"
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          returnMutation.mutate({
                            ticketId: selected.id,
                            action: "approve",
                            address: returnAddress,
                            note: returnNote,
                          })
                        }
                        disabled={
                          returnMutation.isPending ||
                          returnAddress.trim().length < 10
                        }
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        İadeyi Onayla ve Adresi Gönder
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          returnMutation.mutate({
                            ticketId: selected.id,
                            action: "reject",
                            note: returnNote,
                          })
                        }
                        disabled={returnMutation.isPending}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        İadeyi Reddet
                      </button>
                    </div>
                  </>
                ) : null}

                {/* APPROVED → adres iletildi; müşterinin kargoya vermesi bekleniyor.
                    Para HÂLÂ hareket etmez. Finalize burada da mümkün (yedek yol:
                    müşteri "kargoya verdim"e basmayı unutup ürün yine de geldiyse). */}
                {selected.returnStatus === "APPROVED" ? (
                  <>
                    {selected.returnAddress ? (
                      <div className="mt-3 rounded-md border border-[var(--color-border)] bg-white p-3 text-xs">
                        <div className="font-semibold text-[var(--color-text)]">
                          Müşteriye iletilen iade adresi:
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-[var(--color-text-muted)]">
                          {selected.returnAddress}
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Adres iletildi. Müşterinin ürünü kargoya verip fotoğrafını
                      göndermesi bekleniyor.{" "}
                      <strong>Para henüz iade edilmedi.</strong> Ürün elinize
                      ulaşıp inceledikten sonra aşağıdaki butonla iadeyi
                      tamamlayın.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          returnMutation.mutate({
                            ticketId: selected.id,
                            action: "finalize",
                          })
                        }
                        disabled={returnMutation.isPending}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Para İadesini Yap (Teslim Aldım, İnceledim)
                      </button>
                    </div>
                  </>
                ) : null}

                {/* SHIPPED_BACK → müşteri ürünü kargoya verdi (foto sohbette).
                    Ürün elimize ulaşıp incelendikten sonra para iadesi yapılır. */}
                {selected.returnStatus === "SHIPPED_BACK" ? (
                  <>
                    {selected.returnAddress ? (
                      <div className="mt-3 rounded-md border border-[var(--color-border)] bg-white p-3 text-xs">
                        <div className="font-semibold text-[var(--color-text)]">
                          Müşteriye iletilen iade adresi:
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-[var(--color-text-muted)]">
                          {selected.returnAddress}
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-3 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      Müşteri ürünü kargoya verdiğini bildirdi
                      {selected.returnShippedAt
                        ? ` (${new Date(selected.returnShippedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })})`
                        : ""}
                      . Kargo fotoğrafı yazışmada.{" "}
                      <strong>Para henüz iade edilmedi.</strong> Ürün elinize
                      ulaşıp gerçekten kusurlu olduğunu doğruladıktan sonra iadeyi
                      tamamlayın.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          returnMutation.mutate({
                            ticketId: selected.id,
                            action: "finalize",
                          })
                        }
                        disabled={returnMutation.isPending}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Para İadesini Yap (Teslim Aldım, İnceledim)
                      </button>
                    </div>
                  </>
                ) : null}

                {selected.returnStatus === "REJECTED" ? (
                  <p className="mt-3 text-xs text-amber-700">
                    Bu iade talebi reddedildi. Sipariş ve cari bakiye değişmedi.
                  </p>
                ) : null}
                {selected.returnStatus === "FINALIZED" ? (
                  <p className="mt-3 text-xs text-emerald-700">
                    İade tamamlandı: sipariş “İade Edildi” ve tutar müşterinin
                    cari bakiyesine iade edildi.
                  </p>
                ) : null}

                {returnMutation.isPending ? (
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    İşleniyor…
                  </span>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      <ResolutionResultDialog
        open={!!resultDialog}
        kind={resultDialog?.kind ?? "rejected"}
        customerName={resultDialog?.customerName ?? ""}
        refund={resultDialog?.refund ?? null}
        onClose={() => {
          setResultDialog(null);
          setSelected(null);
        }}
      />

      <QuickRepliesModal
        open={quickRepliesOpen}
        onClose={() => setQuickRepliesOpen(false)}
      />
    </div>
  );
}

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Truck,
  Package,
  ShoppingCart,
  Users,
  MessageSquare,
  MessageCircle,
  Megaphone,
  Wallet,
  Landmark,
  CreditCard,
  Warehouse,
  User as UserIcon,
  UserCog,
  Sliders,
  Receipt,
  ReceiptText,
  BarChart3,
  ScrollText,
  Clock,
  ChevronDown,
  Search,
  Menu,
  X,
  LogOut,
  type LucideIcon,
  GitCompare,
  PackageSearch,
} from "lucide-react";
import { logout, getToken, tryAutoLogin } from "../lib/auth";
import {
  getCurrentPermissions,
  getCurrentUserId,
  setServerPermissions,
} from "../lib/permissions";
import { fetchMyPermissions } from "../lib/admin-permissions";
import { isValidPageKey, type PageKey } from "../lib/permission-keys";
import { fetchNewFormsCount } from "../lib/forms";
import { fetchNewSupportCount } from "../lib/supportMessages";
import { fetchPendingTicketsCount } from "../lib/support-tickets";
import { fetchActionableOrdersCount } from "../lib/orders";
import { fetchPendingCariTopupsCount } from "../lib/cari-topups";
import { fetchBadge as fetchHouseStockBadge } from "../lib/house-stock";
import { fetchMe } from "../lib/account";
import Avatar from "./Avatar";
import NotificationsBell from "./NotificationsBell";

interface CountBadgeProps {
  count: number;
  tone?: "amber" | "rose";
}

function CountBadge({ count, tone = "amber" }: CountBadgeProps): React.ReactElement | null {
  if (count <= 0) return null;
  const palette =
    tone === "rose"
      ? "bg-rose-500 text-white"
      : "bg-amber-400 text-amber-950";
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full ${palette} text-[10px] font-bold leading-none`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

interface SidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
  badgeTone?: "amber" | "rose";
  page: PageKey;
  matchPrefixes?: ReadonlyArray<string>;
}

interface SidebarSection {
  title: string;
  items: ReadonlyArray<SidebarItem>;
}

interface NavSubItem {
  to: string;
  label: string;
}

interface NavGroup {
  /** Boş bırakılırsa alt başlık render edilmez (tek-grup menüler için). */
  header?: string;
  items: ReadonlyArray<NavSubItem>;
}

type AuthState = "pending" | "authed" | "guest";

interface SidebarLinkProps {
  item: SidebarItem;
  onNavigate?: () => void;
}

function SidebarLink({ item, onNavigate }: SidebarLinkProps): React.ReactElement {
  const { to, label, icon: Icon, end, badge, badgeTone } = item;
  // Rail (kapalı) durumunda label ve badge fade-out. group/sb tetikleyici
  // <aside> üzerinde tanımlı; xl breakpoint altında (mobile drawer) opacity
  // her zaman 1 kalır.
  const fadeClass =
    "xl:opacity-0 xl:group-hover/sb:opacity-100 transition-opacity duration-150";
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => {
        const base =
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors";
        return isActive
          ? `${base} bg-white/10 text-white shadow-inner shadow-black/10`
          : `${base} text-white/70 hover:bg-white/5 hover:text-white`;
      }}
    >
      {({ isActive }) => (
        <>
          <Icon
            size={18}
            strokeWidth={isActive ? 2.25 : 1.75}
            className={`shrink-0 ${isActive ? "text-white" : "text-white/60 group-hover:text-white/90"}`}
            aria-hidden="true"
          />
          <span className={`flex-1 truncate ${fadeClass}`}>{label}</span>
          {typeof badge === "number" ? (
            <span className={fadeClass}>
              <CountBadge count={badge} tone={badgeTone ?? "amber"} />
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

interface CollapsibleMenuProps {
  label: string;
  icon: LucideIcon;
  groups: ReadonlyArray<NavGroup>;
  forceOpen: boolean;
  onNavigate?: () => void;
}

// Sol menüde tek kalem olarak görünüp tıklanınca alt linkleri açan ortak
// açılır-menü ("Muhasebe" bu deseni kullanır).
function CollapsibleMenu({
  label,
  icon: Icon,
  groups,
  forceOpen,
  onNavigate,
}: CollapsibleMenuProps): React.ReactElement {
  const [open, setOpen] = useState<boolean>(forceOpen);
  const menuId = useId();
  const fadeClass =
    "xl:opacity-0 xl:group-hover/sb:opacity-100 transition-opacity duration-150";

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
          forceOpen
            ? "bg-white/10 text-white"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon
          size={18}
          strokeWidth={forceOpen ? 2.25 : 1.75}
          className={`shrink-0 ${forceOpen ? "text-white" : "text-white/60 group-hover:text-white/90"}`}
          aria-hidden="true"
        />
        <span className={`flex-1 text-left ${fadeClass}`}>{label}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`text-white/50 transition-transform ${open ? "rotate-180" : ""} ${fadeClass}`}
        />
      </button>
      {open ? (
        <div id={menuId} className={`mt-1 space-y-2 pl-2 ${fadeClass}`}>
          {groups.map((group, groupIndex) => (
            <div key={group.header ?? `group-${groupIndex}`}>
              {group.header ? (
                <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {group.header}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((sub) => (
                  <NavLink
                    key={sub.to}
                    to={sub.to}
                    onClick={onNavigate}
                    className={({ isActive }) => {
                      const base =
                        "block rounded-md px-3 py-1.5 text-[12.5px] transition-colors";
                      return isActive
                        ? `${base} bg-white/10 text-white`
                        : `${base} text-white/60 hover:bg-white/5 hover:text-white`;
                    }}
                  >
                    {sub.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminShell(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>(() =>
    getToken() ? "authed" : "pending",
  );
  const authed = authState === "authed";
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const logoClickCount = useRef<number>(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (authState !== "pending") return;
    let cancelled = false;
    void tryAutoLogin().then((ok) => {
      if (cancelled) return;
      setAuthState(ok ? "authed" : "guest");
    });
    return () => {
      cancelled = true;
    };
  }, [authState]);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, location.search]);

  // Mobile drawer açıkken arkadaki sayfanın scroll etmesini engelle: aksi
  // halde fixed inset-0 drawer + body scroll = sayfa içeriği yatay/dikey
  // kayıyor gibi görünüyor (kullanıcının "ekran sağa kayıyor" şikayetinin
  // ana nedeni). Body overflow'unu cleanup'la geri ver, başka komponent
  // (modal vs.) farklı bir değer set etmişse bozmamış olalım.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const handleLogout = async (): Promise<void> => {
    await logout();
    // Sunucu-taze izin kopyası ve TÜM sorgu önbelleği bir sonraki kullanıcıya
    // sızmasın (aynı sekmede hesap değiştirme senaryosu).
    setServerPermissions(null);
    queryClient.clear();
    navigate("/login", { replace: true });
  };

  const handleLogoClick = (): void => {
    logoClickCount.current += 1;
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    if (logoClickCount.current >= 3) {
      logoClickCount.current = 0;
      navigate("/karlilik-analizi");
      return;
    }
    logoClickTimer.current = setTimeout(() => {
      logoClickCount.current = 0;
    }, 1500);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    const term = searchTerm.trim();
    if (!term) return;
    navigate(`/orders?customer=${encodeURIComponent(term)}`);
    setSearchTerm("");
  };

  // İzinleri sunucudan taze tut: patron matristen değişiklik yapınca menü
  // token yenilenmeden (en geç 1 dk / pencere odağında) kendini günceller.
  // queryKey kullanıcıya bağlı: aynı sekmede başka kullanıcı giriş yaparsa
  // öncekinin cache'li izin seti ASLA gösterilmez.
  const currentUserId = getCurrentUserId();
  const myPermissionsQuery = useQuery({
    queryKey: ["my-permissions", currentUserId],
    queryFn: fetchMyPermissions,
    enabled: authed && !!currentUserId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Sunucu cevabını modül-içi kopyaya yaz — ProtectedRoute/layout'lardaki
  // canAccess() de aynı taze seti okusun.
  useEffect(() => {
    if (myPermissionsQuery.data) setServerPermissions(myPermissionsQuery.data);
  }, [myPermissionsQuery.data]);

  // Menü izinleri DOĞRUDAN sorgu verisinden türetilir. (Eskiden
  // getCurrentPermissions() okunuyordu; o modül kopyası yukarıdaki effect'te
  // — yani render SONRASI — dolduğu için menü kalıcı olarak bir güncelleme
  // geride kalıyordu.) Veri henüz yoksa JWT claim'ine düşülür.
  const permissions = useMemo(() => {
    const eff = myPermissionsQuery.data;
    if (eff) {
      const keys = new Set<PageKey>();
      for (const k of eff.effective) {
        if (isValidPageKey(k)) keys.add(k);
      }
      return { unbounded: eff.unbounded, pageKeys: keys };
    }
    const fromToken = getCurrentPermissions();
    return { unbounded: fromToken.unbounded, pageKeys: fromToken.pageKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, myPermissionsQuery.data]);
  const canSee = (page: PageKey): boolean =>
    permissions.unbounded || permissions.pageKeys.has(page);

  // Rozet sorguları sayfa iznine bağlı: izinsiz sayfanın sayısı hiç sorulmaz
  // (aksi halde çalışanda konsol 403'leri + sayı düzeyinde sızıntı olurdu).
  const applicationCountQuery = useQuery({
    queryKey: ["forms", "count", "APPLICATION"],
    queryFn: () => fetchNewFormsCount("APPLICATION"),
    enabled: authed && canSee("mesajlar"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const contactCountQuery = useQuery({
    queryKey: ["forms", "count", "CONTACT"],
    queryFn: () => fetchNewFormsCount("CONTACT"),
    enabled: authed && canSee("mesajlar"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const integrationCountQuery = useQuery({
    queryKey: ["forms", "count", "INTEGRATION"],
    queryFn: () => fetchNewFormsCount("INTEGRATION"),
    enabled: authed && canSee("mesajlar"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const supportCountQuery = useQuery({
    queryKey: ["support-messages", "count", "NEW"],
    queryFn: () => fetchNewSupportCount(),
    enabled: authed && canSee("mesajlar"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const ticketsCountQuery = useQuery({
    queryKey: ["support-tickets", "count", "PENDING"],
    queryFn: () => fetchPendingTicketsCount(),
    enabled: authed && canSee("mesajlar"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const actionableOrdersCountQuery = useQuery({
    queryKey: ["orders", "count", "actionable"],
    queryFn: () => fetchActionableOrdersCount(),
    enabled: authed && canSee("orders"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const pendingCariTopupsCountQuery = useQuery({
    queryKey: ["cari-topups", "count", "PENDING"],
    queryFn: () => fetchPendingCariTopupsCount(),
    enabled: authed && canSee("cari"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const depoBadgeQuery = useQuery({
    queryKey: ["house-stock", "badge"],
    queryFn: () => fetchHouseStockBadge(),
    enabled: authed && canSee("depo_stogu"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const meQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    enabled: authed,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const messagesCount =
    (applicationCountQuery.data ?? 0) +
    (contactCountQuery.data ?? 0) +
    (integrationCountQuery.data ?? 0) +
    (supportCountQuery.data ?? 0);

  const ordersCount =
    (actionableOrdersCountQuery.data ?? 0) + (ticketsCountQuery.data ?? 0);

  const cariCount = pendingCariTopupsCountQuery.data ?? 0;

  // Depo Stoğu sol-menü rozeti: TÜM depolara (bütün depo sahiplerine)
  // düşen bekleyen sipariş kalemlerinin TOPLAMI. myCount yalnız giriş yapan
  // owner'ın deposunu sayıyordu → ana admin'de 0 görünüp rozet hiç çıkmıyordu.
  // totalCount ile her gün depoya girmeden gelen siparişi menüden görürüz.
  const depoTotalCount = depoBadgeQuery.data?.totalCount ?? 0;

  const homeItems: ReadonlyArray<SidebarItem> = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, page: "dashboard" },
  ];

  const managementItems: ReadonlyArray<SidebarItem> = [
    { to: "/suppliers", label: "Tedarikçiler", icon: Truck, page: "suppliers" },
    { to: "/products", label: "Ürünler", icon: Package, page: "products" },
    {
      to: "/orders",
      label: "Siparişler",
      icon: ShoppingCart,
      badge: ordersCount,
      page: "orders",
    },
    {
      to: "/depo-stogu",
      label: "Depo Stoğu",
      icon: Warehouse,
      badge: depoTotalCount,
      badgeTone: "rose",
      page: "depo_stogu",
    },
    { to: "/customers", label: "Müşteriler", icon: Users, page: "customers" },
    { to: "/karsilastirmalar", label: "Karşılaştırmalar", icon: GitCompare, page: "comparisons" },
    { to: "/yeni-tedarik", label: "Yeni Tedarikçi Analizi", icon: PackageSearch, page: "comparisons" },
    {
      to: "/mesajlar",
      label: "Mesajlar & İstekler",
      icon: MessageSquare,
      badge: messagesCount,
      page: "mesajlar",
    },
    {
      to: "/konusmalar",
      label: "Konuşmalar",
      icon: MessageCircle,
      page: "mesajlar",
    },
    {
      to: "/popups",
      label: "Pop-up / Duyurular",
      icon: Megaphone,
      page: "popup",
    },
  ];

  const financeItems: ReadonlyArray<SidebarItem> = [
    { to: "/cari", label: "Cari", icon: Wallet, badge: cariCount, page: "cari" },
    {
      to: "/banka-bilgileri",
      label: "Banka Bilgileri",
      icon: Landmark,
      page: "banka_bilgileri",
    },
    { to: "/pos", label: "POS", icon: CreditCard, page: "pos" },
  ];

  const settingsItems: ReadonlyArray<SidebarItem> = [
    {
      to: "/ayarlar/hesap",
      label: "Hesabım",
      icon: UserIcon,
      page: "ayarlar_hesap",
      matchPrefixes: ["/ayarlar/hesap"],
    },
    {
      to: "/ayarlar/kullanicilar",
      label: "Kullanıcılar",
      icon: UserCog,
      page: "ayarlar_kullanicilar",
      matchPrefixes: ["/ayarlar/kullanicilar"],
    },
    {
      to: "/ayarlar/degiskenler",
      label: "Değişkenler",
      icon: Sliders,
      page: "ayarlar_degiskenler",
      matchPrefixes: ["/ayarlar/degiskenler", "/ayarlar"],
    },
    {
      to: "/ayarlar/fatura",
      label: "Fatura",
      icon: Receipt,
      page: "ayarlar_fatura",
      matchPrefixes: ["/ayarlar/fatura"],
    },
    {
      to: "/ayarlar/raporlar",
      label: "Raporlar",
      icon: BarChart3,
      page: "ayarlar_raporlar",
      matchPrefixes: ["/ayarlar/raporlar"],
    },
    {
      to: "/loglar",
      label: "Loglar",
      icon: ScrollText,
      page: "loglar",
      matchPrefixes: ["/audit-logs", "/loglar"],
    },
    {
      to: "/loglar/bugun",
      label: "Bugün ne oldu?",
      icon: Clock,
      page: "loglar",
      matchPrefixes: ["/loglar/bugun"],
    },
  ];

  // Muhasebe açılır-menüsü: 4 alt sayfa. "Tahsilat Makbuzları" mevcut
  // MakbuzlarPage'i yeniden kullanır ve eski `makbuzlar` page-key'i ile korunur.
  const muhasebeGroups: ReadonlyArray<NavGroup> = [
    {
      items: [
        { to: "/muhasebe/cari-hareketler", label: "Cari Hareketler" },
        { to: "/muhasebe/tahsilat-makbuzlari", label: "Tahsilat Makbuzları" },
        { to: "/muhasebe/tedarikci-hesap", label: "Tedarikçi Hesap" },
        { to: "/muhasebe/bayi-hesap", label: "Bayi Hesap" },
        { to: "/muhasebe/aylik-kar-dagilimi", label: "Aylık Kâr Dağılımı" },
      ],
    },
  ];

  const canSeeMuhasebe =
    canSee("muhasebe_cari_hareketler") ||
    canSee("makbuzlar") ||
    canSee("muhasebe_tedarikci_hesap") ||
    canSee("muhasebe_bayi_hesap") ||
    canSee("muhasebe_kar_dagilimi");
  const isMuhasebeActive = location.pathname.startsWith("/muhasebe");

  const filteredHome = homeItems.filter((item) => canSee(item.page));
  const filteredManagement = managementItems.filter((item) => canSee(item.page));
  const filteredFinance = financeItems.filter((item) => canSee(item.page));
  const filteredSettings = settingsItems.filter((item) => canSee(item.page));

  const sections: ReadonlyArray<SidebarSection> = [
    { title: "Ana Sayfa", items: filteredHome },
    { title: "Yönetim", items: filteredManagement },
    { title: "Finans", items: filteredFinance },
  ].filter((section) => section.items.length > 0);

  if (authState === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Oturum doğrulanıyor…</div>
      </div>
    );
  }
  if (authState === "guest") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const closeMobile = (): void => setMobileOpen(false);

  // Rail/açık modda metinleri fade-in/out etmek için ortak class. Sadece
  // xl+ ekranlarda devreye girer; mobile drawer açıldığında group/sb hover
  // tetiklenmediği için label görünür kalsın diye xl: prefix kullanıyoruz.
  const fadeOnRail =
    "xl:opacity-0 xl:group-hover/sb:opacity-100 transition-opacity duration-150";

  const sidebarBody = (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-6 pb-5">
        <div
          onClick={handleLogoClick}
          className="flex items-center gap-3 select-none cursor-default"
          aria-label="Toptan Budur"
        >
          <img
            src="/admin/toptanbudur-logo-white.png"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 object-contain shrink-0"
            draggable={false}
          />
          <div className={`min-w-0 ${fadeOnRail}`}>
            <p className="text-[15px] font-semibold tracking-tight text-white truncate">
              Toptan Budur
            </p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
              Admin
            </p>
          </div>
        </div>
      </div>

      <div className="mx-3 my-1 h-px bg-white/10" aria-hidden="true" />

      <nav className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 space-y-5">
        {sections.map((section) => (
          <div key={section.title}>
            <p
              className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 ${fadeOnRail}`}
            >
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={closeMobile} />
              ))}
            </div>
          </div>
        ))}

        {canSeeMuhasebe ? (
          <div>
            <p
              className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 ${fadeOnRail}`}
            >
              Muhasebe
            </p>
            <CollapsibleMenu
              label="Muhasebe"
              icon={ReceiptText}
              groups={muhasebeGroups}
              forceOpen={isMuhasebeActive}
              onNavigate={closeMobile}
            />
          </div>
        ) : null}

        {filteredSettings.length > 0 ? (
          <div>
            <p
              className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 ${fadeOnRail}`}
            >
              Ayarlar
            </p>
            <div className="space-y-0.5">
              {filteredSettings.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={closeMobile} />
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <button
          type="button"
          onClick={handleLogout}
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className={fadeOnRail}>Çıkış</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-50">
      {/*
        Rail sidebar: kapalıyken 20 (5rem) genişliğinde sadece ikonlar,
        hover'da 72 (18rem)'ye açılır. group/sb tetikleyicisi label/badge
        fade-in/out animasyonu için SidebarLink/BotMenu içindeki
        xl:group-hover/sb:opacity-100 kuralı tarafından okunur.
      */}
      <aside
        className="group/sb hidden xl:flex fixed inset-y-0 left-0 z-30 w-20 hover:w-72 flex-col bg-[var(--color-brand-navy)] text-white overflow-hidden transition-[width] duration-200 ease-out shadow-xl"
        aria-label="Yan menü"
      >
        {sidebarBody}
      </aside>

      {mobileOpen ? (
        <div className="xl:hidden fixed inset-0 z-40 flex">
          {/*
            Mobile drawer SOLDAN açılır: desktop rail sidebar zaten left-0
            konumunda olduğu için tutarlılık ve menü butonu (sol üstte)
            mantığı açısından drawer da soldan girer. Backdrop sağda
            kalan boşluğu doldurur.
          */}
          <aside
            id="admin-mobile-nav"
            className="w-72 max-w-[85vw] shrink-0 bg-[var(--color-brand-navy)] text-white shadow-2xl overflow-y-auto"
            aria-label="Yan menü"
          >
            {sidebarBody}
          </aside>
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={closeMobile}
            className="flex-1 bg-slate-900/60 backdrop-blur-sm"
          />
        </div>
      ) : null}

      <div className="xl:pl-20 min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex h-16 items-center gap-2 sm:gap-3 px-3 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="xl:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Menüyü aç/kapat"
              aria-expanded={mobileOpen}
              aria-controls="admin-mobile-nav"
            >
              {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>

            {/*
              Search: flex-1 ile kalan alanı doldurur, max-w ile aşırı
              uzamayı sınırlar. Sağdaki cluster (bell + avatar) ml-auto
              ile gerçek flush-right olur — eski xl:ml-auto search'te
              durduğu için ikonlar arada sıkışıp kayıyordu.
            */}
            <div className="relative flex-1 min-w-0 max-w-md xl:max-w-2xl 2xl:max-w-3xl">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Sipariş no, kargo barkodu, tedarikçi sip. no, müşteri ara…"
                aria-label="Sipariş ara"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-900/5"
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              {canSee("bildirimler") && <NotificationsBell />}

              <NavLink
                to="/ayarlar/hesap"
                aria-label="Hesabım"
                title={meQuery.data?.name ?? meQuery.data?.email ?? "Hesabım"}
                className="hidden md:inline-flex rounded-full ring-2 ring-transparent transition hover:ring-slate-200"
              >
                <Avatar
                  src={meQuery.data?.profilePhotoUrl}
                  name={meQuery.data?.name}
                  email={meQuery.data?.email}
                  size="xs"
                />
              </NavLink>

              <div className="md:hidden relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="inline-flex items-center justify-center rounded-full ring-2 ring-transparent transition hover:ring-slate-200"
                  aria-label="Kullanıcı menüsü"
                  aria-expanded={userMenuOpen}
                >
                  <Avatar
                    src={meQuery.data?.profilePhotoUrl}
                    name={meQuery.data?.name}
                    email={meQuery.data?.email}
                    size="xs"
                  />
                </button>
                {userMenuOpen ? (
                  <div
                    className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                    role="menu"
                  >
                    <NavLink
                      to="/ayarlar/hesap"
                      onClick={() => setUserMenuOpen(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Hesabım
                    </NavLink>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLogout();
                      }}
                      className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Çıkış
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

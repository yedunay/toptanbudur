import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { ReactElement } from "react";
import AdminShell from "./components/AdminShell";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./components/ProtectedRoute";
import { ToastProvider } from "./components/Toast";
import type { PageKey } from "./lib/permission-keys";
import { firstAllowedRoute } from "./lib/permissions";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProductsPage from "./pages/ProductsPage";
import CategoriesPage from "./pages/CategoriesPage";
import SuppliersPage from "./pages/SuppliersPage";
import SupplierFormPage from "./pages/SupplierFormPage";
import SupplierProductsPage from "./pages/SupplierProductsPage";
import SupplierBrandsPage from "./pages/SupplierBrandsPage";
import OrdersPage from "./pages/OrdersPage";
import OrdersLayout from "./pages/OrdersLayout";
import OrderDetailPage from "./pages/OrderDetailPage";
import CustomersPage from "./pages/CustomersPage";
import ComparisonsPage from "./pages/ComparisonsPage";
import TedarikAnaliziPage from "./pages/TedarikAnaliziPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import CariPage from "./pages/CariPage";
import BankaBilgileriPage from "./pages/BankaBilgileriPage";
import PosPage from "./pages/PosPage";
import PosDetailPage from "./pages/PosDetailPage";
import MakbuzlarPage from "./pages/MakbuzlarPage";
import CariHareketlerPage from "./pages/muhasebe/CariHareketlerPage";
import TedarikciHesapPage from "./pages/muhasebe/TedarikciHesapPage";
import BayiHesapPage from "./pages/muhasebe/BayiHesapPage";
import AylikKarDagilimiPage from "./pages/muhasebe/AylikKarDagilimiPage";
import DealerApplicationsPage from "./pages/DealerApplicationsPage";
import FormsPage from "./pages/FormsPage";
import AuditLogPage from "./pages/AuditLogPage";
import AuditLogSettingsPage from "./pages/AuditLogSettingsPage";
import AuditTodayDashboardPage from "./pages/AuditTodayDashboardPage";
import SupportMessagesPage from "./pages/SupportMessagesPage";
import MesajlarPage from "./pages/MesajlarPage";
import KonusmalarPage from "./pages/KonusmalarPage";
import SupportTicketsPage from "./pages/SupportTicketsPage";
import SettingsPage from "./pages/SettingsPage";
import UsersPage from "./pages/UsersPage";
import HesapPage from "./pages/HesapPage";
import FaturaPage from "./pages/FaturaPage";
import KarlilikAnaliziPage from "./pages/KarlilikAnaliziPage";
import NotificationsPage from "./pages/NotificationsPage";
import PopupsPage from "./pages/PopupsPage";
import ReportsPage from "./pages/ReportsPage";
import DepoStoguPage from "./pages/DepoStoguPage";

/** Her route'u ayrı bir ErrorBoundary ile sar — bir sayfa çökse bile diğer
 * route'lara geçiş yapılabilsin. */
function withBoundary(node: ReactElement): ReactElement {
  return <ErrorBoundary>{node}</ErrorBoundary>;
}

/**
 * Query string'i koruyarak başka bir path'e yönlendiren redirect. Düz
 * `<Navigate to=... />` query'yi düşürür; bildirim deep-link'lerinde
 * (?tab=...) parametre kaybolmasın diye location.search'i taşıyoruz.
 */
function RedirectPreservingQuery({ to }: { to: string }): ReactElement {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

/** Bilinmeyen URL → kullanıcının izinli olduğu ilk sayfa. Eskiden sabit "/"
 *  idi; dashboard izni olmayan çalışan her yanlış URL'de 403'e düşüyordu. */
function CatchAllRedirect(): ReactElement {
  return <Navigate to={firstAllowedRoute()} replace />;
}

/** Sayfayı önce ProtectedRoute ile, sonra ErrorBoundary ile sar.
 *  ProtectedRoute içeride 403 ekranı render edebilir; ErrorBoundary ise
 *  beklenmeyen render hatalarını yakalar. İkisi de izole şekilde çalışır. */
function guarded(page: PageKey, node: ReactElement): ReactElement {
  return (
    <ErrorBoundary>
      <ProtectedRoute page={page}>{node}</ProtectedRoute>
    </ErrorBoundary>
  );
}

export default function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter basename="/admin">
          <Routes>
            <Route path="/login" element={withBoundary(<LoginPage />)} />
            <Route element={<AdminShell />}>
              <Route path="/" element={guarded("dashboard", <DashboardPage />)} />
              <Route
                path="/products"
                element={guarded("products", <ProductsPage />)}
              />
              <Route
                path="/categories"
                element={guarded("products", <CategoriesPage />)}
              />

              {/* Eski "Senkron" sayfası kaldırıldı — senkronizasyon
                  Tedarikçiler sayfasından (her satır için "Test Senkron")
                  yapılıyor. Eski URL tedarikçi listesine yönlendiriliyor. */}
              <Route path="/sync" element={<Navigate to="/suppliers" replace />} />

              <Route
                path="/suppliers"
                element={guarded("suppliers", <SuppliersPage />)}
              />
              <Route
                path="/suppliers/new"
                element={guarded("suppliers", <SupplierFormPage />)}
              />
              <Route
                path="/suppliers/:id/edit"
                element={guarded("suppliers", <SupplierFormPage />)}
              />
              <Route path="/supplier-groups/new" element={<Navigate to="/suppliers" replace />} />
              <Route path="/supplier-groups/:id/edit" element={<Navigate to="/suppliers" replace />} />
              <Route
                path="/suppliers/:id/products"
                element={guarded("suppliers", <SupplierProductsPage />)}
              />
              <Route
                path="/suppliers/:id/brands"
                element={guarded("suppliers", <SupplierBrandsPage />)}
              />

              <Route path="/orders" element={<OrdersLayout />}>
                <Route index element={guarded("orders", <OrdersPage />)} />
                {/* Sipariş Talepleri /admin/support-messages endpoint'ini
                    kullanır; backend bunu @RequirePage('mesajlar') ile korur.
                    FE guard'ı da 'mesajlar' olmalı — aksi halde 'orders' izni
                    olup 'mesajlar' olmayan kullanıcı sayfayı görüp API'den 403
                    alıyordu. Konuşmalar (/konusmalar) ile AYNI key (#40). */}
                <Route
                  path="talepler"
                  element={guarded("mesajlar", <SupportTicketsPage />)}
                />
              </Route>
              <Route
                path="/orders/:id"
                element={guarded("orders", <OrderDetailPage />)}
              />

              {/* Geriye dönük uyumluluk — eski sipariş talepleri url'i yeni
                  birleşik sipariş sayfasına yönlensin. */}
              <Route
                path="/siparis-talepleri"
                element={<Navigate to="/orders/talepler" replace />}
              />

              <Route
                path="/customers"
                element={guarded("customers", <CustomersPage />)}
              />
              <Route
                path="/karsilastirmalar"
                element={guarded("comparisons", <ComparisonsPage />)}
              />
              <Route
                path="/yeni-tedarik"
                element={guarded("comparisons", <TedarikAnaliziPage />)}
              />
              <Route
                path="/customers/:id"
                element={guarded("customers", <CustomerDetailPage />)}
              />
              <Route path="/cari" element={guarded("cari", <CariPage />)} />

              <Route
                path="/depo-stogu"
                element={guarded("depo_stogu", <DepoStoguPage />)}
              />

              {/* house_stock.reserved bildirimi '/admin/house-stock?tab=pending'
                  link'i üretiyor; gerçek rota '/depo-stogu'. Router basename
                  '/admin' olduğu için in-router path '/house-stock'. Bildirim
                  doğru sayfayı açsın diye alias ekliyoruz; ?tab parametresi
                  korunarak taşınır (#40). */}
              <Route
                path="/house-stock"
                element={<RedirectPreservingQuery to="/depo-stogu" />}
              />
              <Route
                path="/admin/house-stock"
                element={<RedirectPreservingQuery to="/depo-stogu" />}
              />

              {/* Geriye dönük uyumluluk — eski Cari url'leri birleşik sayfaya
                  yönlensin. */}
              <Route
                path="/cari-odemeler"
                element={<Navigate to="/cari" replace />}
              />
              <Route
                path="/cari-hareketler"
                element={<Navigate to="/cari" replace />}
              />

              <Route
                path="/banka-bilgileri"
                element={guarded("banka_bilgileri", <BankaBilgileriPage />)}
              />

              <Route path="/pos" element={guarded("pos", <PosPage />)} />
              <Route path="/pos/:key" element={guarded("pos", <PosDetailPage />)} />
              <Route path="/makbuzlar" element={guarded("makbuzlar", <MakbuzlarPage />)} />

              {/* Muhasebe — tek menü altında 4 alt sayfa. Varsayılan giriş
                  Cari Hareketler'e yönlenir. Tahsilat Makbuzları mevcut
                  MakbuzlarPage'i ve `makbuzlar` page-key'ini yeniden kullanır
                  (içerik dokunulmadan korunur). Deep-link query'leri korumak
                  için redirect RedirectPreservingQuery ile yapılır. */}
              <Route
                path="/muhasebe"
                element={<RedirectPreservingQuery to="/muhasebe/cari-hareketler" />}
              />
              <Route
                path="/muhasebe/cari-hareketler"
                element={guarded("muhasebe_cari_hareketler", <CariHareketlerPage />)}
              />
              <Route
                path="/muhasebe/tahsilat-makbuzlari"
                element={guarded("makbuzlar", <MakbuzlarPage />)}
              />
              <Route
                path="/muhasebe/tedarikci-hesap"
                element={guarded("muhasebe_tedarikci_hesap", <TedarikciHesapPage />)}
              />
              <Route
                path="/muhasebe/bayi-hesap"
                element={guarded("muhasebe_bayi_hesap", <BayiHesapPage />)}
              />
              <Route
                path="/muhasebe/aylik-kar-dagilimi"
                element={guarded(
                  "muhasebe_kar_dagilimi",
                  <AylikKarDagilimiPage />,
                )}
              />

              {/* Yeni: birleşik mesajlar sayfası */}
              <Route
                path="/mesajlar"
                element={guarded("mesajlar", <MesajlarPage />)}
              />
              <Route
                path="/messages"
                element={guarded("mesajlar", <MesajlarPage />)}
              />
              <Route
                path="/konusmalar"
                element={guarded("mesajlar", <KonusmalarPage />)}
              />

              {/* Geriye dönük uyumluluk — eski url'ler birleşik sayfaya yönlensin */}
              <Route
                path="/forms"
                element={<Navigate to="/mesajlar?source=CONTACT" replace />}
              />
              <Route
                path="/formlar"
                element={<Navigate to="/mesajlar?source=CONTACT" replace />}
              />
              <Route
                path="/support"
                element={<Navigate to="/mesajlar?source=SUPPORT" replace />}
              />
              <Route
                path="/destek"
                element={<Navigate to="/mesajlar?source=SUPPORT" replace />}
              />
              <Route
                path="/destek-mesajlari"
                element={<Navigate to="/mesajlar?source=SUPPORT" replace />}
              />
              <Route
                path="/dealer-applications"
                element={<Navigate to="/mesajlar?source=APPLICATION" replace />}
              />

              {/* Eski sayfalar konsol için tutuluyor (legacy yollar) */}
              <Route
                path="/legacy/forms"
                element={guarded("mesajlar", <FormsPage />)}
              />
              <Route
                path="/legacy/support"
                element={guarded("mesajlar", <SupportMessagesPage />)}
              />
              <Route
                path="/legacy/dealer-applications"
                element={guarded("mesajlar", <DealerApplicationsPage />)}
              />

              <Route
                path="/ayarlar/degiskenler"
                element={guarded("ayarlar_degiskenler", <SettingsPage />)}
              />
              <Route
                path="/ayarlar/kullanicilar"
                element={guarded("ayarlar_kullanicilar", <UsersPage />)}
              />
              <Route
                path="/ayarlar/hesap"
                element={guarded("ayarlar_hesap", <HesapPage />)}
              />
              <Route
                path="/ayarlar/fatura"
                element={guarded("ayarlar_fatura", <FaturaPage />)}
              />
              <Route
                path="/ayarlar/raporlar"
                element={guarded("ayarlar_raporlar", <ReportsPage />)}
              />
              <Route
                path="/ayarlar"
                element={<Navigate to="/ayarlar/degiskenler" replace />}
              />

              <Route
                path="/karlilik-analizi"
                element={guarded("karlilik_analizi", <KarlilikAnaliziPage />)}
              />

              <Route
                path="/bildirimler"
                element={guarded("bildirimler", <NotificationsPage />)}
              />

              <Route
                path="/popups"
                element={guarded("popup", <PopupsPage />)}
              />

              <Route
                path="/loglar"
                element={guarded("loglar", <AuditLogPage />)}
              />
              <Route
                path="/audit-logs"
                element={guarded("loglar", <AuditLogPage />)}
              />
              <Route
                path="/loglar/ayarlar"
                element={guarded("loglar", <AuditLogSettingsPage />)}
              />
              <Route
                path="/audit-logs/settings"
                element={guarded("loglar", <AuditLogSettingsPage />)}
              />
              <Route
                path="/loglar/bugun"
                element={guarded("loglar", <AuditTodayDashboardPage />)}
              />
            </Route>
            <Route path="*" element={<CatchAllRedirect />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

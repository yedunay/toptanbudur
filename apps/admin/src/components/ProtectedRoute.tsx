import type { ReactElement } from "react";
import { canAccess } from "../lib/permissions";
import type { PageKey } from "../lib/permission-keys";

interface ProtectedRouteProps {
  page: PageKey;
  children: ReactElement;
}

/**
 * İzin yoksa satır içi bir 403 ekranı gösterir.
 *
 * Why: Daha önce `<Navigate to="/dashboard" />` kullanılıyordu ama bu rota
 * mevcut değil (dashboard `path="/"` altında ve kendisi "dashboard" page
 * key'iyle korunuyor). "dashboard" iznine sahip olmayan kullanıcı sonsuz
 * yönlendirme döngüsüne / boş ekrana düşüyordu. Bunun yerine doğal akışı
 * bozmayan, kapatılamaz bir erişim-engeli mesajı render ediyoruz. Backend
 * PagePermissionGuard gerçek korumadır; bu yalnız UX katmanıdır.
 */
export default function ProtectedRoute({
  page,
  children,
}: ProtectedRouteProps): ReactElement {
  if (!canAccess(page)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl font-semibold text-slate-300">403</div>
        <h1 className="text-lg font-semibold text-slate-700">
          Bu sayfaya erişim izniniz yok
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          Yetkiniz bu bölümü görüntülemeye uygun değil. Erişim gerekiyorsa
          yöneticinizle iletişime geçin.
        </p>
      </div>
    );
  }
  return children;
}

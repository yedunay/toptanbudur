import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Sayfa düzeyinde beklenmedik hataları yakalar (white-screen önleyici).
 * React `componentDidCatch` API'siyle çalışır; sadece **render** hatalarını
 * yakalayabilir. Async hatalar React Query'nin `isError` durumuyla
 * sayfa içinde yönetilir.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Geliştirici konsolunda izlenebilsin diye log'la; prod'da sentry vb.
    // entegrasyonu için burayı genişletmek yeterli.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private handleGoHome = (): void => {
    if (typeof window !== "undefined") {
      window.location.assign("/admin/");
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const message =
      this.state.error instanceof Error ? this.state.error.message : "";

    return (
      <div className="mx-auto max-w-lg p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <h2 className="mb-2 text-lg font-semibold">Bir şeyler ters gitti</h2>
          <p className="mb-4">
            Sayfa yüklenirken beklenmedik bir hata oluştu. Sayfayı yenilemeyi
            deneyin. Sorun devam ederse yöneticinize bildirin.
          </p>
          {message ? (
            <pre className="mb-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-red-200 bg-white/60 p-2 text-xs text-red-900">
              {message}
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
            >
              Sayfayı yenile
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            >
              Ana sayfaya dön
            </button>
          </div>
        </div>
      </div>
    );
  }
}

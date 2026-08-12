import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import CariHareketlerPanel from "../components/CariHareketlerPanel";
import { TedarikciCariPanel } from "../features/supplier-current-account/components/TedarikciCariPanel";

type CariTab = "bayi" | "tedarikci";

function readTabFromUrl(): CariTab {
  if (typeof window === "undefined") return "bayi";
  const sp = new URLSearchParams(window.location.search);
  const tab = sp.get("tab");
  return tab === "tedarikci" ? "tedarikci" : "bayi";
}

function writeTabToUrl(tab: CariTab): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (tab === "bayi") {
    sp.delete("tab");
  } else {
    sp.set("tab", tab);
  }
  const qs = sp.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  window.history.replaceState(null, "", next);
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({
  active,
  onClick,
  children,
}: TabButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative px-4 py-2 text-sm font-medium transition ${
        active
          ? "text-[var(--color-brand-blue,#0f62fe)]"
          : "text-slate-600 hover:text-[var(--color-text)]"
      }`}
    >
      {children}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--color-brand-blue,#0f62fe)]"
        />
      ) : null}
    </button>
  );
}

export default function CariPage(): React.ReactElement | null {
  useDocumentTitle("Cari");
  const authed = useRequireAuth();
  const [tab, setTab] = useState<CariTab>(() => readTabFromUrl());

  useEffect(() => {
    writeTabToUrl(tab);
  }, [tab]);

  const selectBayi = useCallback((): void => setTab("bayi"), []);
  const selectTedarikci = useCallback((): void => setTab("tedarikci"), []);

  if (!authed) return null;

  const description =
    tab === "bayi"
      ? "Müşteri bakiye hareketleri, yükleme talepleri ve manuel düzeltmeler"
      : "Tedarikçi bazlı satış, alış, kâr ve KDV farkı raporu";

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Cari
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {description}
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Cari sekmeleri"
        className="mb-6 flex items-center gap-1 border-b border-[var(--color-border)]"
      >
        <TabButton active={tab === "bayi"} onClick={selectBayi}>
          Bayi Cari
        </TabButton>
        <TabButton active={tab === "tedarikci"} onClick={selectTedarikci}>
          Tedarikçi Cari Hareketleri
        </TabButton>
      </div>

      {tab === "bayi" ? (
        <CariHareketlerPanel enabled={authed} />
      ) : (
        <TedarikciCariPanel enabled={authed} />
      )}
    </div>
  );
}

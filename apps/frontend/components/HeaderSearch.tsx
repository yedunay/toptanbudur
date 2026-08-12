"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const PLACEHOLDER = "Ürün, marka veya kategori ara…";

type HeaderSearchProps = {
  variant?: "desktop" | "mobile";
  onSubmitted?: () => void;
  className?: string;
};

function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function HeaderSearch({
  variant = "desktop",
  onSubmitted,
  className,
}: HeaderSearchProps) {
  const isMobile = variant === "mobile";
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // JS aktifken native form gönderimini her durumda engelle; boş sorguda
    // hiçbir şey yapma. `action`/`method` yalnızca JS devre dışıyken devreye
    // giren fallback'tir.
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/katalog?q=${encodeURIComponent(q)}`);
    // Paneli sonraki frame'de kapat — router.push transition'ı ile aynı render
    // batch'inde unmount olursa navigasyon iptal oluyordu (yarış koşulu).
    requestAnimationFrame(() => onSubmitted?.());
  }

  return (
    <form
      action="/katalog"
      method="get"
      role="search"
      aria-label="Ürün ara"
      onSubmit={handleSubmit}
      className={classes(
        "flex items-center gap-2 rounded-full border border-ab-border bg-white px-3 py-1.5 shadow-sm transition focus-within:border-ab-blue focus-within:ring-2 focus-within:ring-ab-blue/20",
        isMobile ? "w-full" : "w-full lg:w-72",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-ab-blue" aria-hidden />
      <label
        htmlFor={isMobile ? "header-search-mobile" : "header-search-desktop"}
        className="sr-only"
      >
        Ürün ara
      </label>
      <input
        id={isMobile ? "header-search-mobile" : "header-search-desktop"}
        type="search"
        name="q"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-1 text-ab-sm text-ab-text-body placeholder:text-ab-text-hint outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-ab-navy px-3 py-1 text-ab-xs font-semibold text-white transition hover:bg-ab-blue"
      >
        Ara
      </button>
    </form>
  );
}

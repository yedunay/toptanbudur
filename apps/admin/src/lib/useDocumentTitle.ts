import { useEffect } from "react";

const TITLE_PREFIX = "Toptan Budur Admin";

/**
 * Sets the browser tab title with a consistent "Toptan Budur Admin" prefix.
 * Pass empty string for the dashboard.
 */
export function useDocumentTitle(suffix?: string | null): void {
  useEffect(() => {
    const next = suffix && suffix.trim().length > 0 ? `${TITLE_PREFIX} · ${suffix}` : TITLE_PREFIX;
    if (typeof document !== "undefined") {
      const previous = document.title;
      document.title = next;
      return () => {
        document.title = previous;
      };
    }
    return undefined;
  }, [suffix]);
}

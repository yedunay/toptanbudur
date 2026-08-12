"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchActivePopups,
  markPopupClicked,
  markPopupDismissed,
  markPopupSeen,
  type ClientPopup,
} from "@/lib/popups";
import { PopupModal } from "./PopupModal";

/**
 * Müşteri panelinde aktif pop-up'ları yöneten görünmez orkestratör. RootLayout
 * (LayoutChrome) içinde her sayfada mount edilir ama yalnızca oturum açıkken
 * çalışır. Birden çok pop-up varsa öncelik sırasıyla teker teker gösterir.
 *
 * Sözleşme — sunucu sinyalleri:
 *  - Ekrana çıktığında  → markPopupSeen   (sayaç +1; ONCE/LIMITED bunu sayar)
 *  - Kapatıldığında     → markPopupDismissed (bir daha gösterme)
 *  - CTA tıklandığında  → markPopupClicked (dönüşüm)
 * Hepsi best-effort: pop-up kritik bir akış değil, hata sessizce yutulur.
 */

// İlk pop-up çıkmadan önce sayfanın oturması için kısa gecikme (yormamak için).
const FIRST_SHOW_DELAY_MS = 600;

export function PopupHost() {
  const { loggedIn } = useAuth();
  const [queue, setQueue] = useState<ClientPopup[]>([]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef(false);

  // Oturum açıldığında aktif pop-up'ları bir kez yükle; kapanınca sıfırla.
  useEffect(() => {
    if (!loggedIn) {
      setQueue([]);
      setIndex(0);
      setReady(false);
      seenRef.current = new Set();
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const popups = await fetchActivePopups();
        if (cancelled) return;
        setQueue(popups);
      } catch {
        /* sessiz: pop-up kritik değil */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  // Kuyrukta gösterilecek pop-up varsa kısa gecikmeden sonra göstermeye hazır ol.
  useEffect(() => {
    if (ready || queue.length === 0) return;
    const handle = setTimeout(() => setReady(true), FIRST_SHOW_DELAY_MS);
    return () => clearTimeout(handle);
  }, [ready, queue.length]);

  const current = ready ? (queue[index] ?? null) : null;

  // Pop-up ekrana çıktığında bir kez "görüldü" gönder.
  useEffect(() => {
    if (!current) return;
    if (seenRef.current.has(current.id)) return;
    seenRef.current.add(current.id);
    void markPopupSeen(current.id).catch(() => {});
  }, [current]);

  if (!loggedIn || !current) return null;

  const advance = () => setIndex((i) => i + 1);

  const handleClose = () => {
    void markPopupDismissed(current.id).catch(() => {});
    advance();
  };

  const handleCtaClick = () => {
    void markPopupClicked(current.id).catch(() => {});
    advance();
  };

  return (
    <PopupModal
      key={current.id}
      popup={current}
      onClose={handleClose}
      onCtaClick={handleCtaClick}
    />
  );
}

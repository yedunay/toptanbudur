"use client";

import type { ServerCustomer } from "@/lib/auth-server";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { PopupHost } from "./PopupHost";
import { WhatsAppFloating } from "./WhatsAppFloating";

interface LayoutChromeProps {
  children: React.ReactNode;
  customer: ServerCustomer | null;
}

export function LayoutChrome({ children, customer }: LayoutChromeProps) {
  return (
    <>
      <Header customer={customer} />
      <div className="flex-1">{children}</div>
      <Footer />
      <WhatsAppFloating />
      <PopupHost />
    </>
  );
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@/lib/auth";

const BROADCAST_CHANNEL = "tb-auth";

const API_ROOT =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const AUTH_BASE = `${API_ROOT}/api/customer/auth`;

interface AuthContextValue {
  customer: Customer | null;
  loggedIn: boolean;
  setCustomer: (customer: Customer | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  initial: Customer | null;
  children: React.ReactNode;
}

export function AuthProvider({ initial, children }: AuthProviderProps) {
  const [customer, setCustomerState] = useState<Customer | null>(initial);
  const router = useRouter();
  const channelRef = useRef<BroadcastChannel | null>(null);

  const setCustomer = useCallback((next: Customer | null) => {
    setCustomerState(next);
    try {
      channelRef.current?.postMessage(next ? "login" : "logout");
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        credentials: "include",
      });
      // H-68: Daha önce tüm hatalar sessizce yutuluyordu; ağ hatasında bile
      // local state temizleniyor ama oturum cookie'si sunucuda kalabiliyordu.
      // En azından operasyon ekibinin görebilmesi için log'a düşürüyoruz.
      if (!res.ok) {
        console.error(
          `[auth] logout endpoint returned non-OK status=${res.status}`,
        );
      }
    } catch (err) {
      console.error(
        `[auth] logout request failed err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    setCustomer(null);
    router.refresh();
  }, [router, setCustomer]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const bc =
      "BroadcastChannel" in window ? new BroadcastChannel(BROADCAST_CHANNEL) : null;
    channelRef.current = bc;

    if (bc) {
      bc.onmessage = (event) => {
        if (event.data === "logout") {
          setCustomerState(null);
          router.refresh();
        } else if (event.data === "login") {
          router.refresh();
        }
      };
    }

    return () => {
      bc?.close();
      channelRef.current = null;
    };
  }, [router]);

  useEffect(() => {
    if (initial !== null) {
      setCustomerState(initial);
    }
  }, [initial]);

  const value = useMemo<AuthContextValue>(
    () => ({
      customer,
      loggedIn: customer !== null,
      setCustomer,
      logout,
    }),
    [customer, logout, setCustomer],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}

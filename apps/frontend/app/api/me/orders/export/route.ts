import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SESSION_COOKIE_NAME = "tb_session";
const API_BASE =
  process.env.TB_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

const ALLOWED_KEYS = new Set([
  "status",
  "search",
  "marketplace",
  "cargoCompany",
  "dateFrom",
  "dateTo",
]);

const ALLOWED_STATUS_VALUES = new Set([
  "paid",
  "preparing",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
  "refunded",
]);

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function resolveDatePreset(
  preset: string | null,
): { dateFrom?: string; dateTo?: string } {
  if (!preset) return {};
  const now = new Date();
  switch (preset) {
    case "today":
      return { dateFrom: toDateStr(now), dateTo: toDateStr(now) };
    case "7d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 6);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "30d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 29);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "thisMonth": {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "lastMonth": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(t) };
    }
    default:
      return {};
  }
}

export async function GET(req: NextRequest) {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE_NAME);
  if (!session?.value) {
    return NextResponse.json(
      { success: false, error: "Yetkilendirme gerekli" },
      { status: 401 },
    );
  }

  const incoming = req.nextUrl.searchParams;

  const params = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const raw = incoming.get(key);
    if (!raw) continue;
    const value = raw.trim();
    if (value === "") continue;
    if (key === "status" && !ALLOWED_STATUS_VALUES.has(value)) continue;
    params.set(key, value);
  }

  if (!params.has("dateFrom") && !params.has("dateTo")) {
    const resolved = resolveDatePreset(incoming.get("datePreset"));
    if (resolved.dateFrom) params.set("dateFrom", resolved.dateFrom);
    if (resolved.dateTo) params.set("dateTo", resolved.dateTo);
  }

  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/me/orders/export.xlsx?${qs}`
    : `${API_BASE}/api/me/orders/export.xlsx`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
        accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.warn(
      `[orders-export] upstream fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      { success: false, error: "Sunucuya ulaşılamadı" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    let upstreamMessage: string | undefined;
    try {
      const ct = upstream.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const data = (await upstream.json()) as {
          message?: string | string[];
          error?: string;
        };
        if (Array.isArray(data.message)) {
          upstreamMessage = data.message.join(" • ");
        } else if (typeof data.message === "string") {
          upstreamMessage = data.message;
        } else if (typeof data.error === "string") {
          upstreamMessage = data.error;
        }
      }
    } catch {
      // ignore parse failures, fall back to generic message
    }
    console.warn(
      `[orders-export] upstream non-OK status=${upstream.status} message=${
        upstreamMessage ?? "n/a"
      }`,
    );
    return NextResponse.json(
      {
        success: false,
        error: upstreamMessage ?? "Dışa aktarma başarısız oldu",
      },
      { status: upstream.status },
    );
  }

  const arrayBuffer = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers.set("Content-Disposition", disposition);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    headers.set(
      "Content-Disposition",
      `attachment; filename="siparislerim-${today}.xlsx"`,
    );
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Length", String(arrayBuffer.byteLength));

  return new NextResponse(arrayBuffer, { status: 200, headers });
}

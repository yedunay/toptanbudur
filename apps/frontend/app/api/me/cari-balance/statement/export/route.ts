import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SESSION_COOKIE_NAME = "tb_session";
const API_BASE =
  process.env.TB_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

const ALLOWED_KEYS = new Set(["from", "to", "type", "search"]);
const ALLOWED_TYPE_VALUES = new Set([
  "TOPUP",
  "ORDER_PAYMENT",
  "REFUND",
  "ADJUSTMENT",
]);

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Proxies the customer cari-hesap (current account) statement export to the
 * backend, streaming the generated XLSX back to the browser. The HttpOnly
 * `tb_session` cookie is forwarded server-side — the client never sees a
 * token. Serves both the Cari and Bakiyem "Dışa Aktar" buttons.
 */
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
    if (key === "type" && !ALLOWED_TYPE_VALUES.has(value)) continue;
    params.set(key, value);
  }

  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/me/cari-balance/statement/export?${qs}`
    : `${API_BASE}/api/me/cari-balance/statement/export`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
        accept: XLSX_MIME,
      },
      cache: "no-store",
    });
  } catch (err) {
    console.warn(
      `[cari-statement-export] upstream fetch failed: ${
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
      `[cari-statement-export] upstream non-OK status=${upstream.status} message=${
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
  headers.set("Content-Type", XLSX_MIME);
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers.set("Content-Disposition", disposition);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    headers.set(
      "Content-Disposition",
      `attachment; filename="cari-hesap-ekstresi-${today}.xlsx"`,
    );
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Length", String(arrayBuffer.byteLength));

  return new NextResponse(arrayBuffer, { status: 200, headers });
}

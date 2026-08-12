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
  "page",
  "pageSize",
  "type",
  "status",
  "from",
  "to",
]);

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
    const value = incoming.get(key);
    if (value && value.trim() !== "") {
      params.set(key, value);
    }
  }

  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/me/cari-balance/ledger?${qs}`
    : `${API_BASE}/api/me/cari-balance/ledger`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.warn(
      `[cari-ledger-proxy] upstream fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      { success: false, error: "Sunucuya ulaşılamadı" },
      { status: 502 },
    );
  }

  const body = await upstream.text();
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/json",
  );
  headers.set("Cache-Control", "no-store");

  return new NextResponse(body, {
    status: upstream.status,
    headers,
  });
}

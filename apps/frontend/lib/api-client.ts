const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface TopupInput {
  amount: number;
  bankAccountId?: string;
  customerNote?: string;
}

export interface CreateTopupResult {
  success: boolean;
  error?: string;
  humanTopupNo?: string | null;
}

export async function createTopup(input: TopupInput): Promise<CreateTopupResult> {
  const res = await fetch(`${API_BASE}/api/me/cari-balance/topups`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    let message = "İşlem başarısız oldu.";
    try {
      const body = await res.json() as { message?: string };
      if (typeof body.message === "string") message = body.message;
    } catch {
      // ignore
    }
    return { success: false, error: message };
  }

  let humanTopupNo: string | null = null;
  try {
    const body = (await res.json()) as {
      humanTopupNo?: string | null;
      data?: { humanTopupNo?: string | null };
    };
    humanTopupNo = body.humanTopupNo ?? body.data?.humanTopupNo ?? null;
  } catch {
    // body parse fails are non-fatal; talep already created server-side
  }

  return { success: true, humanTopupNo };
}

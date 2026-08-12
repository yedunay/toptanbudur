import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfitTier, ProfitRateType } from "../lib/suppliers";

// ──────────────────────────────────────────────────────────────────────────
//  Fiyata Göre Kademeli Kâr editörü (ortak bileşen).
//  Hem tedarikçi formunda hem kategori modalında kullanılır. Baremler ürünün
//  ALIŞ maliyetine (costPrice) göre seçilir. Aralık [Alt, Üst): alt limit otomatik
//  bir önceki üst limitten türer; son baremin üst limiti ∞.
// ──────────────────────────────────────────────────────────────────────────

interface EditableRow {
  upper: string; // üst limit (son satırda yok sayılır = ∞)
  rateType: ProfitRateType;
  rate: string;
  extraCosts: string[];
}

const num = (s: string): number => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function rowsToTiers(rows: EditableRow[]): ProfitTier[] {
  return rows.map((r, i) => ({
    min: i === 0 ? 0 : num(rows[i - 1].upper),
    max: i === rows.length - 1 ? null : num(r.upper),
    rateType: r.rateType,
    rate: num(r.rate),
    extraCosts: r.extraCosts
      .map((x) => num(x))
      .filter((x) => Number.isFinite(x) && x > 0),
  }));
}

function tiersToRows(tiers: ProfitTier[]): EditableRow[] {
  if (!tiers.length) {
    return [{ upper: "", rateType: "percent", rate: "20", extraCosts: [] }];
  }
  return tiers.map((t) => ({
    upper: t.max == null ? "" : String(t.max),
    rateType: t.rateType,
    rate: String(t.rate),
    extraCosts: (t.extraCosts ?? []).map((x) => String(x)),
  }));
}

interface KademeliKarEditorProps {
  initialTiers: ProfitTier[];
  onChange: (tiers: ProfitTier[]) => void;
  disabled?: boolean;
}

export default function KademeliKarEditor({
  initialTiers,
  onChange,
  disabled = false,
}: KademeliKarEditorProps): React.ReactElement {
  const [rows, setRows] = useState<EditableRow[]>(() => tiersToRows(initialTiers));

  // Mount'ta görünen baremleri parent'a YANSIT: initialTiers boşken editör tek
  // bir varsayılan ∞ barem (0→∞, %20) gösteriyor; kullanıcı hiç dokunmadan
  // Kaydet'e basarsa parent state [] kalmasın (backend boş diziyi reddediyor).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(rowsToTiers(rows));
    // yalnız mount'ta bir kez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: EditableRow[]): void => {
    setRows(next);
    onChange(rowsToTiers(next));
  };

  const setRow = (i: number, patch: Partial<EditableRow>): void => {
    update(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = (): void => {
    // Yeni barem ∞ satırdan ÖNCE eklenir; ∞ satır en altta kalır.
    const last = rows[rows.length - 1];
    const newRow: EditableRow = {
      upper: "",
      rateType: last?.rateType ?? "percent",
      rate: last?.rate ?? "20",
      extraCosts: [],
    };
    update([...rows.slice(0, -1), newRow, last]);
  };

  const removeRow = (i: number): void => {
    if (rows.length <= 1) return;
    update(rows.filter((_, idx) => idx !== i));
  };

  const addExtra = (i: number): void => {
    setRow(i, { extraCosts: [...rows[i].extraCosts, ""] });
  };
  const setExtra = (i: number, j: number, val: string): void => {
    setRow(i, {
      extraCosts: rows[i].extraCosts.map((x, idx) => (idx === j ? val : x)),
    });
  };
  const removeExtra = (i: number, j: number): void => {
    setRow(i, { extraCosts: rows[i].extraCosts.filter((_, idx) => idx !== j) });
  };

  // Bitişiklik uyarısı (alt limitler türetildiği için yalnız boş üst limit kontrolü).
  const warning = useMemo(() => {
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].upper.trim() === "" || num(rows[i].upper) <= 0) {
        return `${i + 1}. baremin üst limitini girin.`;
      }
      if (i > 0 && num(rows[i].upper) <= num(rows[i - 1].upper)) {
        return `${i + 1}. baremin üst limiti bir öncekinden büyük olmalı.`;
      }
    }
    return null;
  }, [rows]);

  const cellInput =
    "w-full rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-muted)]";

  return (
    <div className="space-y-3">
      {/* Başlık satırı */}
      <div className="hidden grid-cols-[2rem_1fr_1fr_1.4fr_1.4fr_2rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] sm:grid">
        <span />
        <span>Alt Limit</span>
        <span>Üst Limit</span>
        <span>Kâr Oranı/Tutarı</span>
        <span>Ek Maliyet (Varsa)</span>
        <span className="text-center">Sil</span>
      </div>

      {rows.map((r, i) => {
        const isLast = i === rows.length - 1;
        const lower = i === 0 ? "0" : rows[i - 1].upper || "0";
        return (
          <div
            key={i}
            className="grid grid-cols-1 items-start gap-2 rounded-lg border border-[var(--color-border)] bg-white p-2 sm:grid-cols-[2rem_1fr_1fr_1.4fr_1.4fr_2rem] sm:border-0 sm:bg-transparent sm:p-0"
          >
            <div className="pt-1.5 text-center text-sm font-semibold text-[var(--color-text-muted)]">
              {i + 1}.
            </div>

            {/* Alt limit (otomatik, kilitli) */}
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)] sm:hidden">
                Alt Limit
              </span>
              <input className={cellInput} value={lower} disabled readOnly />
            </label>

            {/* Üst limit */}
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)] sm:hidden">
                Üst Limit
              </span>
              {isLast ? (
                <input className={cellInput} value="∞" disabled readOnly />
              ) : (
                <input
                  className={cellInput}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="örn. 200"
                  value={r.upper}
                  disabled={disabled}
                  onChange={(e) => setRow(i, { upper: e.target.value })}
                />
              )}
            </label>

            {/* Kâr oranı/tutarı (% / TL + değer) */}
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)] sm:hidden">
                Kâr Oranı/Tutarı
              </span>
              <div className="flex gap-1">
                <select
                  className="rounded-md border border-[var(--color-border)] bg-white px-1.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                  value={r.rateType}
                  disabled={disabled}
                  onChange={(e) =>
                    setRow(i, { rateType: e.target.value as ProfitRateType })
                  }
                >
                  <option value="percent">%</option>
                  <option value="amount">TL</option>
                </select>
                <input
                  className={cellInput}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder={r.rateType === "percent" ? "35" : "50"}
                  value={r.rate}
                  disabled={disabled}
                  onChange={(e) => setRow(i, { rate: e.target.value })}
                />
              </div>
            </label>

            {/* Ek maliyet(ler) */}
            <div>
              <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)] sm:hidden">
                Ek Maliyet (Varsa)
              </span>
              <div className="space-y-1">
                {r.extraCosts.map((ec, j) => (
                  <div key={j} className="flex items-center gap-1">
                    <div className="flex flex-1 items-center rounded-full border border-[var(--color-border)] bg-white pl-2 pr-1">
                      <input
                        className="w-full bg-transparent py-1 text-sm focus:outline-none"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="örn. 50"
                        value={ec}
                        disabled={disabled}
                        onChange={(e) => setExtra(i, j, e.target.value)}
                      />
                      <span className="px-1 text-xs text-[var(--color-text-muted)]">
                        TL
                      </span>
                      <button
                        type="button"
                        onClick={() => removeExtra(i, j)}
                        disabled={disabled}
                        aria-label="Ek maliyeti kaldır"
                        className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addExtra(i)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-blue)] hover:underline disabled:opacity-60"
                >
                  <span className="text-base leading-none">＋</span> Ekle
                </button>
              </div>
            </div>

            {/* Sil — ilk satır (0 çapası) silinemez */}
            <div className="flex justify-center pt-1">
              {i === 0 ? null : (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={disabled}
                  aria-label="Baremi sil"
                  className="rounded-md p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-60"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="w-full rounded-lg border border-dashed border-[var(--color-border)] bg-white py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
      >
        ＋ Satır Ekle
      </button>

      {warning ? (
        <p className="text-xs font-medium text-amber-600">{warning}</p>
      ) : (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Baremler ürünün <strong>alış maliyetine</strong> göre seçilir. Alt
          limitler otomatik hesaplanır; ilk barem 0'dan, son barem ∞'a kadar.
        </p>
      )}
    </div>
  );
}

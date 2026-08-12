"use client";

import { useCallback, useState, type ComponentType, type DragEvent } from "react";
import {
  FileUp,
  Info,
  PackageCheck,
  ShieldCheck,
  UploadCloud,
  User,
  X,
} from "lucide-react";

interface OrderDocumentsPanelProps {
  cargoBarcode: string;
  onBarcodeChange: (v: string) => void;
  /** Müşteri ismi — Bayi'nin KENDİ son müşterisinin adı (sipariş başına farklı). */
  endCustomerName: string;
  onEndCustomerNameChange: (v: string) => void;
  pdfFile: File | null;
  pdfUploading: boolean;
  pdfUrl: string | null;
  pdfError: string | null;
  onPdfPick: (file: File | null) => void;
  onPdfClear: () => void;
  requiresPdf: boolean;
  orderNote: string;
  onNoteChange: (v: string) => void;
}

export function OrderDocumentsPanel({
  cargoBarcode,
  onBarcodeChange,
  endCustomerName,
  onEndCustomerNameChange,
  pdfFile,
  pdfUploading,
  pdfUrl,
  pdfError,
  onPdfPick,
  onPdfClear,
  requiresPdf,
  orderNote,
  onNoteChange,
}: OrderDocumentsPanelProps) {
  const [isDragging, setIsDragging] = useState(false);

  const pickPdfFromFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = Array.from(files).find(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf"),
      );
      onPdfPick(file ?? null);
    },
    [onPdfPick],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      pickPdfFromFiles(e.dataTransfer?.files ?? null);
    },
    [pickPdfFromFiles],
  );

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-black text-[var(--text)]">
        Sipariş Evrakları ve Barkod
      </h2>

      {/* Müşteri ismi — kargo barkodunun hemen üstünde. Bayi'nin KENDİ son
          müşterisinin adı; her siparişte farklı olabilir. */}
      <label className="mb-4 block">
        <span className="mb-2 flex items-center gap-2 text-sm font-black text-[var(--text)]">
          Müşteri İsmi{" "}
          <span className="font-semibold text-red-600">(Zorunlu)</span>
          <Info className="h-4 w-4 text-[var(--text-muted)]" />
        </span>

        <div className="relative">
          <input
            required
            value={endCustomerName}
            onChange={(e) =>
              onEndCustomerNameChange(e.target.value.slice(0, 200))
            }
            placeholder="Siparişi ulaştıracağınız müşterinizin adı"
            className="h-12 w-full rounded-xl border border-[var(--border)] bg-white px-4 pr-11 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--brand-blue)]"
          />
          <User className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]" />
        </div>

        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          Siparişi ulaştıracağınız müşterinizin adını girin — sipariş
          kayıtlarınızda görünür.
        </p>
      </label>

      <div
        className={`grid gap-4 ${requiresPdf ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}
      >
        {/* Kargo barkod — zorunlu */}
        <label>
          <span className="mb-2 flex items-center gap-2 text-sm font-black text-[var(--text)]">
            Kargo Barkodu / Takip No{" "}
            <span className="font-semibold text-red-600">(Zorunlu)</span>
            <Info className="h-4 w-4 text-[var(--text-muted)]" />
          </span>

          <div className="relative">
            <input
              required
              aria-required="true"
              value={cargoBarcode}
              onChange={(e) => onBarcodeChange(e.target.value)}
              placeholder="Barkod numarasını girin veya yapıştırın"
              className="h-12 w-full rounded-xl border border-[var(--border)] bg-white px-4 pr-11 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--brand-blue)]"
            />
            <PackageCheck className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>

          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            Etiket ve takip süreci için kargo barkodu / takip numarası
            zorunludur.
          </p>
        </label>

        {/* PDF yükleme — YALNIZCA zorunlu olduğunda render edilir (iade satışı
            kalemi veya PDF zorunlu tedarikçi). Zorunlu değilse hiç görünmez;
            opsiyonel olarak sunulmaz. */}
        {requiresPdf && (
        <div>
          <span className="mb-2 block text-sm font-black text-[var(--text)]">
            Sipariş PDF Yükle{" "}
            <span className="font-semibold text-red-600">(Zorunlu)</span>
          </span>

          {pdfFile && pdfUrl ? (
            <div className="flex h-[98px] items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-green-700">
                  {pdfFile.name}
                </p>
                <p className="text-xs text-green-600">Yüklendi</p>
              </div>
              <button
                type="button"
                onClick={onPdfClear}
                className="ml-2 rounded-full p-1 text-green-700 hover:bg-green-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : pdfUploading ? (
            <div className="flex h-[98px] items-center justify-center rounded-xl border border-blue-200 bg-blue-50">
              <p className="text-sm font-black text-[var(--brand-blue)]">
                Yükleniyor...
              </p>
            </div>
          ) : (
            <label
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                "flex h-[98px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed text-center transition",
                isDragging
                  ? "border-[var(--brand-blue)] bg-blue-100"
                  : "border-blue-300 bg-blue-50/40 hover:bg-blue-50",
              ].join(" ")}
            >
              <UploadCloud className="mb-2 h-7 w-7 text-[var(--brand-blue)]" />
              <span className="text-sm font-black text-[var(--brand-blue)]">
                {isDragging
                  ? "PDF'i buraya bırakın"
                  : "PDF dosyasını sürükleyin veya seçin"}
              </span>
              <span className="mt-1 text-xs text-[var(--text-muted)]">
                Maks. 10 MB
              </span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  pickPdfFromFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {pdfError ? (
            <p className="mt-2 text-xs font-semibold text-red-600">
              {pdfError}
            </p>
          ) : null}
        </div>
        )}

        {/* Sipariş notu */}
        <label>
          <span className="mb-2 block text-sm font-black text-[var(--text)]">
            Sipariş Notu{" "}
            <span className="font-semibold text-[var(--text-muted)]">
              (Opsiyonel)
            </span>
          </span>

          <textarea
            value={orderNote}
            onChange={(e) => onNoteChange(e.target.value.slice(0, 200))}
            placeholder="Siparişe özel notunuzu yazabilirsiniz..."
            rows={4}
            className="h-[98px] w-full resize-none rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--brand-blue)]"
          />

          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {orderNote.length}/200 karakter
          </p>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MiniInfo label="Logo kartları yanlış seçimi azaltır" icon={ShieldCheck} />
        <MiniInfo label="Toplu işlem desteği" icon={FileUp} />
        <MiniInfo label="Hızlı sipariş akışı" icon={PackageCheck} />
        <MiniInfo label="Operasyon dostu tasarım" icon={ShieldCheck} />
      </div>
    </section>
  );
}

function MiniInfo({
  label,
  icon: Icon,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs font-black text-slate-600">
      <Icon className="h-4 w-4 text-[var(--brand-blue)]" />
      {label}
    </div>
  );
}

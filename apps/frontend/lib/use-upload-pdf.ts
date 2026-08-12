"use client";

import { useState, useCallback, useRef } from "react";
import { ApiError, apiCustomer } from "@/lib/auth";

const PDF_MAX_BYTES = 10 * 1024 * 1024;

const PDF_ERROR_MESSAGES: Record<string, string> = {
  PDF_UPLOAD_INVALID: "Dosya bilgisi eksik gönderildi.",
  PDF_UPLOAD_INVALID_BASE64: "Dosya bozuk görünüyor, lütfen yeniden deneyin.",
  PDF_UPLOAD_SIZE: "Dosya boyutu 10 MB sınırını aşıyor.",
  PDF_UPLOAD_NOT_PDF: "Geçerli bir PDF dosyası seçin.",
};

export function useUploadPdf() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfKey, setPdfKey] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handlePdfPick = useCallback(async (file: File | null) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setPdfError(null);
    setPdfFile(file);
    setPdfUrl(null);
    setPdfKey(null);
    if (!file) return;
    if (file.type && file.type !== "application/pdf") {
      setPdfError("Yalnızca PDF dosyaları yüklenebilir.");
      return;
    }
    if (file.size > PDF_MAX_BYTES) {
      setPdfError("PDF boyutu en fazla 10 MB olabilir.");
      return;
    }
    setPdfUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 5));
      const isPdf =
        head[0] === 0x25 &&
        head[1] === 0x50 &&
        head[2] === 0x44 &&
        head[3] === 0x46 &&
        head[4] === 0x2d;
      if (!isPdf) {
        setPdfError("Geçerli bir PDF dosyası seçin.");
        setPdfUploading(false);
        return;
      }
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunk)),
        );
      }
      const contentBase64 = btoa(binary);
      try {
        const data = await apiCustomer<{ pdfUrl?: string; key?: string }>(
          "/orders/upload-pdf",
          {
            method: "POST",
            general: true,
            signal,
            body: JSON.stringify({ filename: file.name, contentBase64 }),
          },
        );
        if (!data?.pdfUrl) {
          setPdfError("PDF yüklenemedi. Lütfen tekrar deneyin.");
          setPdfUploading(false);
          return;
        }
        setPdfUrl(data.pdfUrl);
        setPdfKey(data.key ?? null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (err instanceof ApiError) {
          const mapped = err.code ? PDF_ERROR_MESSAGES[err.code] : undefined;
          setPdfError(
            mapped ?? err.message ?? "PDF yüklenemedi. Lütfen tekrar deneyin.",
          );
        } else {
          setPdfError(
            "PDF yüklenirken ağ hatası oluştu. Bağlantınızı kontrol edin.",
          );
        }
        setPdfUploading(false);
        return;
      }
    } catch {
      setPdfError("PDF yüklenirken ağ hatası oluştu. Bağlantınızı kontrol edin.");
    } finally {
      setPdfUploading(false);
    }
  }, []);

  const clearPdf = useCallback(() => {
    setPdfFile(null);
    setPdfUrl(null);
    setPdfKey(null);
    setPdfError(null);
  }, []);

  return {
    pdfFile,
    pdfUploading,
    pdfUrl,
    pdfKey,
    pdfError,
    handlePdfPick,
    clearPdf,
    setPdfUrl,
    setPdfKey,
  };
}

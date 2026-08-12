import { useEffect, useRef, useState } from "react";
import {
  MANUAL_MAX_IMAGES,
  MANUAL_MAX_IMAGE_BYTES,
} from "../lib/products";

interface ImageUploadDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

interface FilePreview {
  file: File;
  url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return `"${file.name}" bir görsel dosya değil.`;
  }
  if (file.size > MANUAL_MAX_IMAGE_BYTES) {
    return `"${file.name}" 5MB sınırını aşıyor (${formatBytes(file.size)}).`;
  }
  return null;
}

export default function ImageUploadDropzone({
  files,
  onChange,
  disabled = false,
}: ImageUploadDropzoneProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<FilePreview[]>([]);

  // Önizleme URL'leri component yaşam döngüsüne bağlı; her dosya seti değiştiğinde
  // eski URL'leri revoke ediyoruz ki bellek sızıntısı olmasın.
  useEffect(() => {
    const next: FilePreview[] = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviews(next);
    return () => {
      for (const p of next) URL.revokeObjectURL(p.url);
    };
  }, [files]);

  const addFiles = (incoming: File[]): void => {
    if (disabled) return;
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of incoming) {
      const err = validateFile(f);
      if (err) {
        errors.push(err);
        continue;
      }
      valid.push(f);
    }
    const merged = [...files, ...valid];
    if (merged.length > MANUAL_MAX_IMAGES) {
      errors.push(
        `En fazla ${MANUAL_MAX_IMAGES} görsel yükleyebilirsiniz. (${merged.length - MANUAL_MAX_IMAGES} fazla)`,
      );
      onChange(merged.slice(0, MANUAL_MAX_IMAGES));
    } else {
      onChange(merged);
    }
    setLocalError(errors.length > 0 ? errors.join(" ") : null);
  };

  const removeAt = (index: number): void => {
    if (disabled) return;
    onChange(files.filter((_, i) => i !== index));
    setLocalError(null);
  };

  const moveLeft = (index: number): void => {
    if (disabled || index === 0) return;
    const next = [...files];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveRight = (index: number): void => {
    if (disabled || index === files.length - 1) return;
    const next = [...files];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) addFiles(dropped);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    addFiles(Array.from(list));
    // Aynı dosyayı tekrar seçebilmek için input'u sıfırlıyoruz.
    e.target.value = "";
  };

  const remaining = MANUAL_MAX_IMAGES - files.length;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition cursor-pointer ${
          dragging
            ? "border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5"
            : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-disabled={disabled}
      >
        <svg
          className="h-8 w-8 text-[var(--color-text-muted)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18v-1.5M16.5 12L12 7.5m0 0L7.5 12M12 7.5V18"
          />
        </svg>
        <p className="mt-2 text-sm text-[var(--color-text)]">
          Görselleri buraya sürükleyin veya{" "}
          <span className="text-[var(--color-brand-blue)] underline">
            seçmek için tıklayın
          </span>
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          En fazla {MANUAL_MAX_IMAGES} görsel · her dosya en fazla 5 MB · JPG/PNG/WebP
        </p>
        <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
          {files.length}/{MANUAL_MAX_IMAGES} yüklendi · {remaining > 0 ? `${remaining} daha eklenebilir` : "limit doldu"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </div>

      {localError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {localError}
        </div>
      ) : null}

      {previews.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {previews.map((p, i) => (
            <li
              key={`${p.file.name}-${i}`}
              className="relative group rounded-md border border-[var(--color-border)] overflow-hidden bg-white"
            >
              <img
                src={p.url}
                alt={`Önizleme ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                <span>#{i + 1}</span>
                <span className="truncate">{formatBytes(p.file.size)}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/40 px-1 py-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLeft(i);
                  }}
                  disabled={disabled || i === 0}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-white/90 text-black disabled:opacity-30"
                  aria-label="Sola taşı"
                  title="Sola taşı"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  disabled={disabled}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-red-600 text-white"
                  aria-label="Görseli kaldır"
                  title="Kaldır"
                >
                  Sil
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveRight(i);
                  }}
                  disabled={disabled || i === files.length - 1}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-white/90 text-black disabled:opacity-30"
                  aria-label="Sağa taşı"
                  title="Sağa taşı"
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

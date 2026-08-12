"use client";

import { useEffect, useState } from "react";
import { ProductImage } from "@/components/ProductImage";

export function ProductGallery({
  images,
  alt,
}: {
  images: string[];
  alt: string;
}) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") setActive((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setActive((i) => (i - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, images.length]);

  if (images.length === 0) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-sm text-[var(--text-muted)]">
        Görsel yok
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-white cursor-zoom-in"
          aria-label="Görseli büyüt"
        >
          <ProductImage
            src={images[active]}
            alt={alt}
            fill
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="object-contain p-4 transition-transform duration-300 hover:scale-105"
            unoptimized
            priority
          />
        </button>
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {images.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setActive(i)}
                className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-white transition ${
                  i === active
                    ? "border-[var(--brand-blue)] ring-2 ring-[var(--brand-blue)]/30"
                    : "border-[var(--border)] hover:border-[var(--brand-blue)]"
                }`}
                aria-label={`Görsel ${i + 1}`}
              >
                <ProductImage
                  src={src}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-contain p-1"
                  unoptimized
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Görsel büyütülmüş"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(false);
            }}
            className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Kapat"
          >
            ✕
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i - 1 + images.length) % images.length);
                }}
                className="absolute left-4 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white text-2xl hover:bg-white/20"
                aria-label="Önceki görsel"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i + 1) % images.length);
                }}
                className="absolute right-4 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white text-2xl hover:bg-white/20"
                aria-label="Sonraki görsel"
              >
                ›
              </button>
            </>
          )}
          <div
            className="relative h-[90vh] w-[90vw] max-w-6xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ProductImage
              src={images[active]}
              alt={alt}
              fill
              sizes="90vw"
              className="object-contain"
              unoptimized
              priority
            />
          </div>
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white">
              {active + 1} / {images.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}

"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

const PLACEHOLDER_SRC = "/placeholder-product.svg";

type ProductImageProps = Omit<ImageProps, "src" | "onError"> & {
  src: string | null | undefined;
};

function resolveSrc(src: string | null | undefined): string {
  return src && src.length > 0 ? src : PLACEHOLDER_SRC;
}

export function ProductImage({ src, alt, ...rest }: ProductImageProps) {
  // Sync local state with the incoming `src` prop so that when a parent
  // list re-renders with a different product the image actually updates.
  // (Previously useState(initial) only ran once, which made cards stuck
  // on the first src they ever received and caused "all products show
  // the same image" after route changes / login state flips.)
  const [currentSrc, setCurrentSrc] = useState<string>(() => resolveSrc(src));

  useEffect(() => {
    setCurrentSrc(resolveSrc(src));
  }, [src]);

  return (
    <Image
      {...rest}
      src={currentSrc}
      alt={alt}
      onError={() => {
        if (currentSrc !== PLACEHOLDER_SRC) setCurrentSrc(PLACEHOLDER_SRC);
      }}
    />
  );
}

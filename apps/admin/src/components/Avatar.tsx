import { useEffect, useState } from "react";

type AvatarSize = "xs" | "sm" | "md" | "lg";

interface AvatarProps {
  src: string | null | undefined;
  name?: string | null;
  email?: string | null;
  size?: AvatarSize;
  className?: string;
  alt?: string;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 28,
  sm: 36,
  md: 48,
  lg: 96,
};

const TEXT_CLASS: Record<AvatarSize, string> = {
  xs: "text-[11px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-2xl",
};

const PALETTE: ReadonlyArray<string> = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
  "bg-teal-500",
  "bg-orange-500",
];

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name ?? "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const e = (email ?? "").trim();
  if (e) return e.slice(0, 2).toUpperCase();
  return "??";
}

function getColorClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export default function Avatar({
  src,
  name,
  email,
  size = "sm",
  className = "",
  alt,
}: AvatarProps): React.ReactElement {
  const px = SIZE_PX[size];
  const initials = getInitials(name, email);
  const seed = (email ?? name ?? "?").toLowerCase();
  const colorClass = getColorClass(seed);
  const altText = alt ?? name ?? email ?? "Kullanıcı";

  const baseClass =
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5";
  const style = { width: px, height: px } as const;

  // src 404 ya da yüklenememe durumunda baş harf fallback'ine düş. Yeni src
  // gelirse error durumunu resetle ki tekrar denesin.
  const [imgError, setImgError] = useState<boolean>(false);
  useEffect(() => {
    setImgError(false);
  }, [src]);

  if (src && !imgError) {
    return (
      <span
        className={`${baseClass} bg-[var(--color-surface-muted)] ${className}`}
        style={style}
      >
        <img
          src={src}
          alt={altText}
          width={px}
          height={px}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`${baseClass} ${colorClass} font-semibold text-white ${TEXT_CLASS[size]} ${className}`}
      style={style}
      aria-label={altText}
      title={altText}
    >
      {initials}
    </span>
  );
}

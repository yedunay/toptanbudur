import Image from "next/image";

// Üçlü şerit (Visa + American Express + Mastercard) tek PNG'dir (175×34,
// kart başına 55×34). Troy ayrı ve çerçevesiz bir logo olduğundan şeritteki
// kartlarla aynı oranda (55:34) beyaz bir kart zeminine oturtulur — dördü
// tek sırada eşit boyutlu "4 kart" gibi okunur.
const STRIP_RATIO = 175 / 34;
const CARD_RATIO = 55 / 34;
const TROY_HEIGHT_RATIO = 0.56;

interface PaymentLogosProps {
  /** Kart sırasının yüksekliği (px) — tüm genişlikler bundan türetilir. */
  height?: number;
  className?: string;
}

export function PaymentLogos({ height = 28, className }: PaymentLogosProps) {
  return (
    <div
      className={["flex items-center gap-1", className]
        .filter(Boolean)
        .join(" ")}
      aria-label="Kabul edilen kartlar: Visa, American Express, Mastercard, Troy"
    >
      <Image
        src="/payment/mastercard.png"
        alt="Visa, American Express ve Mastercard"
        width={175}
        height={34}
        style={{ width: Math.round(height * STRIP_RATIO), height }}
      />
      <span
        className="flex items-center justify-center rounded border border-[var(--border)] bg-white"
        style={{ width: Math.round(height * CARD_RATIO), height }}
      >
        <Image
          src="/payment/Troy_logo.png"
          alt="Troy"
          width={300}
          height={138}
          style={{
            height: Math.round(height * TROY_HEIGHT_RATIO),
            width: "auto",
          }}
        />
      </span>
    </div>
  );
}

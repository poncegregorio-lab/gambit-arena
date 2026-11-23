import type { Color, PieceType } from "@/lib/chess";

export function PieceIcon({
  type,
  color,
  size = 40,
  className = "",
}: {
  type: PieceType;
  color: Color;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/pieces/${color}${type.toUpperCase()}.svg`}
      alt={`${color === "w" ? "White" : "Black"} ${type}`}
      width={size}
      height={size}
      draggable={false}
      className={`select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

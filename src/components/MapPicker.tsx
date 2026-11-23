"use client";

import { MAPS, getMapDef, type MapDef } from "@/lib/fight/maps";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Top-down schematic of an arena, drawn from the same data the physics uses. */
export function MapPreview({ map, className = "" }: { map: MapDef; className?: string }) {
  const { halfX: hx, halfZ: hz, theme: th } = map;
  const pad = 1.5;
  return (
    <svg
      viewBox={`${-hx - pad} ${-hz - pad} ${hx * 2 + pad * 2} ${hz * 2 + pad * 2}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <rect x={-hx} y={-hz} width={hx * 2} height={hz * 2} rx={1.5} fill={th.preview.floor} stroke={hex(th.trim)} strokeWidth={1.2} />
      {map.boxes.map((b, i) => {
        const fill = b.k === "deck" || b.k === "stair" ? th.preview.deck : b.h > 2 ? th.preview.tall : th.preview.low;
        return (
          <rect
            key={i}
            x={b.x - b.hx}
            y={b.z - b.hz}
            width={b.hx * 2}
            height={b.hz * 2}
            fill={fill}
            opacity={b.k === "stair" ? 0.6 : 0.96}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.25}
          />
        );
      })}
      <circle cx={map.spawns.a.x} cy={map.spawns.a.z} r={2.6} fill="#38bdf8" stroke="#fff" strokeWidth={0.5} />
      <circle cx={map.spawns.d.x} cy={map.spawns.d.z} r={2.6} fill="#f59e0b" stroke="#fff" strokeWidth={0.5} />
    </svg>
  );
}

export function MapPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selected = value === "random" ? null : getMapDef(value);
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-50">
      <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#aeb6c8]">
        <span aria-hidden>🗺</span> Capture fight arena
      </legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="Capture fight arena">
        <button
          type="button"
          aria-pressed={value === "random"}
          onClick={() => onChange("random")}
          className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-semibold transition ${
            value === "random" ? "border-amber-300/70 bg-amber-300/10 text-white" : "border-white/10 bg-white/[0.03] text-[#8d96ab] hover:border-white/25 hover:text-white"
          }`}
        >
          <span className="grid aspect-square w-full place-items-center rounded-lg bg-white/[0.05] text-2xl">🎲</span>
          <span className="truncate">Random</span>
        </button>
        {MAPS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={value === m.id}
            onClick={() => onChange(m.id)}
            title={m.name}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-semibold transition ${
              value === m.id ? "border-amber-300/70 bg-amber-300/10 text-white" : "border-white/10 bg-white/[0.03] text-[#8d96ab] hover:border-white/25 hover:text-white"
            }`}
          >
            <span className="block aspect-square w-full overflow-hidden rounded-lg bg-black/30 p-1">
              <MapPreview map={m} className="h-full w-full" />
            </span>
            <span className="w-full truncate">{m.name}</span>
          </button>
        ))}
      </div>
      <p className="min-h-8 text-xs leading-snug text-[#8d96ab]">
        {selected
          ? `${selected.name} · ${selected.halfX * 2}×${selected.halfZ * 2} m — ${selected.tagline}`
          : "A different arena is picked at random for every capture."}
      </p>
    </fieldset>
  );
}

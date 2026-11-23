"use client";

import { useState } from "react";
import { PIECE_NAMES, type Color, type PieceType } from "@/lib/chess";
import { PIECES, PIECE_ORDER } from "@/lib/fight/weapons";
import { ModelViewer } from "./ModelViewer";
import { PieceIcon } from "./PieceIcon";

export function Armory() {
  const [piece, setPiece] = useState<PieceType>("k");
  const [color, setColor] = useState<Color>("w");
  const [view, setView] = useState<"piece" | "weapon">("piece");
  const d = PIECES[piece];
  const weaponName = view === "weapon" ? d.primary.name : d.name;
  return (
    <section className="card mt-8 overflow-hidden">
      <div className="grid md:grid-cols-[1.25fr_1fr]">
        <div className="relative h-[360px] bg-[radial-gradient(ellipse_at_50%_40%,rgba(90,120,200,0.18),transparent_70%)] md:h-[440px]">
          <ModelViewer key={`${piece}-${color}-${view}`} piece={piece} color={color} view={view} />
          <div className="pointer-events-none absolute left-4 top-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f788d]">Armory · drag to rotate</div>
          <div className="pointer-events-none absolute bottom-3 left-4 text-lg font-semibold text-white drop-shadow">{weaponName}</div>
        </div>
        <div className="space-y-4 border-t border-white/[0.06] p-5 md:border-l md:border-t-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Meet the pieces</h2>
            <p className="mt-1 text-[13px] text-[#8d96ab]">Every piece and weapon is modelled in 3D. Pick one to inspect it up close.</p>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {PIECE_ORDER.map((p) => (
              <button
                key={p}
                type="button"
                title={PIECE_NAMES[p]}
                aria-pressed={piece === p}
                onClick={() => setPiece(p)}
                className={`grid h-12 place-items-center rounded-xl transition ${piece === p ? "bg-amber-400/20 ring-1 ring-amber-300/60" : "bg-white/[0.05] hover:bg-white/10"}`}
              >
                <PieceIcon type={p} color={color} size={34} />
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex rounded-xl bg-white/[0.05] p-1" role="group" aria-label="View">
              {(["piece", "weapon"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`flex-1 rounded-lg px-2 py-1.5 font-semibold capitalize transition ${view === v ? "bg-white/15 text-white" : "text-[#8d96ab] hover:text-white"}`}>
                  {v}
                </button>
              ))}
            </div>
            <div className="flex rounded-xl bg-white/[0.05] p-1" role="group" aria-label="Side">
              {(["w", "b"] as const).map((c) => (
                <button key={c} type="button" aria-pressed={color === c} onClick={() => setColor(c)} className={`flex-1 rounded-lg px-2 py-1.5 font-semibold transition ${color === c ? "bg-white/15 text-white" : "text-[#8d96ab] hover:text-white"}`}>
                  {c === "w" ? "White" : "Black"}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3 text-[13px] leading-snug text-[#9aa3b8]">
            <div className="font-semibold text-white">
              {d.name} <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: d.accent }}>{d.title}</span>
            </div>
            <div className="mt-1">{d.primary.name}{d.secondary ? ` · ${d.secondary.name}` : ""}</div>
            <div className="mt-0.5">E {d.abilities[0].name} · Q {d.abilities[1].name}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

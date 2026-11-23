"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fenToPieces, type BoardPiece, type Color, type LegalMove, type PieceType, type Square } from "@/lib/chess";
import { initAudio, sfx } from "@/lib/fight/sfx";
import { PieceIcon } from "./PieceIcon";

interface BoardProps {
  fen: string;
  orientation: Color;
  legalMoves: LegalMove[];
  interactive: boolean;
  lastMove: { from: Square; to: Square } | null;
  checks: Square[];
  onMove: (m: LegalMove) => void;
}

interface Token {
  id: number;
  type: PieceType;
  color: Color;
  sq: Square;
  ghost?: boolean;
  ghostAt?: number;
  fresh?: boolean;
}

const FILES = "abcdefgh";
const sqIndex = (sq: Square) => ({ f: FILES.indexOf(sq[0]), r: Number(sq[1]) });
const dist = (a: Square, b: Square) => {
  const x = sqIndex(a);
  const y = sqIndex(b);
  return Math.hypot(x.f - y.f, x.r - y.r);
};

/**
 * Match pieces between two positions so each piece keeps its identity and can slide to its new square.
 * Handles captures, castling, en passant and promotion without needing the move itself.
 */
function reconcile(prev: Token[], pieces: Partial<Record<Square, BoardPiece>>, nextId: () => number): Token[] {
  const live = prev.filter((t) => !t.ghost);
  const remaining = new Set(live);
  const out: Token[] = [];
  const unmatched: Square[] = [];
  const squares = Object.keys(pieces) as Square[];
  for (const sq of squares) {
    const p = pieces[sq]!;
    let found: Token | undefined;
    for (const t of remaining) {
      if (t.sq === sq && t.type === p.type && t.color === p.color) {
        found = t;
        break;
      }
    }
    if (found) {
      remaining.delete(found);
      out.push({ ...found, fresh: false });
    } else unmatched.push(sq);
  }
  for (const sq of unmatched) {
    const p = pieces[sq]!;
    let best: Token | undefined;
    let bd = Infinity;
    for (const t of remaining) {
      if (t.type === p.type && t.color === p.color) {
        const d = dist(t.sq, sq);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
    }
    if (best) {
      remaining.delete(best);
      out.push({ ...best, sq, fresh: false });
    } else out.push({ id: nextId(), type: p.type, color: p.color, sq, fresh: live.length > 0 });
  }
  const now = Date.now();
  for (const t of remaining) out.push({ ...t, ghost: true, ghostAt: now, fresh: false });
  // Keep recent ghosts so their fade-out can finish.
  for (const t of prev) if (t.ghost && t.ghostAt && now - t.ghostAt < 450) out.push(t);
  return out;
}

export function Board({ fen, orientation, legalMoves, interactive, lastMove, checks, onMove }: BoardProps) {
  const pieces = useMemo(() => fenToPieces(fen), [fen]);
  const boardRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const prevTokens = useRef<Token[]>([]);
  const [cell, setCell] = useState(64);
  const [, force] = useState(0);
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [drag, setDrag] = useState<{ id: number; from: Square; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<Square | null>(null);
  const [instantId, setInstantId] = useState<number | null>(null);
  const [marks, setMarks] = useState<Square[]>([]);
  const [arrows, setArrows] = useState<{ from: Square; to: Square }[]>([]);
  const rightStart = useRef<Square | null>(null);

  const tokens = useMemo(() => {
    const t = reconcile(prevTokens.current, pieces, () => idRef.current++);
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces]);

  useEffect(() => {
    prevTokens.current = tokens;
    if (tokens.some((t) => t.ghost)) {
      const timer = setTimeout(() => {
        prevTokens.current = prevTokens.current.filter((t) => !t.ghost);
        force((n) => n + 1);
      }, 480);
      return () => clearTimeout(timer);
    }
  }, [tokens]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setCell(el.clientWidth / 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSel(null);
    setPromo(null);
    setDrag(null);
    setMarks([]);
    setArrows([]);
  }, [fen]);
  useEffect(() => {
    if (!interactive) {
      setSel(null);
      setDrag(null);
    }
  }, [interactive]);

  const byFrom = useMemo(() => {
    const m = new Map<Square, LegalMove[]>();
    for (const mv of legalMoves) {
      const arr = m.get(mv.from);
      if (arr) arr.push(mv);
      else m.set(mv.from, [mv]);
    }
    return m;
  }, [legalMoves]);

  const activeFrom = drag?.from ?? sel;
  const targets = useMemo(() => {
    const t = new Map<Square, LegalMove>();
    if (activeFrom) for (const mv of byFrom.get(activeFrom) ?? []) t.set(mv.to, mv);
    return t;
  }, [activeFrom, byFrom]);

  const cellOf = (sq: Square) => {
    const { f, r } = sqIndex(sq);
    return { col: orientation === "w" ? f : 7 - f, row: orientation === "w" ? 8 - r : r - 1 };
  };

  function squareAt(clientX: number, clientY: number): Square | null {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const col = Math.floor((x / rect.width) * 8);
    const row = Math.floor((y / rect.height) * 8);
    const f = orientation === "w" ? col : 7 - col;
    const rank = orientation === "w" ? 8 - row : row + 1;
    return `${FILES[f]}${rank}` as Square;
  }

  function relPoint(e: React.PointerEvent) {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function tryMove(from: Square, to: Square, instant: number | null) {
    const ms = (byFrom.get(from) ?? []).filter((m) => m.to === to);
    if (!ms.length) return false;
    if (ms[0].promotion) {
      setPromo({ from, to });
      return true;
    }
    setInstantId(instant);
    setSel(null);
    onMove(ms[0]);
    return true;
  }

  function onPointerDown(e: React.PointerEvent) {
    initAudio();
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      rightStart.current = sq;
      return;
    }
    if (e.button !== 0) return;
    setMarks([]);
    setArrows([]);
    if (!interactive || promo) return;
    if (sel && sel !== sq && (byFrom.get(sel) ?? []).some((m) => m.to === sq)) {
      tryMove(sel, sq, null);
      return;
    }
    if (byFrom.has(sq)) {
      const tok = tokens.find((t) => !t.ghost && t.sq === sq);
      if (!tok) return;
      const p = relPoint(e);
      setSel(sq);
      setInstantId(null);
      setDrag({ id: tok.id, from: sq, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false });
      try {
        boardRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      sfx("select");
    } else if (sel) {
      setSel(null);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = relPoint(e);
    setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5 });
    const sq = squareAt(e.clientX, e.clientY);
    setHover(sq && targets.has(sq) ? sq : null);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.button === 2) {
      const from = rightStart.current;
      rightStart.current = null;
      const to = squareAt(e.clientX, e.clientY);
      if (!from || !to) return;
      if (from === to) setMarks((m) => (m.includes(to) ? m.filter((s) => s !== to) : [...m, to]));
      else
        setArrows((a) =>
          a.some((x) => x.from === from && x.to === to) ? a.filter((x) => !(x.from === from && x.to === to)) : [...a, { from, to }],
        );
      return;
    }
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setHover(null);
    const sq = squareAt(e.clientX, e.clientY);
    if (d.moved && sq && sq !== d.from) {
      if (!tryMove(d.from, sq, d.id)) sfx("illegal");
    }
  }

  const checkSet = new Set(checks);
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const fi = orientation === "w" ? f : 7 - f;
      const rank = orientation === "w" ? 8 - r : r + 1;
      const sq = `${FILES[fi]}${rank}` as Square;
      const dark = (fi + rank) % 2 === 1;
      const target = targets.get(sq);
      const isSel = activeFrom === sq;
      const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
      const label = dark ? "text-[#dfe6f0]" : "text-[#6c84a6]";
      cells.push(
        <div key={sq} className={`relative ${dark ? "sq-dark" : "sq-light"}`}>
          {isLast && <span className="absolute inset-0 bg-amber-300/40" />}
          {isSel && <span className="absolute inset-0 bg-amber-300/60" />}
          {marks.includes(sq) && <span className="absolute inset-0 bg-rose-500/55" />}
          {checkSet.has(sq) && (
            <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(239,68,68,0.95)_0%,rgba(239,68,68,0.5)_45%,transparent_72%)]" />
          )}
          {hover === sq && <span className="absolute inset-0 ring-[3px] ring-inset ring-white/70" />}
          {f === 0 && <span className={`pointer-events-none absolute left-[3px] top-[2px] text-[10px] font-bold leading-none ${label}`}>{rank}</span>}
          {r === 7 && <span className={`pointer-events-none absolute bottom-[2px] right-[4px] text-[10px] font-bold leading-none ${label}`}>{FILES[fi]}</span>}
          {target && !target.isCapture && (
            <span className="absolute left-1/2 top-1/2 z-[2] h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25" />
          )}
          {target && target.isCapture && (
            <>
              <span className="absolute inset-[3px] z-[2] rounded-full border-[4px] border-rose-600/80" />
              <span
                title="Capturing starts a 3D duel"
                className="absolute right-[2px] top-[2px] z-[3] grid h-[22%] w-[22%] min-h-4 min-w-4 place-items-center rounded-full bg-rose-600 text-[10px] text-white shadow"
              >
                ⚔
              </span>
            </>
          )}
        </div>,
      );
    }
  }

  const moverColor = promo ? (pieces[promo.from]?.color ?? "w") : "w";
  const promoChoices: PieceType[] = ["q", "r", "b", "n"];
  const centre = (sq: Square) => {
    const { col, row } = cellOf(sq);
    return { x: col + 0.5, y: row + 0.5 };
  };

  return (
    <div
      ref={boardRef}
      className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10"
      style={{ cursor: drag ? "grabbing" : interactive ? "pointer" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setHover(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">{cells}</div>

      <svg className="pointer-events-none absolute inset-0 z-[4] h-full w-full" viewBox="0 0 8 8">
        <defs>
          <marker id="arrow-head" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 z" fill="rgba(255,170,0,0.9)" />
          </marker>
        </defs>
        {arrows.map((a, i) => {
          const s = centre(a.from);
          const t = centre(a.to);
          const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
          const ex = t.x - ((t.x - s.x) / len) * 0.32;
          const ey = t.y - ((t.y - s.y) / len) * 0.32;
          return <line key={i} x1={s.x} y1={s.y} x2={ex} y2={ey} stroke="rgba(255,170,0,0.85)" strokeWidth="0.17" strokeLinecap="round" markerEnd="url(#arrow-head)" />;
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0 z-[3]">
        {tokens.map((t) => {
          const { col, row } = cellOf(t.sq);
          const isDrag = drag?.id === t.id;
          const style: React.CSSProperties = {
            position: "absolute",
            left: 0,
            top: 0,
            width: cell,
            height: cell,
            padding: cell * 0.04,
            willChange: "transform",
            zIndex: isDrag ? 30 : t.ghost ? 1 : 2,
            transition: isDrag || instantId === t.id ? "none" : "transform 170ms cubic-bezier(0.22,0.8,0.25,1), opacity 320ms ease, filter 320ms ease",
            transform: isDrag
              ? `translate(${drag!.x - cell / 2}px, ${drag!.y - cell / 2}px) scale(1.14)`
              : `translate(${col * cell}px, ${row * cell}px)${t.ghost ? " scale(0.6)" : ""}`,
            opacity: t.ghost ? 0 : 1,
            filter: t.ghost ? "drop-shadow(0 0 8px rgba(239,68,68,0.9)) saturate(1.8)" : isDrag ? "drop-shadow(0 8px 10px rgba(0,0,0,0.45))" : "drop-shadow(0 2px 2px rgba(0,0,0,0.35))",
          };
          return (
            <div key={t.id} style={style} className={t.fresh ? "piece-pop" : undefined}>
              <PieceIcon type={t.type} color={t.color} size={64} className="h-full w-full" />
            </div>
          );
        })}
      </div>

      {promo && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 backdrop-blur-[2px]">
          <div className="card fade-up p-4 text-center">
            <div className="mb-3 text-sm font-semibold text-white">Promote your pawn</div>
            <div className="flex gap-2">
              {promoChoices.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const mv = legalMoves.find((m) => m.from === promo.from && m.to === promo.to && m.promotion === p);
                    if (mv) onMove(mv);
                    setPromo(null);
                    setSel(null);
                  }}
                  className="grid h-16 w-16 place-items-center rounded-xl bg-white/10 transition hover:bg-white/20"
                >
                  <PieceIcon type={p} color={moverColor} size={52} />
                </button>
              ))}
            </div>
            <button type="button" className="mt-3 text-xs text-[#8d96ab] hover:text-white" onClick={() => setPromo(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

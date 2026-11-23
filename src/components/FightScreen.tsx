"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Color, PieceType } from "@/lib/chess";
import type { FightEngine, HudState, Transport } from "@/lib/fight/engine";
import { getMapDef } from "@/lib/fight/maps";
import type { Role } from "@/lib/fight/room";
import { setMuted } from "@/lib/fight/sfx";
import { PIECES, type AbilityDef } from "@/lib/fight/weapons";
import { DIFFICULTY_LABELS, type Difficulty } from "@/lib/bots/difficulty";
import { MapPreview } from "./MapPicker";
import { PieceGuideCard } from "./PieceGuide";
import { PieceIcon } from "./PieceIcon";

export interface FightScreenProps {
  mode: "online" | "practice" | "bot";
  role: Role;
  myPiece: PieceType;
  oppPiece: PieceType;
  myColor: Color;
  oppColor: Color;
  myName: string;
  oppName: string;
  mapId: string;
  opponentDifficulty?: Difficulty;
  transport: Transport;
  headline: string;
  describe: (winner: Role | undefined, reason?: string) => { title: string; detail: string; good: boolean };
  /** Fired once, as soon as the fight has a winner (before the player dismisses the result card). */
  onResult?: (winner: Role | undefined) => void;
  onExit: () => void;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;

function HpCard({
  piece,
  color,
  name,
  hp,
  max,
  align,
  you,
}: {
  piece: PieceType;
  color: Color;
  name: string;
  hp: number;
  max: number;
  align: "left" | "right";
  you?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, hp / max));
  const bar = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#fbbf24" : "#f87171";
  return (
    <div className={`flex w-[min(34vw,360px)] items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black/50 ring-1 ring-white/15 backdrop-blur">
        <PieceIcon type={piece} color={color} size={38} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex items-baseline gap-2 text-xs ${align === "right" ? "justify-end" : ""}`}>
          <span className="truncate font-semibold text-white">{name}</span>
          <span className="shrink-0 text-white/60">
            {you ? "You · " : ""}
            {PIECES[piece].name}
          </span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/15">
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${pct * 100}%`, background: bar, marginLeft: align === "right" ? "auto" : 0 }}
          />
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-white/70">
          {Math.ceil(hp)} / {max}
        </div>
      </div>
    </div>
  );
}

function Slot({
  keyLabel,
  name,
  sub,
  cd,
  active,
  wide,
  icon,
  ready,
}: {
  keyLabel: string;
  name: string;
  sub?: string;
  cd?: number;
  active?: boolean;
  wide?: boolean;
  icon?: string;
  ready?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-black/55 px-3 py-2 backdrop-blur ${
        active ? "border-amber-300/80" : "border-white/15"
      } ${ready ? "ability-ready" : ""} ${wide ? "min-w-[170px]" : "min-w-[140px]"}`}
    >
      <div className="relative z-[1] flex items-center gap-2">
        <span className="kbd">{keyLabel}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1 truncate text-xs font-semibold text-white">
            {icon && <span className="text-amber-300">{icon}</span>}
            <span className="truncate">{name}</span>
          </div>
          {sub && <div className="text-[11px] tabular-nums text-white/65">{sub}</div>}
        </div>
      </div>
      {cd !== undefined && cd > 0 && <div className="absolute inset-x-0 bottom-0 z-0 bg-white/20" style={{ height: `${cd * 100}%` }} />}
    </div>
  );
}

function abilitySub(ab: AbilityDef, st: { cd: number; active: number } | undefined) {
  if (!st) return "";
  if (st.active > 0) return `${st.active.toFixed(1)}s active`;
  if (st.cd > 0) return `${(st.cd * ab.cooldown).toFixed(1)}s`;
  return "Ready";
}

/** Rotating top-down radar: player is always in the centre, facing up. */
function Radar({ hud, mapId }: { hud: HudState; mapId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const map = getMapDef(mapId);
    const S = c.width;
    const R = S / 2;
    const scale = R / 36;
    const { x: px, z: pz, yaw } = hud.radar;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - px;
      const dz = z - pz;
      return [R + (dx * cos - dz * sin) * scale, R + (dx * sin + dz * cos) * scale];
    };
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(8,12,22,0.78)";
    ctx.fillRect(0, 0, S, S);
    const poly = (pts: [number, number][], fill: string) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    // arena outline
    poly(
      [
        toScreen(-map.halfX, -map.halfZ),
        toScreen(map.halfX, -map.halfZ),
        toScreen(map.halfX, map.halfZ),
        toScreen(-map.halfX, map.halfZ),
      ],
      "rgba(255,255,255,0.07)",
    );
    for (const b of map.boxes) {
      const fill =
        b.k === "stair" ? "rgba(150,170,210,0.35)" : b.k === "deck" ? "rgba(150,170,210,0.55)" : b.h > 2 ? "rgba(190,205,240,0.85)" : "rgba(200,170,110,0.75)";
      poly(
        [toScreen(b.x - b.hx, b.z - b.hz), toScreen(b.x + b.hx, b.z - b.hz), toScreen(b.x + b.hx, b.z + b.hz), toScreen(b.x - b.hx, b.z + b.hz)],
        fill,
      );
    }
    if (hud.radar.showOpp) {
      const [ox, oy] = toScreen(hud.radar.ox, hud.radar.oz);
      ctx.beginPath();
      ctx.arc(ox, oy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    // player arrow
    ctx.beginPath();
    ctx.moveTo(R, R - 8);
    ctx.lineTo(R + 5.5, R + 6);
    ctx.lineTo(R, R + 3);
    ctx.lineTo(R - 5.5, R + 6);
    ctx.closePath();
    ctx.fillStyle = "#38bdf8";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [hud.radar, hud.radar.showOpp, mapId]);
  return <canvas ref={ref} width={156} height={156} className="h-[116px] w-[116px] sm:h-[156px] sm:w-[156px]" />;
}

/** On-screen controls for phones and tablets: a movement stick, look-drag and buttons. */
function TouchLayer({ engine, piece }: { engine: FightEngine | null; piece: PieceType }) {
  const def = PIECES[piece];
  const stick = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [sprint, setSprint] = useState(false);
  const R = 46;

  const hold = (down: () => void, up: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      down();
    },
    onPointerUp: () => up(),
    onPointerCancel: () => up(),
    onPointerLeave: () => up(),
  });

  return (
    <div className="absolute inset-0 z-20 select-none" style={{ touchAction: "none" }}>
      {/* look: drag anywhere that is not a control */}
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          if (look.current || e.target !== e.currentTarget) return;
          look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const l = look.current;
          if (!l || l.id !== e.pointerId) return;
          engine?.look(e.clientX - l.x, e.clientY - l.y);
          l.x = e.clientX;
          l.y = e.clientY;
        }}
        onPointerUp={(e) => {
          if (look.current?.id === e.pointerId) look.current = null;
        }}
        onPointerCancel={() => (look.current = null)}
      />

      {/* movement stick */}
      <div
        ref={stick}
        className="absolute bottom-36 left-5 h-32 w-32 rounded-full border-2 border-white/25 bg-black/35 backdrop-blur"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const r = (stick.current as HTMLElement).getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2);
          const dy = e.clientY - (r.top + r.height / 2);
          const len = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, len / (r.width / 2));
          setKnob({ x: (dx / len) * k * R, y: (dy / len) * k * R });
          engine?.setTouchMove((dx / len) * k, (dy / len) * k);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            const r = (stick.current as HTMLElement).getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2);
            const dy = e.clientY - (r.top + r.height / 2);
            const len = Math.hypot(dx, dy) || 1;
            const k = Math.min(1, len / (r.width / 2));
            setKnob({ x: (dx / len) * k * R, y: (dy / len) * k * R });
            engine?.setTouchMove((dx / len) * k, (dy / len) * k);
          }
        }}
        onPointerUp={() => {
          setKnob({ x: 0, y: 0 });
          engine?.setTouchMove(0, 0);
        }}
        onPointerCancel={() => {
          setKnob({ x: 0, y: 0 });
          engine?.setTouchMove(0, 0);
        }}
      >
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/25"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>

      {/* buttons */}
      <div className="absolute bottom-36 right-4 grid w-[210px] grid-cols-3 gap-2">
        <button
          type="button"
          aria-label="Fire"
          className="col-span-2 row-span-2 h-24 rounded-2xl border-2 border-amber-300/70 bg-amber-400/25 text-sm font-bold text-amber-100 backdrop-blur active:bg-amber-400/50"
          {...hold(
            () => engine?.setTouchFire(true),
            () => engine?.setTouchFire(false),
          )}
        >
          FIRE
        </button>
        <button
          type="button"
          aria-label={def.secondary ? def.secondary.name : "Aim"}
          className="h-11 rounded-xl border border-white/25 bg-white/10 text-[11px] font-semibold text-white/90 backdrop-blur active:bg-white/25"
          {...hold(
            () => engine?.setTouchAlt(true),
            () => engine?.setTouchAlt(false),
          )}
        >
          {def.secondary ? "2ND" : "AIM"}
        </button>
        <button
          type="button"
          aria-label={`Jump`}
          className="h-11 rounded-xl border border-white/25 bg-white/10 text-[11px] font-semibold text-white/90 backdrop-blur active:bg-white/25"
          {...hold(
            () => engine?.setTouchJump(true),
            () => engine?.setTouchJump(false),
          )}
        >
          JUMP
        </button>
        {[0, 1].map((slot) => {
          const ab = def.abilities[slot];
          return (
            <button
              key={ab.id}
              type="button"
              aria-label={ab.name}
              className="h-11 rounded-xl border border-amber-300/40 bg-amber-300/15 text-[11px] font-semibold text-amber-100 backdrop-blur active:bg-amber-300/35"
              onPointerDown={(e) => {
                e.preventDefault();
                engine?.pressAbility(slot as 0 | 1);
              }}
            >
              {ab.key} {ab.name.split(" ")[0]}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Sprint"
          className={`h-11 rounded-xl border text-[11px] font-semibold backdrop-blur ${sprint ? "border-emerald-300/60 bg-emerald-400/25 text-emerald-100" : "border-white/25 bg-white/10 text-white/90"}`}
          onPointerDown={(e) => {
            e.preventDefault();
            const next = !sprint;
            setSprint(next);
            engine?.setTouchSprint(next);
          }}
        >
          SPRINT
        </button>
        <button
          type="button"
          aria-label="Reload"
          className="h-11 rounded-xl border border-white/25 bg-white/10 text-[11px] font-semibold text-white/90 backdrop-blur active:bg-white/25"
          onPointerDown={(e) => {
            e.preventDefault();
            engine?.pressReload();
          }}
        >
          RELOAD
        </button>
      </div>
    </div>
  );
}

export function FightScreen(props: FightScreenProps) {
  const { role, myPiece, oppPiece, myColor, oppColor } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FightEngine | null>(null);
  const transportRef = useRef<Transport>(props.transport);
  const resultSent = useRef(false);
  const onResultRef = useRef(props.onResult);
  const [hud, setHud] = useState<HudState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const myDef = PIECES[myPiece];
  const map = getMapDef(props.mapId);
  const isTouch = useMemo(() => typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || (window.matchMedia?.("(pointer: coarse)").matches ?? false)), []);

  useEffect(() => {
    transportRef.current = props.transport;
    onResultRef.current = props.onResult;
  }, [props.transport, props.onResult]);

  useEffect(() => {
    let disposed = false;
    let engine: FightEngine | null = null;
    (async () => {
      try {
        const mod = await import("@/lib/fight/engine");
        if (disposed || !hostRef.current) return;
        engine = new mod.FightEngine({
          container: hostRef.current,
          role,
          myPiece,
          oppPiece,
          myColor,
          oppColor,
          mapId: props.mapId,
          transport: (r) => transportRef.current(r),
          onHud: setHud,
        });
        engineRef.current = engine;
        engine.start();
      } catch (e) {
        console.error(e);
        if (!disposed) setError("Could not start the 3D arena. Your browser needs WebGL enabled.");
      }
    })();
    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
    };
    // The fight screen is keyed per fight, so these props never change during its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hud?.finished && !resultSent.current) {
      resultSent.current = true;
      onResultRef.current?.(hud.winner);
    }
  }, [hud?.finished, hud?.winner]);

  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const result = hud?.finished ? props.describe(hud.winner, hud.reason) : null;
  const needsClick = !!hud && !hud.inArena && !hud.finished;
  const sec = myDef.secondary;
  const [abE, abQ] = myDef.abilities;
  const buffed = !!hud && hud.abilities.some((a) => a.active > 0);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-black text-white" onContextMenu={(e) => e.preventDefault()}>
      <div ref={hostRef} className="absolute inset-0" />

      {error && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/90 p-6 text-center">
          <div className="card max-w-md p-6">
            <p className="mb-4 text-sm text-[#c3cadb]">{error}</p>
            <button className="btn btn-primary" onClick={props.onExit}>
              Back to board
            </button>
          </div>
        </div>
      )}

      {!hud && !error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#0a0d13] text-sm text-white/70">Loading {map.name}…</div>
      )}

      {hud && (
        <>
          {/* top HUD */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent p-4">
            <HpCard piece={myPiece} color={myColor} name={props.myName} hp={hud.myHp} max={hud.myMax} align="left" you />
            <div className="min-w-0 flex-1 text-center">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/90">{props.headline}</div>
              <div className="mt-0.5 text-3xl font-bold tabular-nums">
                {hud.phase === "live" ? fmt(hud.timeLeft) : hud.phase === "done" || hud.finished ? "Over" : "—:—"}
              </div>
              <div className="line-clamp-2 text-[11px] text-white/60">
                {hud.phase === "waiting" && "Waiting for opponent to enter…"}
                {hud.phase === "countdown" && "Get ready"}
                {hud.phase === "live" &&
                  `${map.name}${props.opponentDifficulty ? ` · ${DIFFICULTY_LABELS[props.opponentDifficulty]} bot` : props.mode === "online" ? ` · ${hud.ping} ms` : ""}`}
              </div>
              {!hud.connected && <div className="mt-1 text-[11px] font-semibold text-rose-300">Connection lost — retrying…</div>}
              {hud.marked && (
                <div className="mt-1 inline-block rounded-full bg-rose-600/80 px-3 py-0.5 text-[11px] font-bold tracking-wider">MARKED · +20% damage taken</div>
              )}
              {hud.xray && <div className="mt-1 inline-block rounded-full bg-sky-500/80 px-3 py-0.5 text-[11px] font-bold tracking-wider">DIVINE MARK ACTIVE</div>}
            </div>
            <HpCard piece={oppPiece} color={oppColor} name={props.oppName} hp={hud.oppHp} max={hud.oppMax} align="right" />
          </div>

          {/* radar */}
          {!hud.finished && (
            <div className={`pointer-events-none absolute left-4 z-10 ${isTouch ? "top-[104px]" : "bottom-24 sm:bottom-5"}`}>
              <Radar hud={hud} mapId={props.mapId} />
            </div>
          )}

          {/* crosshair */}
          {!hud.finished && !hud.scoped && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-8 w-8">
                <span className="absolute left-1/2 top-0 h-2.5 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_2px_#000]" />
                <span className="absolute bottom-0 left-1/2 h-2.5 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_2px_#000]" />
                <span className="absolute left-0 top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white/90 shadow-[0_0_2px_#000]" />
                <span className="absolute right-0 top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white/90 shadow-[0_0_2px_#000]" />
                <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
              </div>
            </div>
          )}

          {/* sniper scope */}
          {hud.scoped && !hud.finished && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_24vmin,#000_24.4vmin)]" />
              <div className="absolute left-0 right-0 top-1/2 h-px bg-black/80" />
              <div className="absolute bottom-0 left-1/2 top-0 w-px bg-black/80" />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500" />
            </div>
          )}

          {/* sprint speed hint */}
          {hud.sprinting && !hud.finished && (
            <div className="pointer-events-none absolute inset-0 z-[8] bg-[radial-gradient(ellipse_at_center,transparent_62%,rgba(255,255,255,0.14)_100%)]" />
          )}

          {/* feedback */}
          {hud.hitAt > 0 && now - hud.hitAt < 600 && (
            <div key={hud.hitAt} className="pointer-events-none absolute inset-0 z-10">
              <div className="hitmarker" style={{ color: hud.hitKind === "head" ? "#ff4d4d" : "#ffffff" }} />
            </div>
          )}
          {hud.hurtAt > 0 && now - hud.hurtAt < 800 && (
            <div key={hud.hurtAt} className="pointer-events-none absolute inset-0 z-10">
              <div className="hurt-flash" />
              <div
                className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2"
                style={{ transform: `translate(-50%,-50%) rotate(${hud.hurtAngle}rad)` }}
              >
                <div className="hurt-arrow absolute left-1/2 top-0 h-10 w-24 -translate-x-1/2 rounded-b-full blur-[2px]" style={{ background: "rgba(225,29,72,0.85)" }} />
              </div>
            </div>
          )}
          {buffed && !hud.finished && (
            <div
              className={`pointer-events-none absolute inset-0 z-[9] ${
                myPiece === "k" || myPiece === "p"
                  ? "bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(250,204,21,0.35)_100%)]"
                  : "bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(90,180,255,0.4)_100%)]"
              }`}
            />
          )}

          {/* bottom bar */}
          {!hud.finished && !isTouch && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 pb-5 sm:pl-[200px] sm:pr-[170px]">
              <Slot
                wide
                keyLabel="LMB"
                name={myDef.primary.name}
                cd={hud.priCd}
                sub={hud.ammo !== null ? (hud.reload > 0 ? `Reloading ${Math.round(hud.reload * 100)}%` : `${hud.ammo} / ${hud.mag}`) : "Melee"}
              />
              {sec && (
                <Slot
                  wide
                  keyLabel="RMB"
                  name={sec.name}
                  cd={hud.secCd}
                  active={hud.charge > 0}
                  sub={sec.chargeTime ? (hud.charge > 0 ? `Charging ${Math.round(hud.charge * 100)}%` : "Hold & release") : undefined}
                />
              )}
              {myDef.aim && <Slot keyLabel="RMB" name={myDef.aim.label} sub="Hold" active={hud.aiming} />}
              <Slot keyLabel="E" icon={abE.icon} name={abE.name} cd={hud.abilities[0]?.cd} active={(hud.abilities[0]?.active ?? 0) > 0} ready={hud.abilities[0]?.cd === 0} sub={abilitySub(abE, hud.abilities[0])} />
              <Slot keyLabel="Q" icon={abQ.icon} name={abQ.name} cd={hud.abilities[1]?.cd} active={(hud.abilities[1]?.active ?? 0) > 0} ready={hud.abilities[1]?.cd === 0} sub={abilitySub(abQ, hud.abilities[1])} />
              {hud.mag !== null && <Slot keyLabel="R" name="Reload" />}
              <Slot keyLabel="⇧" name="Sprint" sub="Hold Shift" active={hud.sprinting} />
            </div>
          )}

          {/* sound toggle + perf */}
          <div className={`absolute right-4 z-20 flex items-center gap-2 ${isTouch ? "top-3" : "bottom-4"}`}>
            <button
              type="button"
              title="Graphics quality: Auto adapts resolution to your machine"
              onClick={() => engineRef.current?.setQuality(hud.quality === "auto" ? "high" : hud.quality === "high" ? "low" : "auto")}
              className="rounded-lg bg-black/55 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/15 hover:bg-black/75"
            >
              ⚙ {hud.quality === "auto" ? "Auto" : hud.quality === "high" ? "High" : "Low"}
              <span className="ml-1.5 tabular-nums text-white/45">{hud.fps}fps</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
              className="rounded-lg bg-black/55 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/15 hover:bg-black/75"
            >
              {muted ? "🔇 Sound off" : "🔊 Sound on"}
            </button>
          </div>

          {hud.pointerFallback && !hud.finished && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white/80">
              Mouse capture unavailable — move the mouse to look, or use the arrow keys.
            </div>
          )}

          {isTouch && hud.inArena && !hud.finished && <TouchLayer engine={engineRef.current} piece={myPiece} />}

          {/* countdown */}
          {hud.phase === "countdown" && hud.countdown > 0 && !needsClick && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <div key={hud.countdown} className="count-pop text-[min(24vw,200px)] font-black leading-none text-white drop-shadow-[0_6px_30px_rgba(0,0,0,0.7)]">
                {hud.countdown}
              </div>
            </div>
          )}
          {hud.phase === "waiting" && !needsClick && !hud.finished && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <div className="rounded-2xl bg-black/60 px-6 py-4 text-center backdrop-blur">
                <div className="text-lg font-semibold">Waiting for {props.oppName}…</div>
                <div className="mt-1 text-sm text-white/65">The fight begins as soon as both players are in the arena.</div>
              </div>
            </div>
          )}

          {/* click to enter */}
          {needsClick && (
            <div
              className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center overflow-y-auto bg-[#05070b]/80 p-4 backdrop-blur-sm"
              onClick={() => engineRef.current?.enterArena()}
            >
              <div className="fade-up mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-[1fr_1.1fr]">
                <div className="flex flex-col justify-center text-center md:text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">{props.headline}</div>
                  {props.opponentDifficulty && (
                    <div className="mt-2 text-xs text-[#9ad1ff]">
                      Bot capture difficulty: <strong>{DIFFICULTY_LABELS[props.opponentDifficulty]}</strong>
                    </div>
                  )}
                  <h2 className="mt-2 text-3xl font-bold leading-tight">
                    {PIECES[myPiece].name} <span className="text-white/40">vs</span> {PIECES[oppPiece].name}
                  </h2>
                  <p className="mt-3 text-sm text-white/70">
                    {role === "a"
                      ? "You are attacking. Win the duel and the capture goes through; lose and your piece is destroyed."
                      : "You are defending. Win the duel and the attacker is destroyed; lose and your piece is captured."}
                  </p>
                  {myPiece === "k" && (
                    <p className="mt-2 text-sm font-semibold text-rose-300">Your King is in this fight — if it falls, the game is lost!</p>
                  )}
                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5 text-left ring-1 ring-white/10">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 p-1">
                      <MapPreview map={map} className="h-full w-full" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{map.name}</div>
                      <div className="text-[11px] text-white/55">
                        {map.halfX * 2}×{map.halfZ * 2} m · you start at the {role === "a" ? "blue" : "amber"} marker
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-4 md:justify-start">
                    <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                      <PieceIcon type={myPiece} color={myColor} size={52} />
                    </div>
                    <span className="text-2xl text-white/40">⚔</span>
                    <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                      <PieceIcon type={oppPiece} color={oppColor} size={52} />
                    </div>
                  </div>
                  <div className="mt-5 inline-flex items-center justify-center gap-2 self-center rounded-xl bg-amber-400 px-5 py-3 font-bold text-[#1a1304] md:self-start">
                    Click anywhere to enter the arena
                  </div>
                  <p className="mt-2 text-xs text-white/45">
                    Esc releases the mouse. Opponent: {props.oppName} ({PIECES[oppPiece].name}: {PIECES[oppPiece].hp} HP)
                  </p>
                </div>
                <div className="max-h-[70vh] overflow-y-auto rounded-2xl scrollbar-thin">
                  <PieceGuideCard piece={myPiece} color={myColor} compact />
                </div>
              </div>
            </div>
          )}

          {/* result */}
          {result && (
            <div className="absolute inset-0 z-40 grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
              <div className="card fade-up w-full max-w-md p-7 text-center">
                <div className={`text-xs font-bold uppercase tracking-[0.25em] ${result.good ? "text-emerald-300" : "text-rose-300"}`}>
                  {result.good ? "Victory" : "Defeat"}
                </div>
                <h3 className="mt-2 text-2xl font-bold text-white">{result.title}</h3>
                <p className="mt-2 text-sm text-[#a7b0c4]">{result.detail}</p>
                <button className="btn btn-primary mt-6 w-full" onClick={props.onExit}>
                  {props.mode === "practice" ? "Back to practice" : "Back to the board"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

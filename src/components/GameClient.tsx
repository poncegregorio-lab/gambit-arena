"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PIECE_NAMES,
  PIECE_VALUE,
  applyMove,
  getLegalMoves,
  getLost,
  kingsInCheck,
  opposite,
  type Color,
  type LegalMove,
  type PendingFight,
  type PieceType,
  type Square,
} from "@/lib/chess";
import { api, usePlayer } from "@/lib/client";
import { createPracticeTransport } from "@/lib/fight/bot";
import type { Transport } from "@/lib/fight/engine";
import { getMapDef } from "@/lib/fight/maps";
import type { Role, SyncResponse } from "@/lib/fight/room";
import { initAudio, sfx } from "@/lib/fight/sfx";
import { PIECE_ORDER } from "@/lib/fight/weapons";
import type { GameView } from "@/lib/types";
import { Board } from "./Board";
import { BotGamePanel } from "./BotGamePanel";
import { FightScreen } from "./FightScreen";
import { PieceGuideCard } from "./PieceGuide";
import { PieceIcon } from "./PieceIcon";

const colorName = (c: Color) => (c === "w" ? "White" : "Black");

function playMoveSound(san: string, fought = false) {
  if (san.includes("#")) sfx("check");
  else if (san.includes("+")) sfx("check");
  else if (fought || san.includes("x")) sfx("capture");
  else if (san.startsWith("O-O")) sfx("castle");
  else sfx("move");
}

function PlayerBar({
  color,
  name,
  captured,
  advantage,
  active,
  you,
  joined,
}: {
  color: Color;
  name: string | null;
  captured: PieceType[];
  advantage: number;
  active: boolean;
  you: boolean;
  joined: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] ring-1 ${
            active ? "turn-pulse ring-amber-300/70" : "ring-white/10"
          }`}
        >
          <PieceIcon type="k" color={color} size={30} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">{joined ? (name ?? "Anonymous") : "Waiting for opponent…"}</span>
            {you && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">You</span>}
          </div>
          <div className="text-[11px] text-[#8d96ab]">
            {colorName(color)}
            {active && <span className="ml-2 text-amber-300">● to move</span>}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end">
        <div className="flex -space-x-2.5">
          {captured.map((p, i) => (
            <PieceIcon key={i} type={p} color={opposite(color)} size={22} />
          ))}
        </div>
        {advantage > 0 && <span className="ml-2 text-xs font-semibold text-[#8d96ab]">+{advantage}</span>}
      </div>
    </div>
  );
}

function resultText(view: GameView): { title: string; sub: string } {
  const reason = view.resultReason ?? "";
  if (view.result === "draw") return { title: "Draw", sub: reason };
  const winner: Color = view.result === "white" ? "w" : "b";
  const mine = view.myColor;
  if (mine) return { title: mine === winner ? "You won!" : "You lost", sub: `${colorName(winner)} wins — ${reason}` };
  return { title: `${colorName(winner)} wins`, sub: reason };
}

export function GameClient({ id }: { id: string }) {
  const { player, setName } = usePlayer();
  const [view, setView] = useState<GameView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [fightSnapshot, setFightSnapshot] = useState<PendingFight | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"moves" | "guide">("moves");
  const [guidePiece, setGuidePiece] = useState<PieceType>("k");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [confirmResign, setConfirmResign] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [copied, setCopied] = useState(false);
  const [optimistic, setOptimistic] = useState<{ fen: string; base: number; from: Square; to: Square } | null>(null);
  const versionRef = useRef<number | null>(null);
  const soundedRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const movesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (player && !joinName) setJoinName(player.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const apply = useCallback((v: GameView) => {
    if (v.version >= (versionRef.current ?? -1)) {
      versionRef.current = v.version;
      setView(v);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!player) return;
    try {
      const r = await api<{ view?: GameView }>(`/api/games/${id}?playerId=${encodeURIComponent(player.id)}`);
      if (r.view) apply(r.view);
      setConnErr(false);
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message)) setNotFound(true);
    }
  }, [id, player, apply]);

  // Long-poll: the server holds each request open until the game changes, so opponent moves
  // arrive the instant they are made instead of on the next timer tick.
  useEffect(() => {
    if (!player) return;
    let stop = false;
    const ctrl = new AbortController();
    (async () => {
      let failures = 0;
      while (!stop) {
        try {
          const q = new URLSearchParams({ playerId: player.id });
          if (versionRef.current !== null) {
            q.set("v", String(versionRef.current));
            q.set("wait", "20000");
          }
          const res = await fetch(`/api/games/${id}?${q}`, { cache: "no-store", signal: ctrl.signal });
          const data = await res.json().catch(() => ({}));
          if (stop) return;
          if (!res.ok) {
            if (res.status === 404) {
              setNotFound(true);
              return;
            }
            throw new Error((data as { error?: string }).error ?? "Request failed");
          }
          failures = 0;
          setConnErr(false);
          if ((data as { view?: GameView }).view) apply((data as { view: GameView }).view);
        } catch (e) {
          if (stop || (e instanceof DOMException && e.name === "AbortError")) return;
          failures++;
          if (failures > 1) setConnErr(true);
          await new Promise((r) => setTimeout(r, Math.min(3000, 500 * failures)));
        }
      }
    })();
    return () => {
      stop = true;
      ctrl.abort();
    };
  }, [player, id, apply]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    movesEnd.current?.scrollIntoView({ block: "nearest" });
  }, [view?.moves.length, tab]);

  // Board sounds for every move that arrives from the server (our own optimistic moves play instantly).
  useEffect(() => {
    if (!view) return;
    const n = view.moves.length;
    if (soundedRef.current === null) {
      soundedRef.current = n;
      endedRef.current = view.status === "finished";
      return;
    }
    if (n > soundedRef.current) {
      const m = view.moves[n - 1];
      playMoveSound(m.san, !!m.fight);
      soundedRef.current = n;
    }
    if (view.status === "finished" && !endedRef.current) {
      endedRef.current = true;
      setTimeout(() => sfx("gameover"), 250);
    }
  }, [view]);

  const send = useCallback(
    async (path: string, body: Record<string, unknown> = {}) => {
      if (!player) return;
      setBusy(true);
      try {
        const r = await api<{ view: GameView }>(`/api/games/${id}/${path}`, { playerId: player.id, ...body });
        apply(r.view);
        if (path === "bot-settings") setToast("Bot difficulty settings saved");
        if (path === "action" && body.action === "offer-draw" && r.view.bot && r.view.status === "active" && !r.view.drawOfferBy) {
          setToast("Arena Bot declined the draw offer.");
        }
      } catch (e) {
        setOptimistic(null);
        setToast(e instanceof Error ? e.message : "Something went wrong");
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [id, player, refresh, apply],
  );

  const handleMove = useCallback(
    (m: LegalMove) => {
      if (!view) return;
      initAudio();
      if (!m.isCapture) {
        // Show the move instantly; the server confirmation replaces it a few milliseconds later.
        try {
          const applied = applyMove(view.fen, m.from, m.to, m.promotion);
          setOptimistic({ fen: applied.fen, base: view.version, from: m.from, to: m.to });
          playMoveSound(applied.san);
          soundedRef.current = view.moves.length + 1;
        } catch {
          /* let the server decide */
        }
      }
      void send("move", { from: m.from, to: m.to, promotion: m.promotion });
    },
    [view, send],
  );

  const pf = view?.pendingFight ?? null;
  // The poll may clear pendingFight before the player has read the outcome. Keep the screen mounted.
  const screenFight = fightSnapshot ?? pf;
  const pfId = screenFight?.id;

  useEffect(() => {
    if (pf && !dismissed.includes(pf.id)) setFightSnapshot(pf);
  }, [pf, dismissed]);

  const optimisticActive = !!optimistic && !!view && optimistic.base === view.version;
  const botTurn = !!view?.bot && !!view.myColor && view.status === "active" && !pf && view.turn === view.bot.color;
  const boardVersion = view?.version;
  useEffect(() => {
    if (!botTurn || !player || screenFight || boardVersion === undefined) return;
    let stopped = false;
    let timer = 0;
    const move = async () => {
      setBotThinking(true);
      try {
        const r = await api<{ view: GameView }>(`/api/games/${id}/bot-turn`, { playerId: player.id, version: boardVersion });
        if (!stopped) apply(r.view);
      } catch (e) {
        if (!stopped) {
          setToast(e instanceof Error ? e.message : "The bot couldn't move — retrying…");
          timer = window.setTimeout(() => void move(), 2500);
        }
      } finally {
        if (!stopped) setBotThinking(false);
      }
    };
    // A short, human-feeling pause; the engine's own search time is added on top.
    timer = window.setTimeout(() => void move(), 380);
    return () => {
      stopped = true;
      clearTimeout(timer);
      setBotThinking(false);
    };
  }, [botTurn, boardVersion, player, id, screenFight, apply]);

  const transport = useCallback<Transport>(
    async (req) => {
      if (!player || !pfId) return null;
      try {
        const r = await fetch(`/api/games/${id}/fight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: player.id, fightId: pfId, req }),
          cache: "no-store",
        });
        if (!r.ok) return null;
        return (await r.json()) as SyncResponse;
      } catch {
        return null;
      }
    },
    [id, player, pfId],
  );

  // Bot duels are simulated locally for zero-latency, smooth fights; the result is reported afterwards.
  const legal = useMemo<LegalMove[]>(
    () => (view && view.status === "active" && !view.pendingFight ? getLegalMoves(view.fen) : []),
    [view],
  );
  const displayFen = view ? (optimisticActive ? optimistic!.fen : view.fen) : "";
  const checks = useMemo(() => (view && view.status !== "waiting" ? kingsInCheck(displayFen) : []), [view, displayFen]);
  const lost = useMemo(() => (view ? getLost(displayFen) : { w: [], b: [] }), [view, displayFen]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Game not found</h1>
        <p className="mt-2 text-[#8d96ab]">
          The code <span className="font-mono text-white">{id}</span> doesn&apos;t match any game.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to lobby
        </Link>
      </main>
    );
  }

  if (!view || !player) {
    return <main className="mx-auto max-w-md px-4 py-24 text-center text-[#8d96ab]">Loading game…</main>;
  }

  const mine = view.myColor;
  const orientation: Color = mine ?? "w";
  const top: Color = opposite(orientation);
  const myTurn = view.status === "active" && !view.pendingFight && mine === view.turn;
  const last = view.moves[view.moves.length - 1];
  const lastMove = optimisticActive ? { from: optimistic!.from, to: optimistic!.to } : last ? { from: last.from, to: last.to } : null;
  const material = (c: Color) => lost[opposite(c)].reduce((s, p) => s + PIECE_VALUE[p], 0);
  const adv = (c: Color) => Math.max(0, material(c) - material(opposite(c)));
  const turnNow: Color = optimisticActive ? opposite(view.turn) : view.turn;

  const myCheck = mine && checks.length > 0 && view.status === "active" && turnNow === mine;
  let statusLine = "";
  let statusTone = "text-white";
  if (view.status === "waiting") statusLine = "Waiting for an opponent to join…";
  else if (view.status === "finished") statusLine = resultText(view).title;
  else if (pf) {
    statusLine = `⚔ ${PIECE_NAMES[pf.attacker.piece]} attacks ${PIECE_NAMES[pf.defender.piece]} on ${pf.to}`;
    statusTone = "text-rose-300";
  } else if (mine) {
    const myMove = myTurn && !optimisticActive;
    statusLine = myMove ? (myCheck ? "Your move — you're in check!" : "Your move") : view.bot ? (botThinking || optimisticActive ? "Arena Bot is thinking…" : "Arena Bot's move") : "Opponent's move";
    if (myCheck) statusTone = "text-rose-300";
  } else statusLine = `${colorName(view.turn)} to move`;

  const inFight = !!screenFight && !!mine && !dismissed.includes(screenFight.id);
  const fightRole: Role | null = screenFight && mine ? (screenFight.attacker.color === mine ? "a" : "d") : null;
  const nameOf = (c: Color) => (c === "w" ? view.white.name : view.black.name) ?? "Opponent";
  const mapLabel = view.map === "random" ? "Random arenas" : getMapDef(view.map).name;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/game/${view.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setToast("Copy failed — select the link manually");
    }
  };

  const movePairs: { n: number; w?: GameView["moves"][number]; b?: GameView["moves"][number] }[] = [];
  view.moves.forEach((m) => {
    if (m.color === "w") movePairs.push({ n: movePairs.length + 1, w: m });
    else if (movePairs.length && !movePairs[movePairs.length - 1].b && movePairs[movePairs.length - 1].w) movePairs[movePairs.length - 1].b = m;
    else movePairs.push({ n: movePairs.length + 1, b: m });
  });

  const moveCell = (m?: GameView["moves"][number]) => {
    if (!m) return <span className="text-white/20">…</span>;
    const f = m.fight;
    return (
      <span
        className={`inline-flex items-center gap-1 ${f ? (f.winner === "attacker" ? "text-emerald-300" : "text-rose-300") : "text-white"}`}
        title={f ? `${PIECE_NAMES[f.attacker]} vs ${PIECE_NAMES[f.defender]} — ${f.winner} won the duel` : undefined}
      >
        {f && <span className="text-[10px]">⚔</span>}
        {m.san}
      </span>
    );
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-sm tracking-widest text-amber-300">{view.id}</div>
          {view.bot ? (
            <span className="rounded-lg border border-[#5ab4ff]/20 bg-[#5ab4ff]/10 px-2.5 py-1.5 text-xs font-semibold text-[#9ad1ff]">🤖 Bot match</span>
          ) : (
            <button className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={copyLink}>
              {copied ? "Link copied ✓" : "Copy invite link"}
            </button>
          )}
          <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-[#aeb6c8]">🗺 {mapLabel}</span>
        </div>
        <div className={`text-sm font-semibold ${statusTone}`}>{statusLine}</div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="mx-auto w-full" style={{ maxWidth: "min(100%, 76vh)" }}>
          <PlayerBar
            color={top}
            name={top === "w" ? view.white.name : view.black.name}
            joined={top === "w" ? view.white.joined : view.black.joined}
            captured={lost[opposite(top)]}
            advantage={adv(top)}
            active={view.status === "active" && !pf && turnNow === top}
            you={false}
          />
          <Board
            fen={displayFen}
            orientation={orientation}
            legalMoves={myTurn && !optimisticActive ? legal : []}
            interactive={myTurn && !optimisticActive && !busy}
            lastMove={lastMove}
            checks={checks}
            onMove={handleMove}
          />
          <PlayerBar
            color={orientation}
            name={orientation === "w" ? view.white.name : view.black.name}
            joined={orientation === "w" ? view.white.joined : view.black.joined}
            captured={lost[opposite(orientation)]}
            advantage={adv(orientation)}
            active={view.status === "active" && !pf && turnNow === orientation}
            you={!!mine}
          />
          <p className="mt-1 text-center text-[11px] text-[#6f788d]">
            ⚔ marks captures — capturing starts a first-person duel. Drag pieces or click to move · right-click to draw arrows.
          </p>
        </section>

        <aside className="space-y-4">
          {view.bot && (
            <BotGamePanel
              config={view.bot}
              canEdit={!!myTurn && !screenFight}
              busy={busy || botThinking}
              finished={view.status === "finished"}
              playerId={player.id}
              playerName={player.name}
              humanColor={mine}
              onSave={(settings) => void send("bot-settings", { settings })}
            />
          )}
          {view.status === "finished" && (
            <div className="card fade-up p-5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">Game over</div>
              <div className="mt-1 text-2xl font-bold">{resultText(view).title}</div>
              <div className="mt-1 text-sm text-[#9aa3b8]">{resultText(view).sub}</div>
              <Link href="/" className="btn btn-primary mt-4">
                New game
              </Link>
            </div>
          )}

          {view.status === "waiting" && mine && (
            <div className="card fade-up p-5">
              <div className="text-sm font-semibold text-white">Invite your opponent</div>
              <p className="mt-1 text-[13px] text-[#9aa3b8]">
                Share this link or the code <span className="font-mono text-amber-300">{view.id}</span>. The game starts when they join.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  readOnly
                  className="input !py-2 font-mono text-xs"
                  value={typeof window !== "undefined" ? `${window.location.origin}/game/${view.id}` : ""}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn-primary !px-4" onClick={copyLink}>
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
              <p className="mt-3 text-xs text-[#6f788d]">You are playing {colorName(mine)}. This page updates automatically.</p>
            </div>
          )}

          {view.canJoin && (
            <div className="card fade-up p-5">
              <div className="text-sm font-semibold text-white">Join this game</div>
              <p className="mt-1 text-[13px] text-[#9aa3b8]">
                {view.white.joined
                  ? `${view.white.name ?? "Someone"} is waiting as White — you will play Black.`
                  : `${view.black.name ?? "Someone"} is waiting as Black — you will play White.`}
              </p>
              <input className="input mt-3" placeholder="Your name" maxLength={24} value={joinName} onChange={(e) => setJoinName(e.target.value)} />
              <button
                className="btn btn-primary mt-3 w-full"
                disabled={busy}
                onClick={() => {
                  setName(joinName.trim());
                  void send("join", { name: joinName.trim() });
                }}
              >
                Join &amp; play
              </button>
            </div>
          )}

          {!mine && view.status === "active" && <div className="card p-4 text-center text-sm text-[#9aa3b8]">👁 You are spectating this game.</div>}

          {pf && !inFight && (
            <div className="card fade-up border-rose-500/30 p-4 text-sm">
              <div className="font-semibold text-rose-300">⚔ Duel in progress</div>
              <p className="mt-1 text-[#9aa3b8]">
                {nameOf(pf.attacker.color)}&apos;s {PIECE_NAMES[pf.attacker.piece]} is fighting {nameOf(pf.defender.color)}&apos;s {PIECE_NAMES[pf.defender.piece]} on {pf.to}
                {pf.map ? ` in ${getMapDef(pf.map).name}` : ""}.
              </p>
            </div>
          )}

          {view.lastFight && !pf && view.status !== "waiting" && (
            <div className="card fade-up p-4 text-sm">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f788d]">Last duel</div>
              <div className="flex items-center gap-2">
                <PieceIcon type={view.lastFight.attacker.piece} color={view.lastFight.attacker.color} size={30} />
                <span className="text-white/40">⚔</span>
                <PieceIcon type={view.lastFight.defender.piece} color={view.lastFight.defender.color} size={30} />
                <span className={`ml-1 font-semibold ${view.lastFight.winner === "attacker" ? "text-emerald-300" : "text-rose-300"}`}>
                  {view.lastFight.winner === "attacker"
                    ? `${PIECE_NAMES[view.lastFight.attacker.piece]} takes on ${view.lastFight.to}`
                    : `${PIECE_NAMES[view.lastFight.defender.piece]} held — attacker destroyed`}
                </span>
              </div>
              {view.lastFight.reason && <div className="mt-1 text-xs text-[#8d96ab]">{view.lastFight.reason}</div>}
            </div>
          )}

          {mine && view.status === "active" && (
            <div className="card p-4">
              {view.drawOfferBy && view.drawOfferBy !== mine ? (
                <div className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
                  Your opponent offers a draw.
                  <div className="mt-2 flex gap-2">
                    <button className="btn btn-primary !py-1.5 !text-xs" disabled={busy} onClick={() => void send("action", { action: "accept-draw" })}>
                      Accept
                    </button>
                    <button className="btn btn-ghost !py-1.5 !text-xs" disabled={busy} onClick={() => void send("action", { action: "decline-draw" })}>
                      Decline
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex gap-2">
                {view.drawOfferBy === mine ? (
                  <button className="btn btn-ghost flex-1 !text-sm" disabled={busy} onClick={() => void send("action", { action: "cancel-draw" })}>
                    Cancel draw offer
                  </button>
                ) : (
                  <button className="btn btn-ghost flex-1 !text-sm" disabled={busy || !!pf} onClick={() => void send("action", { action: "offer-draw" })}>
                    Offer draw
                  </button>
                )}
                {confirmResign ? (
                  <button
                    className="btn btn-danger flex-1 !text-sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirmResign(false);
                      void send("action", { action: "resign" });
                    }}
                    onBlur={() => setConfirmResign(false)}
                    autoFocus
                  >
                    Confirm resign
                  </button>
                ) : (
                  <button className="btn btn-danger flex-1 !text-sm" onClick={() => setConfirmResign(true)}>
                    Resign
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex border-b border-white/[0.06] text-sm">
              {(["moves", "guide"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 px-4 py-2.5 font-semibold transition ${tab === t ? "bg-white/[0.06] text-white" : "text-[#8d96ab] hover:text-white"}`}
                >
                  {t === "moves" ? "Moves" : "Piece guide"}
                </button>
              ))}
            </div>
            {tab === "moves" ? (
              <div className="scrollbar-thin max-h-[300px] overflow-y-auto p-3">
                {movePairs.length === 0 ? (
                  <p className="p-3 text-center text-sm text-[#6f788d]">No moves yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {movePairs.map((p) => (
                        <tr key={p.n} className="odd:bg-white/[0.025]">
                          <td className="w-9 py-1 pl-2 text-[#6f788d]">{p.n}.</td>
                          <td className="py-1">{moveCell(p.w)}</td>
                          <td className="py-1">{moveCell(p.b)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div ref={movesEnd} />
              </div>
            ) : (
              <div className="scrollbar-thin max-h-[560px] overflow-y-auto p-3">
                <div className="mb-3 flex gap-1.5">
                  {PIECE_ORDER.map((p) => (
                    <button
                      key={p}
                      onClick={() => setGuidePiece(p)}
                      title={PIECE_NAMES[p]}
                      className={`grid h-11 flex-1 place-items-center rounded-xl transition ${
                        guidePiece === p ? "bg-amber-400/20 ring-1 ring-amber-300/60" : "bg-white/[0.05] hover:bg-white/10"
                      }`}
                    >
                      <PieceIcon type={p} color={mine ?? "w"} size={32} />
                    </button>
                  ))}
                </div>
                <PieceGuideCard piece={guidePiece} color={mine ?? "w"} />
              </div>
            )}
          </div>
        </aside>
      </div>

      {connErr && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-rose-600/90 px-4 py-2 text-sm font-medium shadow-lg">
          Connection problem — retrying…
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-[#222a3b] px-4 py-2 text-sm font-medium shadow-lg ring-1 ring-white/10">
          {toast}
        </div>
      )}

      {inFight && screenFight && fightRole && mine && (
        <FightScreen
          key={screenFight.id}
          mode={view.bot ? "bot" : "online"}
          opponentDifficulty={view.bot?.fightDifficulty}
          role={fightRole}
          myPiece={fightRole === "a" ? screenFight.attacker.piece : screenFight.defender.piece}
          oppPiece={fightRole === "a" ? screenFight.defender.piece : screenFight.attacker.piece}
          myColor={mine}
          oppColor={opposite(mine)}
          myName={nameOf(mine)}
          oppName={nameOf(opposite(mine))}
          mapId={screenFight.map ?? "grand-board"}
          transport={transport}
          headline={`${PIECE_NAMES[screenFight.attacker.piece]} takes ${PIECE_NAMES[screenFight.defender.piece]} · ${screenFight.to}`}
          describe={(winner, reason) => {
            const A = PIECE_NAMES[screenFight.attacker.piece];
            const D = PIECE_NAMES[screenFight.defender.piece];
            if (!winner) return { title: "Duel already settled", detail: "This fight was resolved — returning to the board.", good: true };
            const attackerWon = winner === "a";
            const iWon = winner === fightRole;
            const title = attackerWon ? `${A} takes the ${D}!` : `${D} holds the line!`;
            let detail = attackerWon
              ? `The ${A.toLowerCase()} captures on ${screenFight.to}.`
              : `The attacking ${A.toLowerCase()} is destroyed and the ${D.toLowerCase()} stays on ${screenFight.to}.`;
            if (!attackerWon && screenFight.attacker.piece === "k") detail = "The attacking King has fallen — that ends the game!";
            if (reason) detail += ` (${reason})`;
            return { title, detail, good: iWon };
          }}
          onExit={() => {
            setDismissed((d) => [...d, screenFight.id]);
            setFightSnapshot(null);
            void refresh();
          }}
        />
      )}
    </main>
  );
}

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { games, type GameRow } from "@/db/schema";
import {
  START_FEN,
  applyMove,
  applyRepelled,
  getLegalMoves,
  getStatus,
  opposite,
  posKey,
  turnOf,
  type Color,
  type FightSummary,
  type MoveRecord,
  type PendingFight,
  type PieceType,
  type Square,
} from "@/lib/chess";
import type { GameView, OpenGame } from "@/lib/types";
import { chooseBotMove, evaluateBoard } from "@/lib/bots/chess-engine";
import { readBotSettings, type BotSettings, type BotConfig } from "@/lib/bots/difficulty";
import { Chess } from "chess.js";
import { EventEmitter } from "node:events";
import { pickMap } from "@/lib/fight/maps";
import type { LegalMove } from "@/lib/chess";

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
}

export function cleanId(v: unknown): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 80) throw new GameError("Invalid player id", 400);
  return v;
}

export function cleanName(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 24) : "";
  return s || "Anonymous";
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

type Patch = Partial<Omit<GameRow, "id" | "version" | "createdAt" | "updatedAt">>;

const globalBus = globalThis as typeof globalThis & { __gambitGameBus?: EventEmitter };
const bus: EventEmitter = (globalBus.__gambitGameBus ??= new EventEmitter());
bus.setMaxListeners(0);

/** Wake everyone long-polling this game. */
export function notifyGame(id: string) {
  bus.emit(id.toUpperCase());
}

async function currentVersion(id: string): Promise<number | null> {
  const rows = await db.select({ version: games.version }).from(games).where(eq(games.id, id)).limit(1);
  return rows[0]?.version ?? null;
}

/**
 * Hold the request open until the game's version differs from `version` (or the timeout elapses).
 * Players see opponent moves the instant they are committed instead of waiting for the next poll.
 */
export async function waitForChange(id: string, version: number, maxMs: number, signal?: AbortSignal) {
  const key = id.toUpperCase();
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && !signal?.aborted) {
    let wake: () => void = () => {};
    const woke = new Promise<void>((resolve) => {
      wake = resolve;
    });
    // Subscribe first, then check, so a change in between can never be missed.
    bus.once(key, wake);
    const onAbort = () => wake();
    signal?.addEventListener("abort", onAbort, { once: true });
    const now = await currentVersion(key);
    if (now === null || now !== version) {
      bus.off(key, wake);
      signal?.removeEventListener("abort", onAbort);
      return;
    }
    const timer = setTimeout(wake, Math.max(50, Math.min(2500, deadline - Date.now())));
    await woke;
    clearTimeout(timer);
    bus.off(key, wake);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function locked<T>(id: string, fn: (g: GameRow, update: (patch: Patch) => Promise<void>) => Promise<T>): Promise<T> {
  let changed = false;
  const key = id.toUpperCase();
  const out = await db.transaction(async (tx) => {
    const rows = await tx.select().from(games).where(eq(games.id, key)).for("update");
    const g = rows[0];
    if (!g) throw new GameError("Game not found", 404);
    const update = async (patch: Patch) => {
      await tx
        .update(games)
        .set({ ...patch, version: g.version + 1, updatedAt: new Date() })
        .where(eq(games.id, g.id));
      changed = true;
    };
    return fn(g, update);
  });
  if (changed) notifyGame(key);
  return out;
}

export async function getGame(id: string): Promise<GameRow | undefined> {
  const rows = await db.select().from(games).where(eq(games.id, id.toUpperCase())).limit(1);
  return rows[0];
}

export function colorOf(g: GameRow, playerId: string | null | undefined): Color | null {
  if (!playerId) return null;
  if (g.whiteId === playerId) return "w";
  if (g.blackId === playerId) return "b";
  return null;
}

export function toView(g: GameRow, playerId?: string | null): GameView {
  const myColor = colorOf(g, playerId);
  return {
    id: g.id,
    status: g.status as GameView["status"],
    fen: g.fen,
    turn: turnOf(g.fen),
    moves: g.moves,
    white: { name: g.whiteName, joined: !!g.whiteId },
    black: { name: g.blackName, joined: !!g.blackId },
    myColor,
    canJoin: g.status === "waiting" && !myColor,
    pendingFight: g.pendingFight ?? null,
    lastFight: g.lastFight ?? null,
    result: (g.result as GameView["result"]) ?? null,
    resultReason: g.resultReason,
    drawOfferBy: (g.drawOfferBy as Color | null) ?? null,
    bot: g.bot ?? null,
    map: g.map ?? "random",
    version: g.version,
  };
}

export async function createGame(playerId: string, name: string, pref: string, settings: BotSettings | null = null, mapPref = "random") {
  const color: "white" | "black" =
    pref === "white" || pref === "black" ? pref : Math.random() < 0.5 ? "white" : "black";
  const bot: BotConfig | null = settings ? { ...settings, color: color === "white" ? "b" : "w" } : null;
  const botId = bot ? `bot:${randomUUID()}` : null;
  for (let i = 0; i < 8; i++) {
    const id = makeCode();
    try {
      await db.insert(games).values({
        id,
        fen: START_FEN,
        positions: [posKey(START_FEN)],
        status: bot ? "active" : "waiting",
        bot,
        map: mapPref,
        whiteId: color === "white" ? playerId : botId,
        whiteName: color === "white" ? name : bot ? "Arena Bot" : null,
        blackId: color === "black" ? playerId : botId,
        blackName: color === "black" ? name : bot ? "Arena Bot" : null,
      });
      return { id, color };
    } catch (e) {
      if (i === 7) throw e;
    }
  }
  throw new GameError("Could not create game", 500);
}

export async function joinGame(id: string, playerId: string, name: string) {
  return locked(id, async (g, update) => {
    if (colorOf(g, playerId)) return toView(g, playerId);
    if (g.status !== "waiting") throw new GameError("This game is already full — you can watch it instead.", 409);
    const patch: Patch = { status: "active" };
    if (!g.whiteId) {
      patch.whiteId = playerId;
      patch.whiteName = name;
    } else {
      patch.blackId = playerId;
      patch.blackName = name;
    }
    await update(patch);
    return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
  });
}

function evaluate(fen: string, positions: string[]) {
  const s = getStatus(fen, positions);
  if (!s.over) return { status: "active" as const, result: null, reason: null };
  return { status: "finished" as const, result: s.outcome ?? "draw", reason: s.reason ?? null };
}

export async function submitMove(
  id: string,
  playerId: string,
  from: Square,
  to: Square,
  promotion?: PieceType,
) {
  return locked(id, async (g, update) => {
    const color = colorOf(g, playerId);
    if (!color) throw new GameError("You are not a player in this game", 403);
    if (g.status !== "active") throw new GameError("The game is not active", 409);
    if (g.pendingFight) throw new GameError("A fight is in progress", 409);
    if (turnOf(g.fen) !== color) throw new GameError("It is not your turn", 409);

    const candidates = getLegalMoves(g.fen).filter((m) => m.from === from && m.to === to);
    if (candidates.length === 0) throw new GameError("Illegal move", 400);
    const legal = candidates.length > 1 ? (candidates.find((m) => m.promotion === (promotion ?? "q")) ?? candidates[0]) : candidates[0];

    const patch = movePatch(g, legal);
    await update(patch);
    return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
  });
}

/** The exact same move/capture pipeline is used for humans and bots. */
function movePatch(g: GameRow, legal: LegalMove): Patch {
  const color = legal.color;
  if (legal.isCapture && legal.captured && legal.captureSquare) {
    const fightId = randomUUID();
    const pf: PendingFight = {
      id: fightId,
      map: pickMap(g.map, fightId),
      from: legal.from,
      to: legal.to,
      promotion: legal.promotion,
      attacker: { color, piece: legal.piece },
      defender: { color: opposite(color), piece: legal.captured, square: legal.captureSquare },
      san: legal.san,
      startedAt: Date.now(),
    };
    return { pendingFight: pf, drawOfferBy: null };
  }

  const applied = applyMove(g.fen, legal.from, legal.to, legal.promotion);
  const record: MoveRecord = {
    n: g.moves.length + 1,
    color,
    san: applied.san,
    from: legal.from,
    to: legal.to,
    piece: legal.piece,
    promotion: legal.promotion,
  };
  const positions = [...g.positions, posKey(applied.fen)];
  const ev = evaluate(applied.fen, positions);
  const patch: Patch = {
    fen: applied.fen,
    moves: [...g.moves, record],
    positions,
    drawOfferBy: null,
    lastFight: null,
    status: ev.status,
    result: ev.result,
    resultReason: ev.reason,
  };
  return patch;
}

/** Client requests a turn only when it is the bot's turn; row locks + version make this idempotent. */
export async function playBotTurn(id: string, playerId: string, expectedVersion: number) {
  return locked(id, async (g, update) => {
    const human = colorOf(g, playerId);
    if (!human || !g.bot || human === g.bot.color) throw new GameError("Only this bot's opponent can advance the game", 403);
    if (g.version !== expectedVersion || g.status !== "active" || g.pendingFight || turnOf(g.fen) !== g.bot.color) {
      return toView(g, playerId);
    }
    const move = chooseBotMove(g.fen, g.bot.boardDifficulty, g.positions);
    if (!move) {
      const ev = evaluate(g.fen, g.positions);
      if (ev.status === "finished") {
        const patch: Patch = { status: ev.status, result: ev.result, resultReason: ev.reason };
        await update(patch);
        return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
      }
      throw new GameError("The bot could not find a legal move. Try again.", 503);
    }
    const patch = movePatch(g, move);
    await update(patch);
    return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
  });
}

export async function updateBotSettings(id: string, playerId: string, value: unknown) {
  const settings = readBotSettings(value);
  if (!settings) throw new GameError("Choose a valid difficulty for both chess and capture fights", 400);
  return locked(id, async (g, update) => {
    const human = colorOf(g, playerId);
    if (!human || !g.bot || human === g.bot.color) throw new GameError("Only this bot's opponent can change its settings", 403);
    if (g.status !== "active" || g.pendingFight || turnOf(g.fen) !== human) {
      throw new GameError("Change difficulty on your turn, between fights", 409);
    }
    const patch: Patch = { bot: { ...g.bot, ...settings } };
    await update(patch);
    return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
  });
}

/** Called by the fight room once a fight has a winner. Idempotent. */
export async function resolveFight(gameId: string, fightId: string, winner: "a" | "d", reason: string) {
  await locked(gameId, async (g, update) => {
    await settleFight(g, update, fightId, winner, reason);
  });
}

async function settleFight(
  g: GameRow,
  update: (patch: Patch) => Promise<void>,
  fightId: string,
  winner: "a" | "d",
  reason: string,
): Promise<Patch | null> {
  const pf = g.pendingFight;
  if (!pf || pf.id !== fightId) return null;
  const attackerWins = winner === "a";
  const summary: FightSummary = {
    attacker: { color: pf.attacker.color, piece: pf.attacker.piece },
    defender: { color: pf.defender.color, piece: pf.defender.piece },
    winner: attackerWins ? "attacker" : "defender",
    to: pf.to,
    reason,
    at: Date.now(),
  };
  const baseRecord = {
    n: g.moves.length + 1,
    color: pf.attacker.color,
    from: pf.from,
    to: pf.to,
    piece: pf.attacker.piece,
    captured: pf.defender.piece,
    promotion: pf.promotion,
    fight: { attacker: pf.attacker.piece, defender: pf.defender.piece, winner: summary.winner },
  };
  let patch: Patch;
  if (attackerWins) {
    const applied = applyMove(g.fen, pf.from, pf.to, pf.promotion);
    const positions = [...g.positions, posKey(applied.fen)];
    const ev = evaluate(applied.fen, positions);
    patch = {
      pendingFight: null,
      lastFight: summary,
      fen: applied.fen,
      moves: [...g.moves, { ...baseRecord, san: applied.san }],
      positions,
      drawOfferBy: null,
      status: ev.status,
      result: ev.result,
      resultReason: ev.reason,
    };
  } else {
    const newFen = applyRepelled(g.fen, pf.from);
    const san = `${pf.san.replace(/[+#]$/, "")} ✗`;
    if (pf.attacker.piece === "k") {
      patch = {
        pendingFight: null,
        lastFight: summary,
        fen: newFen,
        moves: [...g.moves, { ...baseRecord, san }],
        drawOfferBy: null,
        status: "finished",
        result: pf.attacker.color === "w" ? "black" : "white",
        resultReason: "King slain in battle",
      };
    } else {
      const positions = [...g.positions, posKey(newFen)];
      const ev = evaluate(newFen, positions);
      patch = {
        pendingFight: null,
        lastFight: summary,
        fen: newFen,
        moves: [...g.moves, { ...baseRecord, san }],
        positions,
        drawOfferBy: null,
        status: ev.status,
        result: ev.result,
        resultReason: ev.reason,
      };
    }
  }
  await update(patch);
  return patch;
}

export async function gameAction(id: string, playerId: string, action: string) {
  return locked(id, async (g, update) => {
    const color = colorOf(g, playerId);
    if (!color) throw new GameError("You are not a player in this game", 403);
    if (g.status !== "active") throw new GameError("The game is not active", 409);
    let patch: Patch;
    switch (action) {
      case "resign":
        patch = {
          status: "finished",
          result: color === "w" ? "black" : "white",
          resultReason: "Resignation",
          pendingFight: null,
          drawOfferBy: null,
        };
        break;
      case "offer-draw":
        if (g.pendingFight) throw new GameError("Finish the fight first", 409);
        if (g.bot) {
          const score = evaluateBoard(new Chess(g.fen)) * (g.bot.color === "w" ? 1 : -1);
          const accepts = g.moves.length >= 12 && (Math.abs(score) < 80 || score < -350);
          patch = accepts
            ? { status: "finished", result: "draw", resultReason: "Draw by agreement", drawOfferBy: null }
            : { drawOfferBy: null };
        } else patch = { drawOfferBy: color };
        break;
      case "accept-draw":
        if (!g.drawOfferBy || g.drawOfferBy === color) throw new GameError("No draw offer to accept", 409);
        patch = { status: "finished", result: "draw", resultReason: "Draw by agreement", drawOfferBy: null };
        break;
      case "decline-draw":
      case "cancel-draw":
        patch = { drawOfferBy: null };
        break;
      default:
        throw new GameError("Unknown action", 400);
    }
    await update(patch);
    return toView({ ...g, ...patch, version: g.version + 1 } as GameRow, playerId);
  });
}

export async function listOpenGames(): Promise<OpenGame[]> {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.status, "waiting"), gt(games.createdAt, since)))
    .orderBy(desc(games.createdAt))
    .limit(12);
  return rows.map((g) => ({
    id: g.id,
    hostName: g.whiteId ? (g.whiteName ?? "Anonymous") : (g.blackName ?? "Anonymous"),
    hostColor: g.whiteId ? "white" : "black",
    createdAt: g.createdAt.toISOString(),
  }));
}

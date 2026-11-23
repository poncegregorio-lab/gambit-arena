import { Chess, type Square } from "chess.js";

export type { Square };
export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const PIECE_NAMES: Record<PieceType, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

export interface BoardPiece {
  type: PieceType;
  color: Color;
}

export interface LegalMove {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Color;
  captured?: PieceType;
  captureSquare?: Square;
  promotion?: PieceType;
  san: string;
  isCapture: boolean;
  isEnPassant: boolean;
}

export interface FightSide {
  color: Color;
  piece: PieceType;
}

export interface PendingFight {
  id: string;
  from: Square;
  to: Square;
  promotion?: PieceType;
  attacker: FightSide;
  defender: FightSide & { square: Square };
  san: string;
  startedAt: number;
  /** Arena this duel is fought in (resolved from the game's map preference when the capture happens). */
  map?: string;
}

export interface FightSummary {
  attacker: FightSide;
  defender: FightSide;
  winner: "attacker" | "defender";
  to: Square;
  reason?: string;
  at: number;
}

export interface MoveRecord {
  n: number;
  color: Color;
  san: string;
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  fight?: { attacker: PieceType; defender: PieceType; winner: "attacker" | "defender" };
}

export interface GameStatus {
  over: boolean;
  outcome?: "white" | "black" | "draw";
  reason?: string;
}

export const opposite = (c: Color): Color => (c === "w" ? "b" : "w");

export function posKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function getLegalMoves(fen: string): LegalMove[] {
  try {
    const chess = new Chess(fen);
    return chess
      .moves({ verbose: true })
      .filter((m) => m.captured !== "k")
      .map((m) => ({
        from: m.from,
        to: m.to,
        piece: m.piece as PieceType,
        color: m.color as Color,
        captured: m.captured as PieceType | undefined,
        captureSquare: m.isEnPassant()
          ? ((m.to[0] + m.from[1]) as Square)
          : m.isCapture()
            ? m.to
            : undefined,
        promotion: m.promotion as PieceType | undefined,
        san: m.san,
        isCapture: m.isCapture() || m.isEnPassant(),
        isEnPassant: m.isEnPassant(),
      }));
  } catch {
    return [];
  }
}

export function fenToPieces(fen: string): Partial<Record<Square, BoardPiece>> {
  const out: Partial<Record<Square, BoardPiece>> = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, ri) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        out[`${"abcdefgh"[file]}${8 - ri}` as Square] = {
          type: ch.toLowerCase() as PieceType,
          color: ch === ch.toUpperCase() ? "w" : "b",
        };
        file++;
      }
    }
  });
  return out;
}

export function turnOf(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** Squares of kings currently attacked (for UI highlight). */
export function kingsInCheck(fen: string): Square[] {
  try {
    const chess = new Chess(fen);
    const pieces = fenToPieces(fen);
    const out: Square[] = [];
    for (const [sq, p] of Object.entries(pieces)) {
      if (p && p.type === "k" && chess.isAttacked(sq as Square, opposite(p.color))) out.push(sq as Square);
    }
    return out;
  } catch {
    return [];
  }
}

export function getStatus(fen: string, positions: string[] = []): GameStatus {
  const chess = new Chess(fen);
  const legal = getLegalMoves(fen);
  const turn = chess.turn() as Color;
  if (legal.length === 0) {
    if (chess.isCheck()) return { over: true, outcome: turn === "w" ? "black" : "white", reason: "Checkmate" };
    return { over: true, outcome: "draw", reason: "Stalemate" };
  }
  if (chess.isInsufficientMaterial()) return { over: true, outcome: "draw", reason: "Insufficient material" };
  if (Number(fen.split(" ")[4]) >= 100) return { over: true, outcome: "draw", reason: "Fifty-move rule" };
  const key = posKey(fen);
  if (positions.filter((p) => p === key).length >= 3)
    return { over: true, outcome: "draw", reason: "Threefold repetition" };
  return { over: false };
}

export function applyMove(fen: string, from: Square, to: Square, promotion?: PieceType) {
  const chess = new Chess(fen);
  const m = chess.move({ from, to, promotion });
  return { fen: chess.fen(), san: m.san };
}

/** The attacker lost the fight: remove it from the board, hand the turn to the opponent. */
export function applyRepelled(fen: string, from: Square): string {
  const parts = fen.split(" ");
  const rows = parts[0].split("/").map((row) => {
    let out = "";
    for (const ch of row) out += /\d/.test(ch) ? ".".repeat(Number(ch)) : ch;
    return out.split("");
  });
  const file = "abcdefgh".indexOf(from[0]);
  const rank = Number(from[1]);
  const removed = rows[8 - rank][file];
  rows[8 - rank][file] = ".";
  parts[0] = rows
    .map((r) => r.join("").replace(/\.+/g, (m) => String(m.length)))
    .join("/");
  const mover = parts[1];
  parts[1] = mover === "w" ? "b" : "w";
  let castling = parts[2] === "-" ? "" : parts[2];
  const corners: Record<string, string> = { a1: "Q", h1: "K", a8: "q", h8: "k" };
  if (removed.toLowerCase() === "r" && corners[from]) castling = castling.replace(corners[from], "");
  if (removed === "K") castling = castling.replace(/[KQ]/g, "");
  if (removed === "k") castling = castling.replace(/[kq]/g, "");
  parts[2] = castling || "-";
  parts[3] = "-";
  parts[4] = "0";
  if (mover === "b") parts[5] = String(Number(parts[5]) + 1);
  return parts.join(" ");
}

/** Pieces missing from the board per color (i.e. lost). */
export function getLost(fen: string): Record<Color, PieceType[]> {
  const start: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const counts: Record<Color, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const p of Object.values(fenToPieces(fen))) if (p) counts[p.color][p.type]++;
  const out: Record<Color, PieceType[]> = { w: [], b: [] };
  (["w", "b"] as Color[]).forEach((c) => {
    (["q", "r", "b", "n", "p"] as PieceType[]).forEach((t) => {
      const missing = Math.max(0, start[t] - counts[c][t]);
      for (let i = 0; i < missing; i++) out[c].push(t);
    });
  });
  return out;
}

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

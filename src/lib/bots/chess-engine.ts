import { Chess, type Move } from "chess.js";
import { getLegalMoves, posKey, type LegalMove, type PieceType } from "@/lib/chess";
import type { Difficulty } from "./difficulty";

// No combat config is accepted here. Board strength is deliberately independent of duel strength.
export const BOARD_LEVELS: Record<Difficulty, { depth: number; budgetMs: number; noise: number; blunder: number }> = {
  easy: { depth: 1, budgetMs: 80, noise: 140, blunder: 0.32 },
  medium: { depth: 2, budgetMs: 250, noise: 28, blunder: 0.04 },
  hard: { depth: 3, budgetMs: 550, noise: 5, blunder: 0 },
  expert: { depth: 4, budgetMs: 900, noise: 0, blunder: 0 },
};

const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 };
const MATE = 100000;
const TIMEOUT = Symbol("search-timeout");

/** Static chess evaluation from White's perspective, in centipawns. */
export function evaluateBoard(chess: Chess): number {
  const board = chess.board();
  const files = { w: Array<number>(8).fill(0), b: Array<number>(8).fill(0) };
  const bishops = { w: 0, b: 0 };
  let material = 0;
  for (const row of board) for (const p of row) if (p && p.type !== "k" && p.type !== "p") material += VALUE[p.type];
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const advance = p.color === "w" ? 7 - r : r;
      const center = 7 - Math.abs(f - 3.5) - Math.abs(r - 3.5);
      let value = VALUE[p.type];
      switch (p.type) {
        case "p":
          files[p.color][f]++;
          value += advance * 9 + (3.5 - Math.abs(f - 3.5)) * 5;
          if (advance >= 5) value += (advance - 4) * 24;
          break;
        case "n":
          value += center * 15 - (advance === 0 ? 16 : 0);
          break;
        case "b":
          bishops[p.color]++;
          value += center * 8 + (advance > 0 ? 14 : 0);
          break;
        case "r":
          value += advance * 3;
          if (advance === 6) value += 25;
          break;
        case "q":
          value += center * 3 - (material > 5000 && advance > 2 ? 24 : 0);
          break;
        case "k":
          if (material < 2600) value += center * 14;
          else {
            value -= center * 12 + advance * 7;
            if (advance === 0 && (f === 2 || f === 6)) value += 40;
          }
          break;
      }
      score += (p.color === "w" ? 1 : -1) * value;
    }
  }
  for (const color of ["w", "b"] as const) {
    const sign = color === "w" ? 1 : -1;
    if (bishops[color] >= 2) score += sign * 28;
    for (let f = 0; f < 8; f++) {
      if (files[color][f] > 1) score -= sign * (files[color][f] - 1) * 16;
      if (files[color][f] && !files[color][f - 1] && !files[color][f + 1]) score -= sign * 12;
    }
  }
  return score;
}

const key = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? "");
const order = (m: Move) =>
  (m.san.endsWith("#") ? MATE : 0) +
  (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] : 0) +
  (m.promotion ? VALUE[m.promotion] : 0) +
  (m.san.includes("+") ? 45 : 0) +
  (m.isKingsideCastle() || m.isQueensideCastle() ? 40 : 0);

/** Iterative-deepening negamax with alpha-beta pruning and a strict per-turn time budget. */
export function chooseBotMove(
  fen: string,
  difficulty: Difficulty,
  positions: string[] = [],
  random: () => number = Math.random,
): LegalMove | null {
  const legal = getLegalMoves(fen);
  if (!legal.length) return null;
  const level = BOARD_LEVELS[difficulty];
  const chess = new Chess(fen);
  const rootMoves = chess.moves({ verbose: true }).filter((m) => m.captured !== "k").sort((a, b) => order(b) - order(a));
  const mate = rootMoves.find((m) => m.san.endsWith("#"));
  if (mate) return legal.find((m) => key(m) === key(mate)) ?? legal[0];
  if (random() < level.blunder) return legal[Math.min(legal.length - 1, Math.floor(random() * legal.length))];

  const deadline = performance.now() + level.budgetMs;
  const checkTime = () => { if (performance.now() >= deadline) throw TIMEOUT; };
  const search = (node: Chess, depth: number, alpha: number, beta: number, ply: number): number => {
    checkTime();
    if (Number(node.fen().split(" ")[4]) >= 100 || node.isInsufficientMaterial()) return 0;
    if (depth <= 0) {
      if (node.isCheck() && node.isCheckmate()) return -MATE + ply;
      return evaluateBoard(node) * (node.turn() === "w" ? 1 : -1);
    }
    const moves = node.moves({ verbose: true }).filter((m) => m.captured !== "k");
    if (!moves.length) return node.isCheck() ? -MATE + ply : 0;
    moves.sort((a, b) => order(b) - order(a));
    let best = -Infinity;
    for (const m of moves) {
      // Verbose moves contain the post-move FEN; using it avoids making the engine recompute SAN.
      const value = -search(new Chess(m.after), depth - 1, -beta, -alpha, ply + 1);
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  };

  let scores = rootMoves.map((m) => ({ m, score: -Infinity }));
  for (let depth = 1; depth <= level.depth; depth++) {
    try {
      const next: typeof scores = [];
      for (const { m } of scores) {
        checkTime();
        let score = -search(new Chess(m.after), depth - 1, -Infinity, Infinity, 1);
        const repeats = positions.filter((p) => p === posKey(m.after)).length;
        if (repeats >= 2) score = 0;
        else if (repeats === 1) score -= 20;
        next.push({ m, score });
      }
      scores = next.sort((a, b) => b.score - a.score);
      if (scores[0].score > MATE - 50) break;
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
  }
  const ranked = scores.map((s) => ({ ...s, adjusted: s.score + (random() - 0.5) * level.noise }));
  ranked.sort((a, b) => b.adjusted - a.adjusted);
  return legal.find((m) => key(m) === key(ranked[0].m)) ?? legal[0];
}

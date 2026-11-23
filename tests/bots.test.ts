import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { chooseBotMove, BOARD_LEVELS } from "@/lib/bots/chess-engine";
import { DIFFICULTIES, FIGHT_LEVELS, readBotSettings } from "@/lib/bots/difficulty";
import { START_FEN, getLegalMoves } from "@/lib/chess";
import { FightBot } from "@/lib/fight/bot";
import { FightRoom } from "@/lib/fight/room";
import { PIECES } from "@/lib/fight/weapons";

const key = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? "");

test("all sixteen independent difficulty pairings validate without coupling", () => {
  for (const boardDifficulty of DIFFICULTIES) {
    for (const fightDifficulty of DIFFICULTIES) {
      assert.deepEqual(readBotSettings({ boardDifficulty, fightDifficulty }), { boardDifficulty, fightDifficulty });
    }
  }
  assert.equal(readBotSettings({ boardDifficulty: "easy", fightDifficulty: "impossible" }), null);
  assert.equal(readBotSettings({ boardDifficulty: "hard" }), null);
});

test("every chess level produces a legal move within a bounded search", () => {
  const positions = [START_FEN, "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"];
  for (const difficulty of DIFFICULTIES) {
    for (const fen of positions) {
      const started = performance.now();
      const move = chooseBotMove(fen, difficulty, [], () => 0.6);
      assert.ok(move);
      assert.ok(getLegalMoves(fen).some((m) => key(m) === key(move)));
      assert.ok(performance.now() - started < BOARD_LEVELS[difficulty].budgetMs + 1500);
    }
  }
});

test("expert takes a hanging queen, spots mate, and promotes legally", () => {
  const queen = chooseBotMove("4k3/8/8/8/4q3/8/4R3/4K3 w - - 0 1", "expert", [], () => 0.6);
  assert.equal(queen?.to, "e4");
  assert.equal(queen?.captured, "q");
  const mateFen = "7k/8/5KQ1/8/8/8/8/8 w - - 0 1";
  const mate = chooseBotMove(mateFen, "expert", [], () => 0.6);
  assert.ok(mate);
  const position = new Chess(mateFen);
  position.move({ from: mate.from, to: mate.to, promotion: mate.promotion });
  assert.equal(position.isCheckmate(), true);
  const promotion = chooseBotMove("7k/P7/6K1/8/8/8/8/8 w - - 0 1", "hard", [], () => 0.6);
  assert.ok(promotion);
  assert.ok(getLegalMoves("7k/P7/6K1/8/8/8/8/8 w - - 0 1").some((m) => key(m) === key(promotion)));
});

test("no moves are returned in checkmate or stalemate", () => {
  assert.equal(chooseBotMove("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1", "expert"), null);
  assert.equal(chooseBotMove("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1", "expert"), null);
});

test("expert reacts sooner and lands more hits than easy with the same weapon", () => {
  const original = Math.random;
  const sample = (difficulty: "easy" | "expert") => {
    Math.random = () => 0.5;
    const bot = new FightBot("d", "p", "p", difficulty);
    let first = Infinity;
    let hits = 0;
    for (let frame = 0; frame < 360; frame++) {
      const request = bot.step(1 / 60, { x: 3, y: 0, z: 14, yaw: 0, pitch: 0, f: 0 }, true, 1);
      if (request.events.some((e) => e.type === "fire")) first = Math.min(first, frame / 60);
      hits += request.events.filter((e) => e.type === "hit").length;
    }
    return { first, hits };
  };
  try {
    const easy = sample("easy");
    const expert = sample("expert");
    assert.ok(expert.first < easy.first, JSON.stringify({ easy, expert }));
    assert.ok(expert.hits > easy.hits, JSON.stringify({ easy, expert }));
  } finally {
    Math.random = original;
  }
});

test("higher combat difficulty does not add health or damage", () => {
  assert.ok(FIGHT_LEVELS.easy.reaction > FIGHT_LEVELS.expert.reaction);
  assert.ok(FIGHT_LEVELS.easy.accuracy < FIGHT_LEVELS.expert.accuracy);
  for (const difficulty of DIFFICULTIES) {
    const room = new FightRoom({ a: { color: "w", piece: "p" }, d: { color: "b", piece: "p" } }, 1000);
    room.bots.add("d");
    room.sync("a", { state: null, events: [], ack: 0 }, 1000);
    const res = room.sync("a", { state: null, events: [
      { cid: 1, type: "hit", w: "p_pistol", z: "body", dir: [0, 0, 1] },
    ], ack: 0 }, 5100);
    assert.equal(res.maxHp.a, PIECES.p.hp, difficulty);
    assert.equal(res.maxHp.d, PIECES.p.hp, difficulty);
    assert.equal(res.hp.d, PIECES.p.hp - PIECES.p.primary.damage, difficulty);
  }
});

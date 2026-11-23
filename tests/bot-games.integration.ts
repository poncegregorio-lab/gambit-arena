import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { games } from "@/db/schema";
import { DIFFICULTIES } from "@/lib/bots/difficulty";
import { posKey, getLegalMoves } from "@/lib/chess";
import { MAP_IDS } from "@/lib/fight/maps";
import type { GameView } from "@/lib/types";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:3000";
const playerId = randomUUID();
const created: string[] = [];

async function request(path: string, body?: unknown) {
  const res = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function view(id: string): Promise<GameView> {
  const r = await request(`/api/games/${id}?playerId=${playerId}`);
  assert.equal(r.status, 200);
  return r.data.view;
}
async function create(boardDifficulty = "expert", fightDifficulty = "easy", color = "white", map?: string) {
  const r = await request("/api/games", {
    playerId, name: "Bot regression test", mode: "bot", color, bot: { boardDifficulty, fightDifficulty }, ...(map ? { map } : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  created.push(r.data.id);
  return view(r.data.id);
}
async function seed(id: string, fen: string) {
  await db.update(games).set({ fen, positions: [posKey(fen)], moves: [], pendingFight: null, lastFight: null, status: "active", result: null, resultReason: null, version: 100 }).where(eq(games.id, id));
  return view(id);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive a duel the way a player does: sync over the network while the server-side bot fights back.
 * The room decides the winner, so these tests exercise the real path for bot duels.
 */
async function settle(g: GameView, humanWins: boolean) {
  const pf = g.pendingFight!;
  const humanRole: "a" | "d" = pf.attacker.color === g.myColor ? "a" : "d";
  let ack = 0;
  let cid = 1;
  const sync = async (hits = false) => {
    const r = await request(`/api/games/${g.id}/fight`, {
      playerId,
      fightId: pf.id,
      req: {
        state: { x: 3, y: 0, z: humanRole === "a" ? 14 : -14, yaw: 0, pitch: 0, f: 0 },
        events: hits ? [{ cid: cid++, type: "hit", w: "q_carbine", z: "head", dir: [0, 0, 1] }] : [],
        ack,
        seq: 1,
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const out = r.data;
    if (out.events?.length) ack = out.events.at(-1).id;
    return out;
  };
  let res = await sync();
  assert.equal(res.phase, "countdown", "the server-side bot joins automatically");
  await sleep(4300);
  res = await sync();
  assert.equal(res.phase, "live", "the countdown ends on its own without further input");
  // The bot must actually fight over the network: it should have fired before we touch anything.
  let botFired = false;
  for (let i = 0; i < 12 && res.phase !== "done"; i++) {
    res = await sync();
    if ((res.events as { type: string }[]).some((e) => e.type === "fire")) botFired = true;
    await sleep(110);
  }
  if (humanRole === "a") assert.ok(botFired, "the server bot should attack over the network");
  if (humanWins) {
    for (let i = 0; i < 40 && res.phase !== "done"; i++) {
      res = await sync(true);
      await sleep(110);
    }
    assert.equal(res.phase, "done");
    assert.equal(res.winner, humanRole, "the human should win when landing hits");
  } else {
    // Keep the human connected but idle: the bot must win with its actual weapons.
    for (let i = 0; i < 400 && res.phase !== "done"; i++) {
      res = await sync();
      await sleep(80);
    }
    assert.equal(res.phase, "done", "the bot must be able to win an actual firefight");
    assert.notEqual(res.winner, humanRole);
  }
  return view(g.id);
}

async function main() {
  for (const boardDifficulty of DIFFICULTIES) for (const fightDifficulty of DIFFICULTIES) {
    const g = await create(boardDifficulty, fightDifficulty);
    assert.equal(g.status, "active");
    assert.equal(g.myColor, "w");
    assert.deepEqual(g.bot, { color: "b", boardDifficulty, fightDifficulty });
    assert.equal(g.canJoin, false);
  }
  console.log("PASS: all 16 independent combinations create and persist");

  let g = await create("easy", "expert");
  let r = await request(`/api/games/${g.id}/bot-settings`, { playerId, settings: { boardDifficulty: "hard", fightDifficulty: "expert" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.view.bot.boardDifficulty, "hard");
  assert.equal(r.data.view.bot.fightDifficulty, "expert");
  r = await request(`/api/games/${g.id}/bot-settings`, { playerId, settings: { boardDifficulty: "hard", fightDifficulty: "easy" } });
  assert.equal(r.data.view.bot.boardDifficulty, "hard");
  assert.equal(r.data.view.bot.fightDifficulty, "easy");
  r = await request(`/api/games/${g.id}/bot-settings`, { playerId: "spectator-00001", settings: { boardDifficulty: "easy", fightDifficulty: "easy" } });
  assert.equal(r.status, 403);
  r = await request("/api/games", { playerId, mode: "bot", bot: { boardDifficulty: "easy", fightDifficulty: "invalid" } });
  assert.equal(r.status, 400);
  console.log("PASS: changing either difficulty leaves the other alone; bad and unauthorized settings are rejected");

  g = await create("medium", "expert", "black");
  assert.equal(g.bot?.color, "w");
  const original = g;
  const responses = await Promise.all([0, 1].map(() => request(`/api/games/${g.id}/bot-turn`, { playerId, version: g.version })));
  responses.forEach((response) => assert.equal(response.status, 200));
  g = await view(g.id);
  assert.equal(g.moves.length, 1);
  assert.equal(g.turn, "b");
  assert.ok(getLegalMoves(original.fen).some((m) => m.san === g.moves[0].san));
  r = await request(`/api/games/${g.id}/bot-turn`, { playerId, version: 0 });
  assert.equal(r.data.view.moves.length, 1);
  r = await request(`/api/games/${g.id}/bot-turn`, { playerId: "spectator-00001", version: g.version });
  assert.equal(r.status, 403);
  console.log("PASS: bot plays White and duplicate/stale requests cannot double-move");

  // ---- arenas
  for (const map of [...MAP_IDS, "random"]) {
    g = await create("expert", "easy", "white", map);
    assert.equal(g.map, map);
  }
  r = await request("/api/games", { playerId, mode: "bot", bot: { boardDifficulty: "easy", fightDifficulty: "easy" }, map: "volcano" });
  assert.equal(r.status, 400);
  g = await create("expert", "easy", "white", "castle");
  g = await seed(g.id, "4k3/8/8/8/4p3/8/4Q3/4K3 w - - 0 1");
  r = await request(`/api/games/${g.id}/move`, { playerId, from: "e2", to: "e4" });
  assert.equal(r.data.view.pendingFight.map, "castle", "A fixed arena choice is used for the duel");
  g = await create("expert", "easy", "white", "random");
  g = await seed(g.id, "4k3/8/8/8/4p3/8/4Q3/4K3 w - - 0 1");
  r = await request(`/api/games/${g.id}/move`, { playerId, from: "e2", to: "e4" });
  assert.ok(MAP_IDS.includes(r.data.view.pendingFight.map), "Random resolves to a real arena");
  console.log("PASS: arena choice is validated, stored and carried into each duel");

  // ---- capture duels (bot attacks, human defends)
  g = await create("expert", "easy");
  g = await seed(g.id, "4k3/8/8/8/4Q3/8/4r3/4K3 b - - 0 1");
  r = await request(`/api/games/${g.id}/bot-turn`, { playerId, version: g.version });
  assert.equal(r.status, 200);
  g = r.data.view;
  assert.equal(g.pendingFight?.attacker.color, "b");
  assert.equal(g.pendingFight?.attacker.piece, "r");
  assert.equal(g.pendingFight?.defender.piece, "q");
  assert.equal(g.moves.length, 0, "Capture must wait for a duel result");
  r = await request(`/api/games/${g.id}/bot-settings`, { playerId, settings: { boardDifficulty: "easy", fightDifficulty: "hard" } });
  assert.equal(r.status, 409, "Cannot change a fight's difficulty while it is in progress");
  // Outsiders cannot join or start the duel, and bot fights are served by the network.
  r = await request(`/api/games/${g.id}/fight`, { playerId: "spectator-00001", fightId: g.pendingFight!.id, req: { state: null, events: [], ack: 0 } });
  assert.equal(r.status, 403);
  const botTurnView = await view(g.id);
  assert.ok(botTurnView.pendingFight, "an outsider must not resolve the fight");
  const pfId = g.pendingFight!.id;
  g = await settle(g, true);
  assert.equal(g.pendingFight, null);
  assert.equal(g.lastFight?.winner, "defender");
  assert.equal(g.turn, "w");
  assert.equal(g.moves.length, 1);
  assert.ok(g.moves[0].san.includes("✗"));
  // Re-syncing a fight that is already over is harmless (idempotent), never an error.
  const again = await request(`/api/games/${g.id}/fight`, { playerId, fightId: pfId, req: { state: null, events: [], ack: 0, seq: 2 } });
  assert.ok(again.status === 200, `re-sync after the duel should be safe (got ${again.status})`);
  assert.ok(["done", "gone"].includes(again.data.phase), `expected a settled room, got ${again.data.phase}`);
  console.log("PASS: bot attacks over the network, human wins the defending duel; outsiders are rejected");

  // ---- capture duels (human attacks, bot defends)
  g = await create("expert", "expert");
  g = await seed(g.id, "4k3/8/8/8/4p3/8/4Q3/4K3 w - - 0 1");
  r = await request(`/api/games/${g.id}/move`, { playerId, from: "e2", to: "e4" });
  assert.equal(r.status, 200);
  g = r.data.view;
  assert.equal(g.pendingFight?.attacker.color, "w");
  g = await settle(g, true);
  assert.equal(g.lastFight?.winner, "attacker");
  assert.equal(g.turn, "b");
  assert.equal(g.moves.length, 1);
  const postFight = await request(`/api/games/${g.id}/bot-turn`, { playerId, version: g.version });
  assert.equal(postFight.status, 200);
  assert.equal(postFight.data.view.moves.length, 2);
  console.log("PASS: human attacks, capture resolves, bot continues the chess game");

  // ---- bot wins a duel
  g = await create("expert", "expert");
  g = await seed(g.id, "4k3/8/8/8/4Q3/8/4r3/4K3 b - - 0 1");
  r = await request(`/api/games/${g.id}/bot-turn`, { playerId, version: g.version });
  g = r.data.view;
  assert.ok(g.pendingFight);
  g = await settle(g, false);
  assert.equal(g.lastFight?.winner, "attacker");
  assert.equal(g.moves.length, 1);
  assert.equal(g.turn, "w");
  console.log("PASS: the server bot wins a real firefight and completes its capture");

  // ---- long-poll delivers a committed move almost instantly
  g = await create("easy", "easy");
  const started = Date.now();
  const waiting = request(`/api/games/${g.id}?playerId=${playerId}&v=${g.version}&wait=8000`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const moveStart = Date.now();
  await request(`/api/games/${g.id}/move`, { playerId, from: "e2", to: "e4" });
  const polled = await waiting;
  const delivered = Date.now() - moveStart;
  assert.ok(polled.data.view, "long-poll should return the new view");
  assert.equal(polled.data.view.moves.length, 1);
  assert.ok(Date.now() - started < 3000);
  assert.ok(delivered < 700, `move should reach waiting clients quickly (took ${delivered}ms)`);
  const idle = Date.now();
  const unchanged = await request(`/api/games/${g.id}?playerId=${playerId}&v=${polled.data.view.version}&wait=700`);
  assert.equal(unchanged.data.unchanged, true);
  assert.ok(Date.now() - idle >= 600, "an idle long-poll waits for changes");
  console.log(`PASS: long-poll delivered a move in ${delivered}ms`);

  // Existing human online matchmaking stays unchanged.
  r = await request("/api/games", { playerId, name: "Human host", color: "white", map: "ruins" });
  assert.equal(r.status, 200);
  created.push(r.data.id);
  const humanGame = await view(r.data.id);
  assert.equal(humanGame.status, "waiting");
  assert.equal(humanGame.bot, null);
  assert.equal(humanGame.map, "ruins");
  console.log("PASS: human-vs-human games remain available (with arena choice)");

  // ---- WiFi / LAN discovery for other devices
  const info = await request("/api/info");
  assert.equal(info.status, 200);
  assert.ok(Array.isArray(info.data.urls) && info.data.urls.length >= 1, "the app must publish reachable addresses");
  for (const u of info.data.urls as { label: string; url: string; kind: string }[]) {
    assert.match(u.url, /^http:\/\/[^:]+:\d+$/, u.url);
    assert.ok(u.label.length > 0);
    assert.ok(["lan", "loopback", "public"].includes(u.kind));
  }
  assert.ok(
    (info.data.urls as { url: string }[]).some((u) => u.url.endsWith(`:${info.data.port}`)),
    "every address must carry the app's port",
  );
  console.log("PASS: /api/info publishes WiFi addresses:", (info.data.urls as { url: string }[]).map((u) => u.url).join(" · "));

  // ---- practice duels are served over the network, like any other opponent
  const pr = await request("/api/practice", { myPiece: "q", oppPiece: "p", mapId: "frozen", fightDifficulty: "easy" });
  assert.equal(pr.status, 200, JSON.stringify(pr.data));
  assert.equal(pr.data.mapId, "frozen");
  const rejected = await request("/api/practice", { myPiece: "z", oppPiece: "p", mapId: "frozen", fightDifficulty: "easy" });
  assert.equal(rejected.status, 400);
  const rejectedMap = await request("/api/practice", { myPiece: "q", oppPiece: "p", mapId: "volcano", fightDifficulty: "easy" });
  assert.equal(rejectedMap.status, 400);

  let pAck = 0;
  let pCid = 1;
  const psync = async (hits = false) => {
    const r = await request("/api/practice/fight", {
      fightId: pr.data.id,
      req: {
        // Standing in the open, 12 m from the bot's spawn, with a clear line of sight.
        state: { x: 0, y: 0, z: 20, yaw: 0, pitch: 0, f: 0 },
        events: hits ? [{ cid: pCid++, type: "hit", w: "q_carbine", z: "head", dir: [0, 0, 1] }] : [],
        ack: pAck,
        seq: 1,
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const out = r.data;
    if (out.events?.length) pAck = out.events.at(-1).id;
    return out;
  };
  let pres = await psync();
  assert.equal(pres.phase, "countdown", "the practice bot joins over the network");
  await sleep(4200);
  pres = await psync();
  assert.equal(pres.phase, "live");
  let pBotFired = false;
  for (let i = 0; i < 24 && pres.phase !== "done"; i++) {
    pres = await psync();
    if ((pres.events as { type: string }[]).some((e) => e.type === "fire")) pBotFired = true;
    await sleep(110);
  }
  assert.ok(pBotFired, "the practice bot should shoot over the network");
  for (let i = 0; i < 40 && pres.phase !== "done"; i++) {
    pres = await psync(true);
    await sleep(110);
  }
  assert.equal(pres.phase, "done");
  assert.equal(pres.winner, "a", "the player should be able to beat the training bot");
  const stale = await request("/api/practice/fight", { fightId: "prac-00000000-0000-0000-0000-000000000000", req: { state: null, events: [], ack: 0 } });
  assert.equal(stale.status, 200);
  assert.equal(stale.data.phase, "gone", "an unknown practice session reports 'gone'");
  console.log("PASS: practice duels run on the server over the network (bot fired: " + pBotFired + ")");
}

main().then(() => console.log("All bot game integration tests passed.")).finally(async () => {
  if (created.length) await db.delete(games).where(inArray(games.id, created));
  await pool.end();
}).catch((error) => { console.error(error); process.exitCode = 1; });

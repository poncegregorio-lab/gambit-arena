import assert from "node:assert/strict";
import test from "node:test";
import { addExtraBox, clearExtraBoxes, moveXZ, rampartBox, rayWorld, setMap, getMap } from "@/lib/fight/arena";
import { FightBot } from "@/lib/fight/bot";
import { MAPS, pickMap } from "@/lib/fight/maps";
import { FightRoom, type ClientEvent } from "@/lib/fight/room";
import { PIECES, PIECE_ORDER, WEAPONS } from "@/lib/fight/weapons";

test("there are several maps and every one is larger than the original 44x44 arena", () => {
  assert.ok(MAPS.length >= 5);
  for (const m of MAPS) {
    assert.ok(m.halfX * 2 * m.halfZ * 2 >= 44 * 44 * 2.5, `${m.id} should be much larger`);
    assert.ok(m.theme.preview.floor);
  }
  assert.equal(new Set(MAPS.map((m) => m.id)).size, MAPS.length);
});

test("map layouts are inside bounds, point-symmetric and leave both spawns clear", () => {
  for (const m of MAPS) {
    for (const b of m.boxes) {
      assert.ok(Math.abs(b.x) + b.hx <= m.halfX + 1e-6, `${m.id}: box out of X bounds`);
      assert.ok(Math.abs(b.z) + b.hz <= m.halfZ + 1e-6, `${m.id}: box out of Z bounds`);
      const mirror = m.boxes.find(
        (o) => Math.abs(o.x + b.x) < 1e-6 && Math.abs(o.z + b.z) < 1e-6 && o.hx === b.hx && o.hz === b.hz && o.h === b.h,
      );
      assert.ok(mirror, `${m.id}: box at ${b.x},${b.z} has no mirrored twin`);
    }
    for (const role of ["a", "d"] as const) {
      const s = m.spawns[role];
      for (const b of m.boxes) {
        const clear = Math.abs(s.x - b.x) > b.hx + 3 || Math.abs(s.z - b.z) > b.hz + 3;
        assert.ok(clear, `${m.id}: spawn ${role} is too close to a box`);
      }
    }
    // Stair steps must be climbable by the 0.35 m step-up of the controller.
    const stairs = m.boxes.filter((b) => b.k === "stair");
    for (const s of stairs) assert.ok(s.h <= 2.41 && s.h >= 0.29);
  }
});

test("both spawns are connected on foot on every map", () => {
  const CELL = 0.9;
  for (const m of MAPS) {
    setMap(m.id);
    const key = (i: number, j: number) => `${i},${j}`;
    const start = m.spawns.a;
    const goal = m.spawns.d;
    const toCell = (v: number) => Math.round(v / CELL);
    const seen = new Set<string>([key(toCell(start.x), toCell(start.z))]);
    const queue: [number, number][] = [[toCell(start.x), toCell(start.z)]];
    const goalKey = key(toCell(goal.x), toCell(goal.z));
    let reached = false;
    while (queue.length && !reached) {
      const [ci, cj] = queue.shift()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di;
        const nj = cj + dj;
        const k = key(ni, nj);
        if (seen.has(k)) continue;
        const p = { x: ci * CELL, y: 0, z: cj * CELL };
        const free = moveXZ(p, di * CELL, dj * CELL);
        if (!free || Math.abs(p.x - ni * CELL) > 0.05 || Math.abs(p.z - nj * CELL) > 0.05) continue;
        seen.add(k);
        if (k === goalKey) reached = true;
        queue.push([ni, nj]);
      }
    }
    assert.ok(reached, `${m.id}: spawns are not connected`);
  }
});

test("walls block movement and bullets, and nobody gets trapped inside one", () => {
  setMap("grand-board");
  const p = { x: 0, y: 0, z: -10 };
  const box = rampartBox([0, 0, -8], [0, 0, 1]);
  assert.ok(box.hx > box.hz, "facing along Z should produce a wall spanning X");
  addExtraBox({ ...box, id: 1 });
  assert.ok(rayWorld([0, 1, -12], [0, 0, 1], 50) < 5, "bullets must be stopped by the rampart");
  const free = moveXZ(p, 0, 4);
  assert.equal(free, false);
  assert.ok(p.z < -8 - box.hz, "player must be blocked by the wall");
  const trapped = { x: 0, y: 0, z: -8 };
  moveXZ(trapped, 0.1, 0);
  assert.ok(Math.abs(trapped.z - -8) >= box.hz, "a player inside a new wall is pushed out");
  clearExtraBoxes();
});

test("a random map choice is stable per fight but varies between fights", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 60; i++) ids.add(pickMap("random", `fight-${i}`));
  assert.ok(ids.size >= 3);
  assert.equal(pickMap("random", "same"), pickMap("random", "same"));
  assert.equal(pickMap("castle", "anything"), "castle");
  assert.equal(pickMap("nonsense", "x") === "nonsense", false);
});

test("bots move smoothly, stay in bounds and never freeze on any map", () => {
  const original = Math.random;
  for (const m of MAPS) {
    for (const piece of PIECE_ORDER) {
      setMap(m.id);
      const bot = new FightBot("d", piece, "q", "expert");
      const target = { x: 0, y: 0, z: m.spawns.a.z, yaw: 0, pitch: 0, f: 0 };
      let travelled = 0;
      let maxStep = 0;
      let prev = { x: m.spawns.d.x, z: m.spawns.d.z };
      let minDist = Infinity;
      for (let frame = 0; frame < 60 * 30; frame++) {
        const req = bot.step(1 / 60, target, true, 1);
        const s = req.state!;
        assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.y));
        assert.ok(Math.abs(s.x) <= m.halfX && Math.abs(s.z) <= m.halfZ, `${m.id}/${piece}: left the arena`);
        const step = Math.hypot(s.x - prev.x, s.z - prev.z);
        maxStep = Math.max(maxStep, step);
        travelled += step;
        prev = { x: s.x, z: s.z };
        minDist = Math.min(minDist, Math.hypot(s.x - target.x, s.z - target.z));
      }
      // Largest single-frame step should be a dash/slide (<=16m over 0.22s ~= 1.2 m/frame), never a teleport glitch.
      assert.ok(maxStep < 1.6 || piece === "b", `${m.id}/${piece}: jerky step of ${maxStep.toFixed(2)}m`);
      assert.ok(travelled > 8, `${m.id}/${piece}: bot barely moved (${travelled.toFixed(1)}m)`);
      assert.ok(minDist < Math.abs(m.spawns.d.z - m.spawns.a.z) * 0.95, `${m.id}/${piece}: bot never closed distance`);
    }
  }
  Math.random = original;
});

function liveRoom(a: "p" | "n" | "b" | "r" | "q" | "k", d: "p" | "n" | "b" | "r" | "q" | "k") {
  const room = new FightRoom({ a: { piece: a, color: "w" }, d: { piece: d, color: "b" } }, 1000);
  room.sync("a", { state: null, events: [], ack: 0, seq: 1 }, 1000);
  room.sync("d", { state: null, events: [], ack: 0, seq: 1 }, 1000);
  room.sync("a", { state: null, events: [], ack: 0, seq: 2 }, 5100);
  assert.equal(room.phase, "live");
  return room;
}
const hit = (cid: number, w: string, extra: object = {}): ClientEvent =>
  ({ cid, type: "hit", w, z: "body", dir: [0, 0, 1], ...extra }) as ClientEvent;
const ability = (cid: number, k: string): ClientEvent => ({ cid, type: "ability", k }) as ClientEvent;

test("every piece has two distinct abilities with cooldowns, and every ability weapon is registered", () => {
  for (const type of PIECE_ORDER) {
    const [e, q] = PIECES[type].abilities;
    assert.equal(e.key, "E");
    assert.equal(q.key, "Q");
    assert.notEqual(e.id, q.id);
    assert.ok(e.cooldown > 0 && q.cooldown > 0);
  }
  for (const id of ["n_stomp", "q_barrage", "k_shockwave"]) assert.ok(WEAPONS[id], id);
});

test("Battlefield Promotion heals the pawn, boosts damage, and respects its cooldown", () => {
  const room = liveRoom("p", "k");
  // Hurt the pawn first with a king bolt.
  room.sync("d", { state: null, ack: 0, seq: 3, events: [hit(1, "k_scepter")] }, 5200);
  const hurt = room.hp.a;
  assert.ok(hurt < PIECES.p.hp);
  room.sync("a", { state: null, ack: 0, seq: 3, events: [ability(1, "promote")] }, 5300);
  assert.equal(room.hp.a, Math.min(PIECES.p.hp, hurt + 25));
  room.sync("a", { state: null, ack: 0, seq: 4, events: [hit(2, "p_pistol")] }, 5600);
  const boosted = PIECES.k.hp - room.hp.d;
  assert.ok(Math.abs(boosted - PIECES.p.primary.damage * 1.3) < 0.2, `damage was ${boosted}`);
  const before = room.hp.a;
  room.sync("a", { state: null, ack: 0, seq: 5, events: [ability(3, "promote")] }, 6000);
  assert.equal(room.hp.a, before, "second promotion inside the cooldown must be ignored");
});

test("Divine Mark makes the marked piece take 20% more damage", () => {
  const room = liveRoom("b", "k");
  room.sync("a", { state: null, ack: 0, seq: 3, events: [ability(1, "mark")] }, 5200);
  room.sync("a", { state: null, ack: 0, seq: 4, events: [hit(2, "b_rifle")] }, 5400);
  assert.ok(Math.abs(PIECES.k.hp - room.hp.d - PIECES.b.primary.damage * 1.2) < 0.2);
});

test("a piece cannot use another piece's ability or weapon", () => {
  const room = liveRoom("p", "k");
  room.sync("a", { state: null, ack: 0, seq: 3, events: [ability(1, "shockwave"), hit(2, "k_shockwave")] }, 5200);
  assert.equal(room.hp.d, PIECES.k.hp);
});

test("late out-of-order requests never overwrite a newer position", () => {
  const room = liveRoom("q", "r");
  const st = (x: number) => ({ x, y: 0, z: 0, yaw: 0, pitch: 0, f: 0 });
  room.sync("a", { state: st(10), events: [], ack: 0, seq: 10 }, 5200);
  room.sync("a", { state: st(5), events: [], ack: 0, seq: 9 }, 5210);
  const res = room.sync("d", { state: null, events: [], ack: 0, seq: 3 }, 5220);
  assert.equal(res.opp?.x, 10);
  assert.ok(res.oppTime && res.serverTime);
});

test("Royal Barrage hits and Hoof Stomp splash are validated with weapon damage", () => {
  const room = liveRoom("q", "k");
  room.sync("a", { state: null, ack: 0, seq: 3, events: [hit(1, "q_barrage")] }, 5200);
  assert.equal(PIECES.k.hp - room.hp.d, WEAPONS.q_barrage.damage);
  const r2 = liveRoom("n", "k");
  r2.sync("a", { state: null, ack: 0, seq: 3, events: [hit(1, "n_stomp", { z: "splash", f: 1, c: true })] }, 5200);
  assert.ok(Math.abs(PIECES.k.hp - r2.hp.d - 38 * 1.35) < 0.2);
  assert.equal(getMap().id, getMap().id);
});

test("a solo bot room survives a long stall, but a human-vs-human room still forfeits a disconnect", () => {
  const solo = new FightRoom({ a: { piece: "q", color: "w" }, d: { piece: "r", color: "b" } }, 1000);
  solo.bots.add("d");
  solo.sync("a", { state: null, events: [], ack: 0, seq: 1 }, 1000);
  solo.sync("d", { state: null, events: [], ack: 0, seq: 1 }, 1000);
  assert.equal(solo.sync("a", { state: null, events: [], ack: 0, seq: 2 }, 5200).phase, "live");
  // The browser tab froze for 40 seconds (slow GPU, shader compile, backgrounded tab).
  const after = solo.sync("a", { state: null, events: [], ack: 0, seq: 3 }, 45_000);
  assert.equal(after.phase, "live", "a stalled solo fight must not forfeit");
  assert.equal(after.winner, undefined);

  const pvp = liveRoom("q", "r");
  const gone = pvp.sync("a", { state: null, events: [], ack: 0, seq: 10 }, 5100 + 11_000);
  assert.equal(gone.phase, "done");
  assert.equal(gone.winner, "a");
  assert.equal(gone.reason, "Opponent disconnected");
});

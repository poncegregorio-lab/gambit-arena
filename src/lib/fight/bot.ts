import type { Color, PieceType } from "@/lib/chess";
import { FIGHT_LEVELS, type Difficulty } from "@/lib/bots/difficulty";
import { GRAVITY, applySpread, groundAt, moveXZ, norm, rayWorld, setMap, spawnFor } from "./arena";
import type { Transport } from "./engine";
import { FightRoom, type ClientEvent, type NetState, type Role, type RoomInit, type ServerEvent, type SyncRequest } from "./room";
import {
  PIECES,
  PROMOTE_SPEED,
  SPRINT_MULT,
  UNDERDOG_SPEED,
  UNDERDOG_THRESHOLD,
  WEAPONS,
  hitShape,
  type V3,
  type WeaponDef,
} from "./weapons";

// preferred engagement band [min, max] per piece (arenas are large, so bands are wider than before)
const BAND: Record<PieceType, [number, number]> = {
  p: [8, 18],
  n: [2, 8],
  b: [26, 44],
  r: [10, 22],
  q: [10, 20],
  k: [10, 22],
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rot = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];

export class FightBot {
  private def;
  private tuning;
  private t = 0;
  private lastStep = Date.now();
  private pos;
  private vel = { x: 0, z: 0, y: 0 };
  private yaw;
  private pitch = 0;
  private onGround = true;
  private cdPri = 0;
  private cdSec = 0;
  private cdAb = [0, 0];
  private ammo: number;
  private reloadEnd = 0;
  private spin = 0;
  private chargeUntil = 0;
  private strafeTarget = 1;
  private strafeCur = 0;
  private strafeUntil = 0;
  private avoidAngle = 0;
  private avoidUntil = 0;
  private dashT = 0;
  private dashV = { x: 0, z: 0 };
  private leapT = 0;
  private shieldT = 0;
  private guardT = 0;
  private promoteT = 0;
  private sprinting = false;
  private cid = 1;
  private ack = 0;
  private outbox: ClientEvent[] = [];
  private pending: { due: number; ev: Omit<ClientEvent, "cid"> & Record<string, unknown> }[] = [];
  private firing = false;
  private engagedSince: number | null = null;
  private lastVisible = 0;

  constructor(
    private role: Role,
    private piece: PieceType,
    private targetPiece: PieceType,
    difficulty: Difficulty = "medium",
  ) {
    this.def = PIECES[piece];
    this.tuning = FIGHT_LEVELS[difficulty];
    const sp = spawnFor(role);
    this.pos = { x: sp.x, y: 0, z: sp.z };
    this.yaw = sp.yaw;
    this.ammo = this.def.primary.mag ?? 0;
  }

  /** Apply the same knockback humans receive, and acknowledge events exactly once. */
  receive(events: ServerEvent[]) {
    for (const ev of events) {
      if (ev.id <= this.ack) continue;
      this.ack = ev.id;
      if (ev.type !== "damage" || ev.amount <= 0) continue;
      const w = WEAPONS[ev.w];
      if (!w?.knockback) continue;
      const kb = w.knockback * (ev.c ? 1.3 : 1);
      const len = Math.hypot(ev.dir[0], ev.dir[2]) || 1;
      this.vel.x += (ev.dir[0] / len) * kb;
      this.vel.z += (ev.dir[2] / len) * kb;
      if (ev.c || w.splash) {
        this.vel.y = Math.max(this.vel.y, 5);
        this.onGround = false;
      }
    }
  }

  private push(ev: Omit<ClientEvent, "cid"> & Record<string, unknown>) {
    this.outbox.push({ ...ev, cid: this.cid++ } as ClientEvent);
  }

  private state(): NetState {
    let f = 0;
    if (this.shieldT > 0) f |= 1;
    if (this.guardT > 0) f |= 2;
    if (!this.onGround) f |= 8;
    if (this.firing) f |= 16;
    if (this.promoteT > 0) f |= 32;
    if (this.sprinting) f |= 64;
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, f };
  }

  /** Advance using wall-clock time so the bot moves at real speed when called once per network sync. */
  syncAt(now: number, target: NetState | null, live: boolean, hpFrac: number): SyncRequest {
    const dt = Math.max(0, Math.min(0.15, (now - this.lastStep) / 1000));
    this.lastStep = now;
    return this.step(dt, target, live, hpFrac);
  }

  step(dt: number, target: NetState | null, live: boolean, hpFrac: number): SyncRequest {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.firing = false;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.guardT > 0) this.guardT -= dt;
    if (this.promoteT > 0) this.promoteT -= dt;

    // Delayed events (projectile flight time, barrage volleys).
    for (const p of [...this.pending]) {
      if (this.t >= p.due) {
        if (live) this.push(p.ev);
        this.pending = this.pending.filter((x) => x !== p);
      }
    }

    if (target && live) this.think(dt, target, hpFrac);
    else this.physics(dt, 0, 0);

    const events = this.outbox;
    this.outbox = [];
    return { state: this.state(), events, ack: this.ack };
  }

  private physics(dt: number, tvx: number, tvz: number) {
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashV.x;
      this.vel.z = this.dashV.z;
    } else if (this.leapT > 0) {
      this.leapT -= dt;
      if (this.onGround && this.leapT < 0.7) this.leapT = 0;
    } else {
      const k = Math.min(1, (this.onGround ? 11 : 2.5) * dt);
      this.vel.x += (tvx - this.vel.x) * k;
      this.vel.z += (tvz - this.vel.z) * k;
    }
    const free = moveXZ(this.pos, this.vel.x * dt, this.vel.z * dt);
    if (!free && this.onGround && Math.hypot(tvx, tvz) > 1 && Math.random() < dt * 3) {
      this.vel.y = this.def.jump;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    const g = groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = false;
  }

  /** Steer around cover: probe ahead and rotate the heading when something solid is in the way. */
  private steer(wx: number, wz: number): [number, number] {
    const len = Math.hypot(wx, wz);
    if (len < 1e-3) return [0, 0];
    const dx = wx / len;
    const dz = wz / len;
    const probe = (ax: number, az: number) => rayWorld([this.pos.x, this.pos.y + 0.8, this.pos.z], [ax, 0, az], 3) >= 2.8;
    if (this.t < this.avoidUntil) {
      const [rx, rz] = rot(dx, dz, this.avoidAngle);
      if (probe(rx, rz)) return [rx, rz];
    }
    if (probe(dx, dz)) return [dx, dz];
    for (const ang of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const [rx, rz] = rot(dx, dz, ang);
      if (probe(rx, rz)) {
        this.avoidAngle = ang;
        this.avoidUntil = this.t + 0.7;
        return [rx, rz];
      }
    }
    return [dx, dz];
  }

  private think(dt: number, tg: NetState, hpFrac: number) {
    const def = this.def;
    const tdef = PIECES[this.targetPiece];
    const dx = tg.x - this.pos.x;
    const dz = tg.z - this.pos.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const eyeY = this.pos.y + hitShape(def.height).eye;
    const chest: V3 = [tg.x, tg.y + tdef.height * 0.55, tg.z];
    const head: V3 = [tg.x, tg.y + hitShape(tdef.height).headY, tg.z];
    const toChest: V3 = [chest[0] - this.pos.x, chest[1] - eyeY, chest[2] - this.pos.z];
    const d3 = Math.hypot(toChest[0], toChest[1], toChest[2]);
    const dirChest = norm(toChest);
    const eye: V3 = [this.pos.x, eyeY, this.pos.z];
    const los = rayWorld(eye, dirChest, d3) >= d3 - 0.15;

    // aim (smoothed turn rate so the bot swings like a person, not a robot)
    const wantYaw = Math.atan2(-dx, -dz);
    let turn = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
    const maxTurn = this.tuning.turnSpeed * dt;
    const eased = clamp(turn * Math.min(1, dt * this.tuning.turnSpeed * 1.4), -maxTurn, maxTurn);
    this.yaw += eased;
    turn -= eased;
    const wantPitch = Math.atan2(toChest[1], dist);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * this.tuning.turnSpeed * 1.2);

    // movement
    const [bmin, bmax] = BAND[this.piece];
    let fwd = 0;
    if (dist > bmax) fwd = 1;
    else if (dist < bmin) fwd = -1;
    else if (!los) fwd = 0.7;
    if (this.t > this.strafeUntil) {
      this.strafeTarget = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = this.t + rand(0.9, 2.4) / Math.max(0.4, this.tuning.movement);
    }
    this.strafeCur += (this.strafeTarget - this.strafeCur) * Math.min(1, dt * 3.5);
    const nx = dx / dist;
    const nz = dz / dist;
    this.sprinting = fwd > 0 && dist > bmax * 1.25 && !los;
    let speed = def.speed * this.tuning.movement;
    if (this.piece === "p" && hpFrac < UNDERDOG_THRESHOLD) speed *= UNDERDOG_SPEED;
    if (this.promoteT > 0) speed *= PROMOTE_SPEED;
    if (this.sprinting) speed *= SPRINT_MULT;
    if (this.shieldT > 0) speed *= 0.5;
    if (this.chargeUntil > this.t) speed *= 0.4;
    const wx = nx * fwd * 0.95 + -nz * this.strafeCur * this.tuning.strafe;
    const wz = nz * fwd * 0.95 + nx * this.strafeCur * this.tuning.strafe;
    const [sx, sz] = this.steer(wx, wz);
    const mag = clamp(Math.hypot(wx, wz), 0, 1);
    this.physics(dt, sx * speed * mag, sz * speed * mag);
    if (this.onGround && los && Math.random() < dt * this.tuning.jumpRate) {
      this.vel.y = def.jump;
      this.onGround = false;
    }

    if (los) {
      if (this.engagedSince === null) this.engagedSince = this.t;
      this.lastVisible = this.t;
    } else if (this.t - this.lastVisible > 0.45) {
      this.engagedSince = null;
    }
    const reacted = this.engagedSince !== null && this.t - this.engagedSince >= this.tuning.reaction;
    if (reacted) this.abilities(dist, los, hpFrac, nx, nz, dt, tg, dirChest, eye);

    // Difficulty changes how fast the bot reacts, never a weapon's damage or minimum cooldown.
    const aimed = Math.abs(turn) < 0.14;
    if (!reacted || !aimed || !los) return;
    const w = def.primary;
    if (this.reloadEnd > 0 && this.t >= this.reloadEnd) {
      this.reloadEnd = 0;
      this.ammo = w.mag ?? 0;
    }
    const bodyR = hitShape(tdef.height).bodyR;
    if (def.secondary) this.secondary(def.secondary, dist, dirChest, eye, chest, head, dt);
    if (this.chargeUntil > this.t) return;
    if (this.t < this.cdPri || this.reloadEnd > 0) return;
    if (w.mag !== undefined && this.ammo <= 0) {
      this.reloadEnd = this.t + (w.reload ?? 1.5);
      return;
    }
    const inRange = w.kind === "melee" ? dist - bodyR <= w.range * 0.92 : dist <= Math.min(w.range, this.piece === "b" ? 90 : 55);
    if (!inRange) return;
    if (w.spinUp) {
      this.spin = Math.min(w.spinUp, this.spin + dt);
      this.firing = true;
      if (this.spin < w.spinUp) return;
    }
    this.cdPri = this.t + w.cooldown * this.tuning.cadence * (w.auto ? 1 : rand(1, 1.2));
    if (w.mag !== undefined) this.ammo--;
    this.firing = true;
    this.attack(w, dist, dirChest, eye, chest, head);
  }

  private abilities(dist: number, los: boolean, hpFrac: number, nx: number, nz: number, dt: number, tg: NetState, dirChest: V3, eye: V3) {
    const rate = dt * this.tuning.secondaryRate;
    const abs = this.def.abilities;
    const use = (slot: 0 | 1, to?: V3, dir?: V3) => {
      this.cdAb[slot] = this.t + abs[slot].cooldown * this.tuning.abilityDelay * rand(1, 1.15);
      this.push({ type: "ability", k: abs[slot].id, to, dir });
    };
    // Slot 0 (E): movement / defence
    if (this.t >= this.cdAb[0]) {
      const ab = abs[0];
      switch (ab.id) {
        case "bulwark":
          if (hpFrac < 0.75 && dist < 34 && los) {
            this.shieldT = ab.duration;
            use(0);
          }
          break;
        case "guard":
          if (hpFrac < 0.5 && los) {
            this.guardT = ab.duration;
            use(0);
          }
          break;
        case "dash":
          if (los && (dist > 18 || Math.random() < rate)) {
            const s = dist > 18 ? 1 : this.strafeTarget;
            const dx = dist > 18 ? nx : -nz * s;
            const dz = dist > 18 ? nz : nx * s;
            this.dashT = ab.duration;
            this.dashV = { x: (dx * 9) / ab.duration, z: (dz * 9) / ab.duration };
            use(0, undefined, [dx, 0, dz]);
          }
          break;
        case "slide":
          if (dist > 24 || (dist < 6 && Math.random() < rate * 3)) {
            const s = dist > 24 ? 1 : -1;
            this.dashT = ab.duration;
            this.dashV = { x: (nx * s * 16) / ab.duration, z: (nz * s * 16) / ab.duration };
            use(0, undefined, [nx * s, 0, nz * s]);
          }
          break;
        case "leap":
          if (dist > 12 && this.onGround) {
            this.vel.x = nx * 11.5;
            this.vel.z = nz * 11.5;
            this.vel.y = 10;
            this.onGround = false;
            this.leapT = ab.duration;
            use(0, undefined, [nx, 0, nz]);
          }
          break;
        case "blink":
          if (this.t > this.cdPri - 0.2 && (dist < 18 || Math.random() < rate)) {
            const f = dist < 10 ? -1 : 1;
            const s = this.strafeTarget;
            const bx = nx * f + -nz * s;
            const bz = nz * f + nx * s;
            const bl = Math.hypot(bx, bz) || 1;
            for (let i = 0; i < 34; i++) {
              const px = this.pos.x;
              const pz = this.pos.z;
              moveXZ(this.pos, ((bx / bl) * 10) / 34, ((bz / bl) * 10) / 34);
              if (Math.hypot(this.pos.x - px, this.pos.z - pz) < 0.2) break;
            }
            use(0, [this.pos.x, this.pos.y, this.pos.z]);
          }
          break;
      }
    }
    // Slot 1 (Q): signature ability
    if (this.t >= this.cdAb[1]) {
      const ab = abs[1];
      switch (ab.id) {
        case "promote":
          if (hpFrac < 0.65 && los) {
            this.promoteT = ab.duration;
            use(1);
          }
          break;
        case "stomp":
          if (los && dist < 6.2) {
            const f = clamp(1 - (dist / 6.5) * 0.7, 0.3, 1);
            this.push({ type: "hit", w: "n_stomp", z: "splash", f, c: !this.onGround, dir: norm([nx, 0.3, nz]) });
            use(1, [this.pos.x, this.pos.y, this.pos.z]);
          }
          break;
        case "mark":
          if (los && dist > 10) use(1);
          break;
        case "rampart":
          if (hpFrac < 0.85 && los && dist > 8 && dist < 34) {
            const c: V3 = [this.pos.x + nx * 4.6, 0, this.pos.z + nz * 4.6];
            use(1, c, [nx, 0, nz]);
          }
          break;
        case "barrage":
          if (los && dist > 9 && dist < 48) {
            const w = WEAPONS.q_barrage;
            const flight = dist / (w.speed ?? 34);
            for (let i = 0; i < 4; i++) {
              const at = i * 0.14;
              const d = applySpread(dirChest, w.spread / this.tuning.accuracy);
              this.pending.push({ due: this.t + at, ev: { type: "fire", w: w.id, o: eye, d } });
              if (Math.random() < 0.5 * this.tuning.accuracy) {
                this.pending.push({ due: this.t + at + flight, ev: { type: "hit", w: w.id, z: "body", dir: norm([dirChest[0], 0.2, dirChest[2]]) } });
              } else if (Math.random() < 0.5 * this.tuning.accuracy) {
                this.pending.push({ due: this.t + at + flight, ev: { type: "hit", w: w.id, z: "splash", f: rand(0.3, 0.7), dir: norm([dirChest[0], 0.2, dirChest[2]]) } });
              }
            }
            use(1);
          }
          break;
        case "shockwave":
          if (dist < 9.5 && los && Math.abs(tg.y - this.pos.y) < 4) {
            const f = clamp(1 - (dist / 10) * 0.7, 0.3, 1);
            this.push({ type: "hit", w: "k_shockwave", z: "splash", f, dir: norm([nx, 0.5, nz]) });
            use(1, [this.pos.x, this.pos.y, this.pos.z]);
          }
          break;
      }
    }
  }

  private secondary(w: WeaponDef, dist: number, dirChest: V3, eye: V3, chest: V3, head: V3, dt: number) {
    if (this.t < this.cdSec) return;
    const rate = dt * this.tuning.secondaryRate;
    if (w.chargeTime) {
      if (this.chargeUntil === 0 && dist < 70 && Math.random() < rate) {
        this.chargeUntil = this.t + w.chargeTime;
      } else if (this.chargeUntil > 0 && this.t >= this.chargeUntil) {
        this.chargeUntil = 0;
        this.cdSec = this.t + w.cooldown;
        this.attack(w, dist, dirChest, eye, chest, head);
      }
      return;
    }
    if (dist > 8 && dist < 70 && Math.random() < rate) {
      this.cdSec = this.t + w.cooldown * this.tuning.cadence * rand(1, 1.2);
      this.attack(w, dist, dirChest, eye, chest, head);
    }
  }

  private attack(w: WeaponDef, dist: number, dirChest: V3, eye: V3, chest: V3, head: V3) {
    const def = WEAPONS[w.id];
    if (!def) return;
    if (w.kind === "melee") {
      this.push({ type: "fire", w: w.id, o: eye, d: dirChest });
      const charged = !!w.chargedMult && (!this.onGround || this.dashT > 0 || this.sprinting || Math.hypot(this.vel.x, this.vel.z) > this.def.speed * 1.1);
      if (Math.random() < clamp(0.78 * this.tuning.accuracy, 0.2, 0.96)) {
        this.push({ type: "hit", w: w.id, z: "body", c: charged, dir: norm([dirChest[0], 0, dirChest[2]]) });
      }
      return;
    }
    if (w.kind === "projectile") {
      let d = dirChest;
      if ((w.gravity ?? 0) > 0) {
        const sp = w.speed ?? 40;
        const lift = (0.5 * (w.gravity ?? 0) * dist) / (sp * sp);
        d = norm([dirChest[0], dirChest[1] + lift, dirChest[2]]);
      }
      d = applySpread(d, 0.025 / this.tuning.accuracy);
      this.push({ type: "fire", w: w.id, o: eye, d });
      const flight = dist / (w.speed ?? 30);
      const roll = Math.random();
      const dirHit = norm([dirChest[0], 0.2, dirChest[2]]);
      if (roll < 0.5 * this.tuning.accuracy) this.pending.push({ due: this.t + flight, ev: { type: "hit", w: w.id, z: "body", dir: dirHit } });
      else if (roll < 0.75 * this.tuning.accuracy && w.splash)
        this.pending.push({ due: this.t + flight, ev: { type: "hit", w: w.id, z: "splash", f: rand(0.25, 0.7), dir: dirHit } });
      return;
    }
    // hitscan
    const spread = (w.spread * 1.5) / this.tuning.accuracy;
    const d = applySpread(dirChest, spread);
    const p = clamp((0.88 - dist / 120 - w.spread * 3) * this.tuning.accuracy, 0.05, 0.92);
    const hit = Math.random() < p;
    const headshot = hit && Math.random() < this.tuning.headshots * (w.auto ? 0.65 : 1);
    let end: V3;
    if (hit) end = headshot ? head : chest;
    else {
      const t = rayWorld(eye, d, w.range);
      const m = Math.min(t, dist + 6);
      end = [eye[0] + d[0] * m + rand(-1.2, 1.2), Math.max(0.1, eye[1] + d[1] * m + rand(-0.8, 0.8)), eye[2] + d[2] * m + rand(-1.2, 1.2)];
    }
    this.push({ type: "fire", w: w.id, o: eye, d: hit ? dirChest : d, e: end });
    if (hit) this.push({ type: "hit", w: w.id, z: headshot ? "head" : "body", dir: dirChest });
  }
}

export interface PracticeOptions {
  role: Role;
  myPiece: PieceType;
  oppPiece: PieceType;
  myColor: Color;
  oppColor: Color;
  mapId?: string;
  fightDifficulty?: Difficulty;
}

/** An in-browser transport: the fight room runs locally against a bot opponent (zero network latency). */
export function createPracticeTransport(o: PracticeOptions): Transport {
  setMap(o.mapId ?? "grand-board");
  const botRole: Role = o.role === "a" ? "d" : "a";
  const mine = { piece: o.myPiece, color: o.myColor };
  const theirs = { piece: o.oppPiece, color: o.oppColor };
  const init: RoomInit = o.role === "a" ? { a: mine, d: theirs } : { a: theirs, d: mine };
  const room = new FightRoom(init);
  room.bots.add(botRole);
  const bot = new FightBot(botRole, o.oppPiece, o.myPiece, o.fightDifficulty ?? "medium");
  let last = performance.now();
  let human: NetState | null = null;
  return async (req) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (req.state) human = req.state;
    const botReq = bot.step(dt, human, room.phase === "live", room.hp[botRole] / room.maxHp[botRole]);
    const botRes = room.sync(botRole, botReq);
    bot.receive(botRes.events);
    return room.sync(o.role, req);
  };
}

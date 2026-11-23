import type { Color, PieceType } from "@/lib/chess";
import {
  BULWARK_REDUCTION,
  COUNTDOWN_MS,
  FIGHT_DURATION_MS,
  MARK_DAMAGE,
  PIECES,
  PROMOTE_DAMAGE,
  PROMOTE_HEAL,
  UNDERDOG_DAMAGE,
  UNDERDOG_THRESHOLD,
  WEAPONS,
  type V3,
} from "./weapons";
import type { Role } from "./arena";

export type { Role };
export type Phase = "waiting" | "countdown" | "live" | "done" | "gone";

/** f flags: 1 bulwark, 2 royal guard, 4 aiming, 8 airborne, 16 firing, 32 promoted, 64 sprinting */
export interface NetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
}

export type ClientEvent = { cid: number } & (
  | { type: "fire"; w: string; o: V3; d: V3; e?: V3 }
  | { type: "hit"; w: string; z: "body" | "head" | "splash"; f?: number; c?: boolean; dir: V3 }
  | { type: "ability"; k: string; to?: V3; dir?: V3 }
);

export type ServerEvent = { id: number } & (
  | { type: "fire"; w: string; o: V3; d: V3; e?: V3 }
  | { type: "ability"; k: string; to?: V3; dir?: V3 }
  | { type: "damage"; amount: number; w: string; z: string; dir: V3; c?: boolean; blocked?: boolean }
);

export interface SyncRequest {
  state: NetState | null;
  events: ClientEvent[];
  ack: number;
  /** Monotonic request counter so late, out-of-order requests never overwrite newer positions. */
  seq?: number;
}

export interface SyncResponse {
  phase: Phase;
  countdownMs: number;
  timeLeftMs: number;
  opp: NetState | null;
  /** Server clock when `opp` was recorded; lets clients interpolate smoothly regardless of jitter. */
  oppTime?: number;
  serverTime?: number;
  events: ServerEvent[];
  hp: Record<Role, number>;
  maxHp: Record<Role, number>;
  winner?: Role;
  reason?: string;
}

export interface RoomInit {
  a: { piece: PieceType; color: Color };
  d: { piece: PieceType; color: Color };
}

const JOIN_TIMEOUT_MS = 90_000;
const DISCONNECT_MS = 10_000;

const other = (r: Role): Role => (r === "a" ? "d" : "a");
const finite = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const vec = (v: unknown): V3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [v[0], v[1], v[2]]
    : undefined;

export class FightRoom {
  phase: Phase = "waiting";
  createdAt: number;
  liveAt = 0;
  endsAt = 0;
  winner?: Role;
  reason?: string;
  bots = new Set<Role>();

  hp: Record<Role, number>;
  maxHp: Record<Role, number>;
  private states: Record<Role, NetState | null> = { a: null, d: null };
  private stateTime: Record<Role, number> = { a: 0, d: 0 };
  private lastSeq: Record<Role, number> = { a: 0, d: 0 };
  private lastSeen: Record<Role, number> = { a: 0, d: 0 };
  private lastCid: Record<Role, number> = { a: 0, d: 0 };
  private inbox: Record<Role, ServerEvent[]> = { a: [], d: [] };
  private nextId = 1;
  private shieldUntil: Record<Role, number> = { a: 0, d: 0 };
  private guardUntil: Record<Role, number> = { a: 0, d: 0 };
  private ampUntil: Record<Role, number> = { a: 0, d: 0 };
  private markedUntil: Record<Role, number> = { a: 0, d: 0 };
  private abilityReady: Record<Role, Record<string, number>> = { a: {}, d: {} };
  private lastHit: Record<Role, Record<string, number>> = { a: {}, d: {} };

  constructor(
    public init: RoomInit,
    now = Date.now(),
  ) {
    this.createdAt = now;
    this.maxHp = { a: PIECES[init.a.piece].hp, d: PIECES[init.d.piece].hp };
    this.hp = { ...this.maxHp };
  }

  private piece(r: Role): PieceType {
    return this.init[r].piece;
  }

  private push(to: Role, ev: Omit<ServerEvent, "id"> & Record<string, unknown>) {
    this.inbox[to].push({ ...ev, id: this.nextId++ } as ServerEvent);
    if (this.inbox[to].length > 200) this.inbox[to].splice(0, this.inbox[to].length - 200);
  }

  private finish(winner: Role, reason: string) {
    if (this.phase === "done") return;
    this.phase = "done";
    this.winner = winner;
    this.reason = reason;
  }

  private present(r: Role): boolean {
    return this.bots.has(r) || this.lastSeen[r] > 0;
  }

  private tick(now: number) {
    if (this.phase === "waiting") {
      if (this.present("a") && this.present("d")) {
        this.phase = "countdown";
        this.liveAt = now + COUNTDOWN_MS;
      } else if (now - this.createdAt > JOIN_TIMEOUT_MS) {
        if (this.present("a")) this.finish("a", "Opponent never showed up");
        else if (this.present("d")) this.finish("d", "Opponent never showed up");
        else this.finish("d", "Fight abandoned");
      }
    }
    if (this.phase === "countdown" && now >= this.liveAt) {
      this.phase = "live";
      this.endsAt = now + FIGHT_DURATION_MS;
    }
    // Solo rooms (a bot opponent, simulated in the player's own browser) never time anyone out:
    // a slow frame or a backgrounded tab must not forfeit the fight.
    if ((this.phase === "countdown" || this.phase === "live") && this.bots.size === 0) {
      for (const r of ["a", "d"] as Role[]) {
        if (!this.bots.has(r) && now - this.lastSeen[r] > DISCONNECT_MS) {
          this.finish(other(r), "Opponent disconnected");
          return;
        }
      }
    }
    if (this.phase === "live" && now >= this.endsAt) {
      const pa = this.hp.a / this.maxHp.a;
      const pd = this.hp.d / this.maxHp.d;
      if (pa > pd) this.finish("a", "Time up — attacker had more health");
      else this.finish("d", pa === pd ? "Time up — the defender holds on a tie" : "Time up — defender had more health");
    }
  }

  private handleHit(role: Role, ev: Extract<ClientEvent, { type: "hit" }>, now: number) {
    const def = WEAPONS[ev.w];
    if (!def || def.owner !== this.piece(role)) return;
    const last = this.lastHit[role][def.id] ?? 0;
    if (now - last < def.cooldown * 1000 * 0.4) return;
    this.lastHit[role][def.id] = now;

    let dmg = def.damage;
    if (ev.z === "head" && def.kind !== "melee") dmg *= def.headMult;
    else if (ev.z === "splash") dmg = (def.splashDamage ?? def.damage * 0.8) * Math.max(0.15, Math.min(1, finite(ev.f, 0.3)));
    if (ev.c && def.chargedMult) dmg *= def.chargedMult;
    if (this.piece(role) === "p" && this.hp[role] < UNDERDOG_THRESHOLD * this.maxHp[role]) dmg *= UNDERDOG_DAMAGE;
    if (now < this.ampUntil[role]) dmg *= PROMOTE_DAMAGE;

    const victim = other(role);
    if (now < this.markedUntil[victim]) dmg *= MARK_DAMAGE;
    let blocked = false;
    if (now < this.guardUntil[victim] + 100) {
      dmg = 0;
      blocked = true;
    } else if (now < this.shieldUntil[victim] + 100) {
      dmg *= BULWARK_REDUCTION;
      blocked = true;
    }
    dmg = Math.round(dmg * 10) / 10;
    this.hp[victim] = Math.max(0, Math.round((this.hp[victim] - dmg) * 10) / 10);
    const dir: V3 = vec(ev.dir) ?? [0, 0, 0];
    this.push(victim, { type: "damage", amount: dmg, w: def.id, z: ev.z, dir, c: !!ev.c, blocked });
    if (this.hp[victim] <= 0) this.finish(role, "Knockout");
  }

  private handleAbility(role: Role, ev: Extract<ClientEvent, { type: "ability" }>, now: number) {
    const ab = PIECES[this.piece(role)].abilities.find((a) => a.id === ev.k);
    if (!ab) return;
    const ready = this.abilityReady[role][ab.id] ?? 0;
    if (now < ready - 250) return;
    this.abilityReady[role][ab.id] = now + ab.cooldown * 1000;
    const victim = other(role);
    switch (ab.id) {
      case "bulwark":
        this.shieldUntil[role] = now + ab.duration * 1000;
        break;
      case "guard":
        this.guardUntil[role] = now + ab.duration * 1000;
        break;
      case "promote":
        this.hp[role] = Math.min(this.maxHp[role], this.hp[role] + PROMOTE_HEAL);
        this.ampUntil[role] = now + ab.duration * 1000;
        break;
      case "mark":
        this.markedUntil[victim] = now + ab.duration * 1000;
        break;
      default:
        break;
    }
    this.push(victim, { type: "ability", k: ab.id, to: vec(ev.to), dir: vec(ev.dir) });
  }

  sync(role: Role, req: SyncRequest, now = Date.now()): SyncResponse {
    if (this.phase !== "done") {
      this.lastSeen[role] = now;
      const s = req.state;
      const seq = typeof req.seq === "number" ? req.seq : this.lastSeq[role] + 1;
      if (s && seq > this.lastSeq[role]) {
        this.lastSeq[role] = seq;
        this.states[role] = {
          x: finite(s.x),
          y: finite(s.y),
          z: finite(s.z),
          yaw: finite(s.yaw),
          pitch: finite(s.pitch),
          f: finite(s.f) | 0,
        };
        this.stateTime[role] = now;
      }
    }
    this.tick(now);

    const events = [...(req.events ?? [])].sort((x, y) => x.cid - y.cid);
    for (const ev of events) {
      if (ev.cid <= this.lastCid[role]) continue;
      this.lastCid[role] = ev.cid;
      if (this.phase !== "live") continue;
      if (ev.type === "hit") this.handleHit(role, ev, now);
      else if (ev.type === "ability") this.handleAbility(role, ev, now);
      else if (ev.type === "fire") {
        const o = vec(ev.o);
        const d = vec(ev.d);
        if (o && d) this.push(other(role), { type: "fire", w: ev.w, o, d, e: vec(ev.e) });
      }
    }
    this.tick(now);

    const ack = finite(req.ack);
    this.inbox[role] = this.inbox[role].filter((e) => e.id > ack);

    const opp = other(role);
    return {
      phase: this.phase,
      countdownMs: this.phase === "countdown" ? Math.max(0, this.liveAt - now) : 0,
      timeLeftMs:
        this.phase === "live"
          ? Math.max(0, this.endsAt - now)
          : this.phase === "waiting" || this.phase === "countdown"
            ? FIGHT_DURATION_MS
            : 0,
      opp: this.states[opp],
      oppTime: this.stateTime[opp],
      serverTime: now,
      events: this.inbox[role].slice(),
      hp: { ...this.hp },
      maxHp: { ...this.maxHp },
      winner: this.winner,
      reason: this.reason,
    };
  }
}

import { hitShape, type V3 } from "./weapons";
import { MAPS, getMapDef, type Box, type MapDef } from "./maps";

export type { Box, MapDef };
export type Role = "a" | "d";

export const PLAYER_RADIUS = 0.45;
export const GRAVITY = 24;

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export type ExtraBox = Box & { id: number };

// Physics always runs against the "active" map. A browser only ever simulates one duel at a time.
let active: MapDef = MAPS[0];
const extras: ExtraBox[] = [];

export const getMap = () => active;

export function setMap(id: string): MapDef {
  active = getMapDef(id);
  extras.length = 0;
  return active;
}

export const spawnFor = (role: Role) => active.spawns[role];

/** Temporary solid boxes (e.g. the Rook's Rampart). */
export function addExtraBox(b: ExtraBox) {
  extras.push(b);
}
export function removeExtraBox(id: number) {
  const i = extras.findIndex((e) => e.id === id);
  if (i >= 0) extras.splice(i, 1);
}
export function clearExtraBoxes() {
  extras.length = 0;
}

const allBoxes = (): Box[] => (extras.length ? active.boxes.concat(extras) : active.boxes);

function overlaps(b: Box, x: number, z: number, y: number): boolean {
  return b.h > y + 0.35 && Math.abs(x - b.x) < b.hx + PLAYER_RADIUS && Math.abs(z - b.z) < b.hz + PLAYER_RADIUS;
}

function blocked(x: number, z: number, y: number): boolean {
  for (const b of active.boxes) if (overlaps(b, x, z, y)) return true;
  for (const b of extras) if (overlaps(b, x, z, y)) return true;
  return false;
}

export function groundAt(x: number, z: number, y: number): number {
  let g = 0;
  for (const b of allBoxes()) {
    if (
      y >= b.h - 0.35 &&
      Math.abs(x - b.x) < b.hx + PLAYER_RADIUS * 0.6 &&
      Math.abs(z - b.z) < b.hz + PLAYER_RADIUS * 0.6
    ) {
      g = Math.max(g, b.h);
    }
  }
  return g;
}

/** If a wall appears on top of someone, push them out instead of trapping them. */
function depenetrate(p: Pos) {
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const b of allBoxes()) {
      if (!overlaps(b, p.x, p.z, p.y)) continue;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const ox = b.hx + PLAYER_RADIUS - Math.abs(dx);
      const oz = b.hz + PLAYER_RADIUS - Math.abs(dz);
      if (ox < oz) p.x += (dx >= 0 ? 1 : -1) * (ox + 0.02);
      else p.z += (dz >= 0 ? 1 : -1) * (oz + 0.02);
      moved = true;
    }
    if (!moved) break;
  }
}

/** Move on the XZ plane with sub-stepping and wall sliding. Returns true when fully unobstructed. */
export function moveXZ(p: Pos, dx: number, dz: number): boolean {
  if (extras.length && blocked(p.x, p.z, p.y)) depenetrate(p);
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  const sx = dx / steps;
  const sz = dz / steps;
  const limX = active.halfX - PLAYER_RADIUS;
  const limZ = active.halfZ - PLAYER_RADIUS;
  let free = true;
  for (let i = 0; i < steps; i++) {
    const nx = Math.max(-limX, Math.min(limX, p.x + sx));
    if (blocked(nx, p.z, p.y)) free = false;
    else p.x = nx;
    const nz = Math.max(-limZ, Math.min(limZ, p.z + sz));
    if (blocked(p.x, nz, p.y)) free = false;
    else p.z = nz;
  }
  return free;
}

// ---- Ray helpers ----

export function rayAABB(o: V3, d: V3, min: V3, max: V3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : null;
}

/** Distance at which a ray leaves the arena volume (walls + floor). */
export function rayArena(o: V3, d: V3): number {
  const HX = active.halfX;
  const HZ = active.halfZ;
  let t = Infinity;
  if (d[0] > 1e-9) t = Math.min(t, (HX - o[0]) / d[0]);
  if (d[0] < -1e-9) t = Math.min(t, (-HX - o[0]) / d[0]);
  if (d[2] > 1e-9) t = Math.min(t, (HZ - o[2]) / d[2]);
  if (d[2] < -1e-9) t = Math.min(t, (-HZ - o[2]) / d[2]);
  if (d[1] < -1e-9) t = Math.min(t, -o[1] / d[1]);
  return Math.max(0, t);
}

/** Distance to the first cover/wall/floor hit along the ray (never Infinity). */
export function rayWorld(o: V3, d: V3, maxDist: number): number {
  let best = Math.min(maxDist, rayArena(o, d));
  for (const b of allBoxes()) {
    const t = rayAABB(o, d, [b.x - b.hx, 0, b.z - b.hz], [b.x + b.hx, b.h, b.z + b.hz]);
    if (t !== null && t < best) best = t;
  }
  return best;
}

function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = -b - s;
  if (t1 >= 0) return t1;
  const t2 = -b + s;
  return t2 >= 0 ? t2 : null;
}

function rayCylinder(o: V3, d: V3, cx: number, cz: number, r: number, y0: number, y1: number): number | null {
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-9) return null;
  const ox = o[0] - cx;
  const oz = o[2] - cz;
  const b = 2 * (ox * d[0] + oz * d[2]);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t < 0) continue;
    const y = o[1] + d[1] * t;
    if (y >= y0 && y <= y1) return t;
  }
  return null;
}

export interface Target {
  x: number;
  y: number;
  z: number;
  height: number;
}

export function rayTarget(o: V3, d: V3, maxDist: number, t: Target): { dist: number; zone: "head" | "body" } | null {
  const s = hitShape(t.height);
  const th = raySphere(o, d, [t.x, t.y + s.headY, t.z], s.headR);
  const tb = rayCylinder(o, d, t.x, t.z, s.bodyR, t.y, t.y + s.bodyTop);
  const headOk = th !== null && th <= maxDist;
  const bodyOk = tb !== null && tb <= maxDist;
  if (headOk && (!bodyOk || th! <= tb! + 0.05)) return { dist: th!, zone: "head" };
  if (bodyOk) return { dist: tb!, zone: "body" };
  return null;
}

export function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function dirFromAngles(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Random direction within a cone around `d`. */
export function applySpread(d: V3, spread: number): V3 {
  if (spread <= 0) return d;
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * spread;
  const up: V3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const rx: V3 = norm([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
  const ry: V3 = [d[1] * rx[2] - d[2] * rx[1], d[2] * rx[0] - d[0] * rx[2], d[0] * rx[1] - d[1] * rx[0]];
  const ox = Math.cos(ang) * Math.tan(rad);
  const oy = Math.sin(ang) * Math.tan(rad);
  return norm([d[0] + rx[0] * ox + ry[0] * oy, d[1] + rx[1] * ox + ry[1] * oy, d[2] + rx[2] * ox + ry[2] * oy]);
}

/** Wall footprint for the Rook's Rampart, derived identically on both clients from (position, facing). */
export function rampartBox(to: V3, dir: V3): Box {
  const alongX = Math.abs(dir[0]) > Math.abs(dir[2]);
  // Facing along X => wall spans Z, and vice-versa.
  return alongX
    ? { x: to[0], z: to[2], hx: 0.55, hz: 3.6, h: 3.4, k: "tall" }
    : { x: to[0], z: to[2], hx: 3.6, hz: 0.55, h: 3.4, k: "tall" };
}

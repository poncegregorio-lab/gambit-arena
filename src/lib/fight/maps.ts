export interface Box {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  k?: "tall" | "low" | "stair" | "deck";
}

export type FloorKind = "chess" | "tiles" | "grid" | "sand" | "ice";
export type DecorKind = "statues" | "towers" | "neon" | "crystals" | "columns";

export interface MapTheme {
  sky: [string, string, string];
  fog: number;
  fogNear: number;
  fogFar: number;
  floor: FloorKind;
  floorA: string;
  floorB: string;
  floorLine: string;
  wall: number;
  trim: number;
  trim2: number;
  tall: number;
  low: number;
  deck: number;
  stair: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunPower: number;
  sunPos: [number, number, number];
  exposure: number;
  decor: DecorKind;
  glow: boolean;
  preview: { floor: string; tall: string; low: string; deck: string };
}

export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  halfX: number;
  halfZ: number;
  wallH: number;
  boxes: Box[];
  spawns: { a: { x: number; z: number; yaw: number }; d: { x: number; z: number; yaw: number } };
  theme: MapTheme;
}

const B = (x: number, z: number, hx: number, hz: number, h: number, k?: Box["k"]): Box => ({
  x,
  z,
  hx,
  hz,
  h,
  k: k ?? (h > 2 ? "tall" : "low"),
});

const STEP_H = 0.3;
const TREAD = 0.9;

/** A flight of walkable stairs (0.3 m rises are inside the 0.35 m step-up of the player controller). */
function stairs(x: number, z: number, dir: "+x" | "-x" | "+z" | "-z", steps: number, half: number): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * STEP_H;
    const c = (i + 0.5) * TREAD;
    if (dir === "+x") out.push({ x: x + c, z, hx: TREAD / 2, hz: half, h, k: "stair" });
    else if (dir === "-x") out.push({ x: x - c, z, hx: TREAD / 2, hz: half, h, k: "stair" });
    else if (dir === "+z") out.push({ x, z: z + c, hx: half, hz: TREAD / 2, h, k: "stair" });
    else out.push({ x, z: z - c, hx: half, hz: TREAD / 2, h, k: "stair" });
  }
  return out;
}

// Every layout is point-symmetric so neither side of the duel has a positional advantage.
const mirror = (half: Box[]): Box[] => [...half, ...half.map((b) => ({ ...b, x: -b.x, z: -b.z }))];

function spawns(halfZ: number) {
  return {
    a: { x: 0, z: -(halfZ - 6), yaw: Math.PI },
    d: { x: 0, z: halfZ - 6, yaw: 0 },
  };
}

// ---------------------------------------------------------------- Grand Board
const grandHalf: Box[] = [
  B(-22, -26, 3, 3, 6),
  B(22, -22, 2.2, 2.2, 4.2),
  B(-10, -16, 6, 0.8, 3.4),
  B(12, -11, 0.8, 6, 3.4),
  B(0, -26, 4.5, 0.7, 1.2),
  B(-17, -33, 1.6, 1.6, 1.2),
  B(17, -33, 1.6, 1.6, 1.2),
  B(27, -16, 1.2, 3.2, 1.2),
  B(-7, -6, 1.2, 1.2, 2.6),
  B(6, -8, 1.2, 1.2, 2.6),
  B(-13, -4, 3, 0.6, 1.2),
  ...stairs(-27, -17, "+z", 8, 2),
  B(-27, -5.8, 5, 4, 2.4, "deck"),
];

// ------------------------------------------------------------ Castle Courtyard
const castleHalf: Box[] = [
  B(-24, -35, 3.5, 3.5, 7),
  B(-14, -26, 7, 0.7, 3.2),
  B(14, -22, 0.7, 5, 3.2),
  B(-6, -14, 0.8, 3, 3.2),
  B(0, -32, 3, 0.6, 1.2),
  B(-12, -38, 1, 1, 1.2),
  B(12, -38, 1, 1, 1.2),
  B(-20, -20, 1.2, 1.2, 1.2),
  B(22, -14, 1.2, 1.2, 1.2),
  B(-24, -8, 5, 0.6, 1.2),
  B(24, -30, 1.2, 4, 3.2),
  ...stairs(0, -16.2, "+z", 8, 2.5),
];

// ------------------------------------------------------------------- Neon Grid
const neonHalf: Box[] = [
  B(0, -14, 15, 2, 2.4, "deck"),
  ...stairs(-22.2, -14, "+x", 8, 2),
  B(-9, -5, 1, 1, 4.5),
  B(9, -6, 1, 1, 4.5),
  B(-20, -22, 1.2, 1.2, 5),
  B(20, -24, 1.2, 1.2, 5),
  B(-5, -22, 0.7, 3, 2.6),
  B(7, -20, 3, 0.7, 2.6),
  B(-26, -8, 2, 2, 1.2),
  B(25, -10, 2, 2, 1.2),
  B(0, -24, 2.5, 0.6, 1.2),
];

// -------------------------------------------------------------- Frozen Citadel
const frozenHalf: Box[] = [
  B(-22, -24, 1.6, 1.6, 6.5),
  B(24, -20, 1.4, 1.4, 5.5),
  B(-8, -27, 1.2, 1.2, 5),
  B(10, -27, 1.2, 1.2, 5),
  B(-14, -12, 4, 3, 0.9, "low"),
  B(16, -9, 3.5, 3, 0.9, "low"),
  B(-30, -15, 2.5, 2.5, 1.2),
  B(30, -26, 2, 2, 1.2),
  B(-4, -16, 0.9, 4, 3),
  B(5, -8, 3, 0.9, 3),
  ...stairs(-19.2, 0, "+x", 8, 2),
];

// ------------------------------------------------------------ Sandstone Ruins
const ruinsHalf: Box[] = [
  B(-22, -26, 0.9, 0.9, 6),
  B(-18, -26, 0.9, 0.9, 6),
  B(16, -24, 5, 0.8, 2.6),
  B(-10, -18, 0.8, 5, 2.6),
  B(4, -14, 3, 0.8, 1.2),
  B(-26, -10, 3, 0.8, 3.6),
  B(24, -8, 0.8, 3, 1.2),
  B(-14, -30, 2, 2, 1.2),
  B(12, -31, 2, 2, 2.4),
  ...stairs(-13.2, 0, "+x", 8, 2.5),
];

export const MAPS: MapDef[] = [
  {
    id: "grand-board",
    name: "Grand Board",
    tagline: "A giant chessboard ringed by stone statues. Balanced cover, one raised deck per side.",
    halfX: 34,
    halfZ: 42,
    wallH: 8,
    boxes: [B(0, 0, 3.5, 3.5, 5.2), ...mirror(grandHalf)],
    spawns: spawns(42),
    theme: {
      sky: ["#070b18", "#25304f", "#55527a"],
      fog: 0x2e3658, fogNear: 60, fogFar: 190,
      floor: "chess", floorA: "#dfe5ee", floorB: "#62759a", floorLine: "rgba(0,0,0,0.12)",
      wall: 0x4a5473, trim: 0xf5b942, trim2: 0xf5b942,
      tall: 0x6a77a0, low: 0xc2a468, deck: 0x7c88b3, stair: 0x8f9bc4,
      hemiSky: 0xc4d0ff, hemiGround: 0x3a3a50, hemi: 1.5,
      sun: 0xfff0d6, sunPower: 2.6, sunPos: [26, 44, 16], exposure: 1.05,
      decor: "statues", glow: false,
      preview: { floor: "#8fa0c0", tall: "#6a77a0", low: "#c2a468", deck: "#9aa6cf" },
    },
  },
  {
    id: "castle",
    name: "Castle Courtyard",
    tagline: "A long fortress yard with towers, battlements and a central keep to storm.",
    halfX: 32,
    halfZ: 46,
    wallH: 9,
    boxes: [B(0, 0, 9, 9, 2.4, "deck"), B(0, 0, 1.6, 1.6, 6.5), ...mirror(castleHalf)],
    spawns: spawns(46),
    theme: {
      sky: ["#10131f", "#3b4766", "#b0805a"],
      fog: 0x4a4a5e, fogNear: 55, fogFar: 175,
      floor: "tiles", floorA: "#9a948a", floorB: "#827c72", floorLine: "rgba(30,25,20,0.45)",
      wall: 0x716b62, trim: 0xb8873a, trim2: 0x8a2b2b,
      tall: 0x8a8478, low: 0x7a6650, deck: 0x9b9486, stair: 0xa59e90,
      hemiSky: 0xffe0b8, hemiGround: 0x4a4038, hemi: 1.4,
      sun: 0xffd9a0, sunPower: 2.8, sunPos: [-28, 36, 20], exposure: 1.05,
      decor: "towers", glow: false,
      preview: { floor: "#8c867c", tall: "#8a8478", low: "#7a6650", deck: "#a59e90" },
    },
  },
  {
    id: "neon-grid",
    name: "Neon Grid",
    tagline: "A glowing cyber arena. Long catwalks and tall pylons reward flanking.",
    halfX: 38,
    halfZ: 38,
    wallH: 8,
    boxes: [
      B(0, 0, 3, 3, 1.2, "low"),
      B(2.5, 2.5, 0.5, 0.5, 5),
      B(-2.5, -2.5, 0.5, 0.5, 5),
      B(2.5, -2.5, 0.5, 0.5, 5),
      B(-2.5, 2.5, 0.5, 0.5, 5),
      ...mirror(neonHalf),
    ],
    spawns: spawns(38),
    theme: {
      sky: ["#04020c", "#150a33", "#33106b"],
      fog: 0x120a2c, fogNear: 45, fogFar: 150,
      floor: "grid", floorA: "#0a0c1a", floorB: "#12142a", floorLine: "#22d3ee",
      wall: 0x161a34, trim: 0xff2bd6, trim2: 0x22d3ee,
      tall: 0x20254d, low: 0x2c3170, deck: 0x2a2f66, stair: 0x3a4090,
      hemiSky: 0x8aa0ff, hemiGround: 0x20143a, hemi: 1.2,
      sun: 0xb8a8ff, sunPower: 1.7, sunPos: [10, 40, -14], exposure: 1.15,
      decor: "neon", glow: true,
      preview: { floor: "#101326", tall: "#2f3680", low: "#3a3f8f", deck: "#ff2bd6" },
    },
  },
  {
    id: "frozen",
    name: "Frozen Citadel",
    tagline: "Icy pillars and snow drifts around a central bridge. Wide, open and unforgiving.",
    halfX: 38,
    halfZ: 38,
    wallH: 8,
    boxes: [B(0, 0, 12, 2, 2.4, "deck"), B(0, 0, 0.8, 0.8, 6), ...mirror(frozenHalf)],
    spawns: spawns(38),
    theme: {
      sky: ["#0b1a2e", "#4a79a8", "#cfe6f5"],
      fog: 0x9cc0d8, fogNear: 50, fogFar: 160,
      floor: "ice", floorA: "#d6ecf7", floorB: "#b4d6ea", floorLine: "rgba(255,255,255,0.7)",
      wall: 0x9fc3dc, trim: 0xe8f6ff, trim2: 0x5ab4ff,
      tall: 0x9ccbe8, low: 0xeaf4fb, deck: 0xb9ddf0, stair: 0xcbe7f6,
      hemiSky: 0xd8ecff, hemiGround: 0x7a9cb8, hemi: 1.8,
      sun: 0xeaf4ff, sunPower: 2.4, sunPos: [20, 46, -22], exposure: 1.1,
      decor: "crystals", glow: false,
      preview: { floor: "#b9dcee", tall: "#8cc0e2", low: "#f0f8fd", deck: "#c6e6f6" },
    },
  },
  {
    id: "ruins",
    name: "Sandstone Ruins",
    tagline: "Broken walls and columns under a desert sun, with a raised temple at the centre.",
    halfX: 36,
    halfZ: 40,
    wallH: 8,
    boxes: [
      B(0, 0, 6, 6, 2.4, "deck"),
      B(-5, -5, 0.7, 0.7, 6.4),
      B(5, -5, 0.7, 0.7, 6.4),
      B(-5, 5, 0.7, 0.7, 6.4),
      B(5, 5, 0.7, 0.7, 6.4),
      ...mirror(ruinsHalf),
    ],
    spawns: spawns(40),
    theme: {
      sky: ["#2a1a10", "#b0703c", "#f6cf8e"],
      fog: 0xc79a64, fogNear: 50, fogFar: 170,
      floor: "sand", floorA: "#d8bd8a", floorB: "#c8a672", floorLine: "rgba(120,80,30,0.25)",
      wall: 0xa88a5f, trim: 0x7a5a2e, trim2: 0xc0392b,
      tall: 0xc8a977, low: 0xb59462, deck: 0xd2b583, stair: 0xdcc08e,
      hemiSky: 0xffe6c0, hemiGround: 0x8a6a40, hemi: 1.6,
      sun: 0xffe2b0, sunPower: 3.0, sunPos: [-20, 34, 26], exposure: 1.05,
      decor: "columns", glow: false,
      preview: { floor: "#cfb07c", tall: "#c8a977", low: "#b59462", deck: "#dcc08e" },
    },
  },
];

export const MAP_IDS = MAPS.map((m) => m.id);

export function getMapDef(id: string | undefined | null): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function isMapChoice(v: unknown): v is string {
  return typeof v === "string" && (v === "random" || MAP_IDS.includes(v));
}

/** Resolve a game's map preference to a concrete map; `seed` makes "random" stable per fight. */
export function pickMap(pref: string | undefined | null, seed: string): string {
  if (pref && MAP_IDS.includes(pref)) return pref;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return MAP_IDS[Math.abs(h) % MAP_IDS.length];
}

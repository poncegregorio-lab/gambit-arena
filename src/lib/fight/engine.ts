import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Color, PieceType } from "@/lib/chess";
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
import {
  GRAVITY,
  addExtraBox,
  applySpread,
  clearExtraBoxes,
  dirFromAngles,
  groundAt,
  moveXZ,
  norm,
  rampartBox,
  rayArena,
  rayTarget,
  rayWorld,
  removeExtraBox,
  setMap,
  spawnFor,
  type Target,
} from "./arena";
import type { MapDef, MapTheme } from "./maps";
import { buildAvatar, buildPieceBody, buildWeaponModel, poseArm, type Avatar, type WeaponModel } from "./models";
import { initAudio, sfx, type SfxKind } from "./sfx";
import type { ClientEvent, NetState, Phase, Role, ServerEvent, SyncRequest, SyncResponse } from "./room";

export type Transport = (req: SyncRequest) => Promise<SyncResponse | null>;

export interface HudState {
  phase: Phase;
  countdown: number;
  timeLeft: number;
  myHp: number;
  myMax: number;
  oppHp: number;
  oppMax: number;
  ammo: number | null;
  mag: number | null;
  reload: number;
  priCd: number;
  secCd: number;
  abilities: { cd: number; active: number }[];
  charge: number;
  locked: boolean;
  scoped: boolean;
  aiming: boolean;
  sprinting: boolean;
  marked: boolean;
  xray: boolean;
  hitAt: number;
  hitKind: "body" | "head";
  hurtAt: number;
  hurtAngle: number;
  winner?: Role;
  reason?: string;
  finished: boolean;
  connected: boolean;
  ping: number;
  inArena: boolean;
  fps: number;
  pointerFallback: boolean;
  quality: "auto" | "high" | "low";
  radar: { x: number; z: number; yaw: number; ox: number; oz: number; showOpp: boolean };
}

export interface EngineOptions {
  container: HTMLElement;
  role: Role;
  myPiece: PieceType;
  oppPiece: PieceType;
  myColor: Color;
  oppColor: Color;
  mapId: string;
  transport: Transport;
  onHud: (h: HudState) => void;
}

interface WS {
  cd: number;
  ammo: number;
  reloadEnd: number;
  reloadStart: number;
  spin: number;
  charge: number;
}

interface Fx {
  obj: THREE.Object3D;
  life: number;
  max: number;
  tick?: (f: number) => void;
  dispose?: () => void;
}

interface Proj {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  w: WeaponDef;
  local: boolean;
  life: number;
}

interface Wall {
  id: number;
  mesh: THREE.Mesh;
  born: number;
  until: number;
  h: number;
  mat: THREE.MeshStandardMaterial;
}

interface Snap {
  t: number;
  s: NetState;
}

const FIRE_SFX: Record<string, SfxKind> = {
  p_pistol: "pistol",
  n_lance: "lance",
  n_javelin: "javelin",
  b_rifle: "sniper",
  r_chaingun: "chaingun",
  q_carbine: "rifle",
  q_rocket: "rocket",
  q_barrage: "barrage",
  k_scepter: "rifle",
  k_decree: "rail",
};

const TRACER: Record<string, { color: number; thick: number; life: number }> = {
  p_pistol: { color: 0xfff2b0, thick: 0.02, life: 0.07 },
  b_rifle: { color: 0xbfeaff, thick: 0.04, life: 0.18 },
  r_chaingun: { color: 0xffb35c, thick: 0.025, life: 0.06 },
  q_carbine: { color: 0xf5a3ff, thick: 0.022, life: 0.07 },
  k_scepter: { color: 0x67e8f9, thick: 0.05, life: 0.1 },
  k_decree: { color: 0xfff6c2, thick: 0.16, life: 0.55 },
};

const VM: Record<PieceType, { pos: V3; rot: V3; scale: number }> = {
  p: { pos: [0.19, -0.17, -0.55], rot: [0, 0, 0], scale: 0.95 },
  n: { pos: [0.3, -0.27, -0.5], rot: [0.04, 0.05, 0], scale: 0.38 },
  b: { pos: [0.17, -0.17, -0.6], rot: [0, 0, 0], scale: 0.62 },
  r: { pos: [0.2, -0.2, -0.65], rot: [0, 0, 0], scale: 0.62 },
  q: { pos: [0.18, -0.18, -0.6], rot: [0, 0, 0], scale: 0.68 },
  k: { pos: [0.2, -0.19, -0.65], rot: [0, 0, 0], scale: 0.58 },
};

const BASE_FOV = 78;
const SENS = 0.0022;
const INTERP_MS = 110;
const NET_INTERVAL = 40;
const MAX_INFLIGHT = 3;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function flashTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,220,140,0.9)");
  g.addColorStop(1, "rgba(255,160,40,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function floorTexture(th: MapTheme): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const r = rng(7);
  switch (th.floor) {
    case "chess":
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          x.fillStyle = (i + j) % 2 === 0 ? th.floorA : th.floorB;
          x.fillRect(i * 256, j * 256, 256, 256);
        }
      x.strokeStyle = th.floorLine;
      x.lineWidth = 3;
      x.strokeRect(1, 1, S - 2, S - 2);
      x.beginPath();
      x.moveTo(256, 0);
      x.lineTo(256, S);
      x.moveTo(0, 256);
      x.lineTo(S, 256);
      x.stroke();
      break;
    case "tiles":
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          x.fillStyle = r() > 0.5 ? th.floorA : th.floorB;
          x.fillRect(i * 128, j * 128, 128, 128);
          x.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
          x.fillRect(i * 128, j * 128, 128, 128);
        }
      x.strokeStyle = th.floorLine;
      x.lineWidth = 4;
      for (let i = 0; i <= 4; i++) {
        x.beginPath();
        x.moveTo(i * 128, 0);
        x.lineTo(i * 128, S);
        x.moveTo(0, i * 128);
        x.lineTo(S, i * 128);
        x.stroke();
      }
      break;
    case "grid":
      x.fillStyle = th.floorA;
      x.fillRect(0, 0, S, S);
      x.fillStyle = th.floorB;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) x.fillRect(i * 128, j * 128, 128, 128);
      x.strokeStyle = th.floorLine;
      x.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        x.beginPath();
        x.moveTo(i * 128 + 1, 0);
        x.lineTo(i * 128 + 1, S);
        x.moveTo(0, i * 128 + 1);
        x.lineTo(S, i * 128 + 1);
        x.stroke();
      }
      break;
    case "sand":
      x.fillStyle = th.floorA;
      x.fillRect(0, 0, S, S);
      for (let i = 0; i < 6000; i++) {
        x.fillStyle = r() > 0.5 ? th.floorB : "rgba(255,255,255,0.18)";
        x.fillRect(r() * S, r() * S, 2, 2);
      }
      x.strokeStyle = th.floorLine;
      x.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        x.beginPath();
        const y = (i + 0.5) * (S / 9);
        x.moveTo(0, y);
        x.bezierCurveTo(S * 0.3, y - 14, S * 0.6, y + 14, S, y);
        x.stroke();
      }
      break;
    case "ice": {
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, th.floorA);
      g.addColorStop(1, th.floorB);
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
      x.strokeStyle = th.floorLine;
      for (let i = 0; i < 26; i++) {
        x.lineWidth = 1 + r() * 2;
        x.beginPath();
        let px = r() * S;
        let py = r() * S;
        x.moveTo(px, py);
        for (let k = 0; k < 5; k++) {
          px += (r() - 0.5) * 120;
          py += (r() - 0.5) * 120;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export class FightEngine {
  private o: EngineOptions;
  private map: MapDef;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private vmScene = new THREE.Scene();
  private vmCamera: THREE.PerspectiveCamera;
  private vm = new THREE.Group();
  private vmModel: WeaponModel;
  private vmFlash: THREE.Sprite;
  private flashTex: THREE.Texture;
  private envTex: THREE.Texture | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private unitSphere = new THREE.SphereGeometry(1, 16, 12);
  private flatRing = new THREE.RingGeometry(0.82, 1, 56);
  private avatar: Avatar;
  private avatarFlash: THREE.Sprite;
  private shieldMesh: THREE.Mesh;
  private guardMesh: THREE.Mesh;
  private promoteMesh: THREE.Mesh;
  private xray: THREE.Object3D | null = null;

  private myDef;
  private oppDef;
  private t = 0;
  private raf = 0;
  private lastFrame = 0;
  private netTimer = 0;
  private hudTimer = 0;
  private disposed = false;

  // quality
  private maxRatio = 1;
  private minRatio = 0.4;
  private ratio = 1;
  private govFrames = 0;
  private govTime = 0;
  private govCooldown = 0;
  private govFast = 0;
  private ceiling = Infinity;
  private lowRuns = 0;
  private quality: "auto" | "high" | "low" = "auto";
  private fps = 60;
  private shadowsOn = true;

  // player sim
  private pos = { x: 0, y: 0, z: 0 };
  private vel = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private onGround = true;
  private wasGround = true;
  private dashT = 0;
  private dashV = { x: 0, z: 0 };
  private leapT = 0;
  private shieldT = 0;
  private guardT = 0;
  private promoteT = 0;
  private markT = 0;
  private xrayT = 0;
  private markedT = 0;
  private stompPending = 0;
  private barrage: { left: number; next: number } | null = null;
  private abCd = [0, 0];
  private abCdMax = [1, 1];
  private ws: { pri: WS; sec: WS };
  private aiming = false;
  private sprinting = false;
  private fov = BASE_FOV;
  private kick = 0;
  private recoil = 0;
  private thrust = 0;
  private bobT = 0;
  private stride = 0;
  private shake = 0;
  private landDip = 0;
  private tilt = 0;
  private flashT = 0;
  private avFlashT = 0;
  private avKick = 0;
  private avThrust = 0;
  private camRoll = 0;
  private fireBuf = -1;
  private secBuf = -1;

  // input
  private keys = new Set<string>();
  private mouse = [false, false, false];
  private locked = false;
  private lockFailed = false;
  private skipMoves = 0;
  private touchMode = false;
  private touchCapable = false;
  private touch = { x: 0, y: 0 };

  // net
  private entered = false;
  private inflight = 0;
  private seq = 0;
  private lastAppliedSeq = 0;
  private outbox: ClientEvent[] = [];
  private cid = 1;
  private lastEventId = 0;
  private phase: Phase = "waiting";
  private prevPhase: Phase = "waiting";
  private lastBeep = -1;
  private countdownMs = 0;
  private timeLeftMs = 75000;
  private hp = { me: 0, opp: 0, meMax: 1, oppMax: 1 };
  private oppNet: NetState | null = null;
  private snaps: Snap[] = [];
  private serverOffset = 0;
  private offsetInit = false;
  private oppShown = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: 0, init: false };
  private oppPrev = { x: 0, z: 0 };
  private oppVel = { x: 0, z: 0 };
  private oppBob = 0;
  private finished = false;
  private winner?: Role;
  private reason?: string;
  private connected = true;
  private fails = 0;
  private ping = 0;

  // feedback
  private hitAt = 0;
  private hitKind: "body" | "head" = "body";
  private hurtAt = 0;
  private hurtAngle = 0;

  private fx: Fx[] = [];
  private projs: Proj[] = [];
  private walls: Wall[] = [];
  private wallId = 1;

  private cleanup: (() => void)[] = [];
  private _v = new THREE.Vector3();

  constructor(opts: EngineOptions) {
    this.o = opts;
    this.map = setMap(opts.mapId);
    this.myDef = PIECES[opts.myPiece];
    this.oppDef = PIECES[opts.oppPiece];
    this.hp = { me: this.myDef.hp, opp: this.oppDef.hp, meMax: this.myDef.hp, oppMax: this.oppDef.hp };
    this.ws = {
      pri: { cd: 0, ammo: this.myDef.primary.mag ?? 0, reloadEnd: 0, reloadStart: 0, spin: 0, charge: 0 },
      sec: { cd: 0, ammo: 0, reloadEnd: 0, reloadStart: 0, spin: 0, charge: 0 },
    };
    this.abCdMax = [this.myDef.abilities[0].cooldown, this.myDef.abilities[1].cooldown];

    const { container } = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    // Start conservatively and let the governor raise the resolution if the machine has headroom.
    this.ratio = Math.min(this.maxRatio, 1);
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.map.theme.exposure;
    this.renderer.autoClear = false;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none";
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 500);
    this.camera.rotation.order = "YXZ";
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.flashTex = flashTexture();

    this.setupEnvironment();
    this.buildArena();

    // viewmodel
    this.vmModel = buildWeaponModel(opts.myPiece);
    const vmc = VM[opts.myPiece];
    this.vm.add(this.vmModel.group);
    this.vm.position.set(...vmc.pos);
    this.vm.rotation.set(...vmc.rot);
    this.vm.scale.setScalar(vmc.scale);
    this.vmScene.add(this.vm);
    this.vmScene.add(new THREE.HemisphereLight(0xeef2ff, 0x5a5a6a, 1.6));
    this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const vl = new THREE.DirectionalLight(0xfff0d8, 2.4);
    vl.position.set(1, 2, 1);
    this.vmScene.add(vl);
    this.vmFlash = this.makeFlash(0.5);
    this.vmModel.muzzle.add(this.vmFlash);

    // opponent avatar
    this.avatar = buildAvatar(opts.oppPiece, opts.oppColor);
    this.scene.add(this.avatar.root);
    this.avatarFlash = this.makeFlash(0.9);
    this.avatar.muzzle.add(this.avatarFlash);
    const h = this.oppDef.height;
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(h * 0.62, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x5ab4ff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shieldMesh.position.y = h * 0.5;
    this.shieldMesh.visible = false;
    this.avatar.root.add(this.shieldMesh);
    this.guardMesh = new THREE.Mesh(
      new THREE.SphereGeometry(h * 0.66, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.guardMesh.position.y = h * 0.5;
    this.guardMesh.visible = false;
    this.avatar.root.add(this.guardMesh);
    this.promoteMesh = new THREE.Mesh(
      new THREE.TorusGeometry(h * 0.34, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.85 }),
    );
    this.promoteMesh.rotation.x = Math.PI / 2;
    this.promoteMesh.visible = false;
    this.avatar.root.add(this.promoteMesh);

    // spawn
    const sp = spawnFor(opts.role);
    this.pos = { x: sp.x, y: 0, z: sp.z };
    this.yaw = sp.yaw;

    try {
      const q = localStorage.getItem("ga:quality");
      if (q === "high" || q === "low") this.setQuality(q);
    } catch {
      /* default to auto */
    }
    this.touchCapable =
      typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || (window.matchMedia?.("(pointer: coarse)").matches ?? false));
    this.bindInput(canvas);
    this.prewarm();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanup.push(() => ro.disconnect());
    this.resize();
  }

  // ------------------------------------------------------------------ setup

  /**
   * Compile every shader the fight will ever need up front. Without this the first shot, explosion or
   * ability stalls the frame while the GPU driver builds a new program.
   */
  private prewarm() {
    const g = new THREE.Group();
    g.position.set(0, -300, 0);
    const basicT = (extra: THREE.MeshBasicMaterialParameters = {}) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, ...extra });
    const items: THREE.Mesh[] = [
      new THREE.Mesh(this.unitBox, basicT()),
      new THREE.Mesh(this.unitSphere, basicT()),
      new THREE.Mesh(this.flatRing, basicT({ side: THREE.DoubleSide })),
      new THREE.Mesh(this.unitSphere, new THREE.MeshBasicMaterial({ color: 0xffa940 })),
      new THREE.Mesh(this.unitBox, basicT({ depthTest: false })),
      new THREE.Mesh(this.unitBox, new THREE.MeshStandardMaterial({ color: 0xdadde6, metalness: 0.8, roughness: 0.25, emissive: 0xe879f9, emissiveIntensity: 0.6 })),
      new THREE.Mesh(this.unitBox, new THREE.MeshStandardMaterial({ color: 0x7a5530, transparent: true, opacity: 0.8 })),
    ];
    for (const m of items) {
      m.frustumCulled = false;
      g.add(m);
    }
    this.scene.add(g);
    const toggles: THREE.Object3D[] = [this.vmFlash, this.avatarFlash, this.shieldMesh, this.guardMesh, this.promoteMesh];
    const was = toggles.map((o) => o.visible);
    toggles.forEach((o) => (o.visible = true));
    const vmWas = this.vm.visible;
    this.vm.visible = true;
    try {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.vmScene, this.vmCamera);
    } catch {
      /* A failed pre-compile only costs a one-off hitch later. */
    }
    toggles.forEach((o, i) => (o.visible = was[i]));
    this.vm.visible = vmWas;
    this.scene.remove(g);
    for (const m of items) (m.material as THREE.Material).dispose();
  }

  private makeFlash(size: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    s.scale.setScalar(size);
    s.visible = false;
    return s;
  }

  private setupEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this.envTex;
      this.scene.environmentIntensity = 0.5;
      this.vmScene.environment = this.envTex;
      this.vmScene.environmentIntensity = 0.9;
    } catch {
      /* Reflections are a nicety; continue without them. */
    }
  }

  private buildArena() {
    const scene = this.scene;
    const m = this.map;
    const th = m.theme;
    const HX = m.halfX;
    const HZ = m.halfZ;

    const bgc = document.createElement("canvas");
    bgc.width = 2;
    bgc.height = 256;
    const bx = bgc.getContext("2d")!;
    const gr = bx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, th.sky[0]);
    gr.addColorStop(0.55, th.sky[1]);
    gr.addColorStop(1, th.sky[2]);
    bx.fillStyle = gr;
    bx.fillRect(0, 0, 2, 256);
    const bg = new THREE.CanvasTexture(bgc);
    bg.colorSpace = THREE.SRGBColorSpace;
    scene.background = bg;
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);

    // floor
    const ft = floorTexture(th);
    ft.repeat.set((HX * 2) / 16, (HZ * 2) / 16);
    const floorMat = new THREE.MeshStandardMaterial({
      map: ft,
      roughness: th.floor === "ice" ? 0.12 : th.floor === "grid" ? 0.35 : 0.6,
      metalness: th.floor === "ice" ? 0.1 : 0.05,
    });
    if (th.glow) {
      floorMat.emissiveMap = ft;
      floorMat.emissive = new THREE.Color(0xffffff);
      floorMat.emissiveIntensity = 0.85;
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const outerColor = new THREE.Color(th.fog).multiplyScalar(0.55);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: outerColor, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    scene.add(outer);

    // walls
    const wallMat = new THREE.MeshStandardMaterial({ color: th.wall, roughness: 0.7, metalness: 0.08 });
    const trimMat = new THREE.MeshBasicMaterial({ color: th.trim });
    const trimMat2 = new THREE.MeshBasicMaterial({ color: th.trim2 });
    const WH = m.wallH;
    const wall = (x: number, z: number, sx: number, sz: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WH, sz), wallMat);
      mesh.position.set(x, WH / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      const t = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.05, 0.2, sz + 0.05), trimMat);
      t.position.set(x, WH - 0.1, z);
      scene.add(t);
      const t2 = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.05, 0.1, sz + 0.05), trimMat2);
      t2.position.set(x, 0.3, z);
      scene.add(t2);
      if (th.glow) {
        const t3 = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.05, 0.12, sz + 0.05), trimMat2);
        t3.position.set(x, WH * 0.55, z);
        scene.add(t3);
      }
    };
    wall(0, -HZ - 1, HX * 2 + 4, 2);
    wall(0, HZ + 1, HX * 2 + 4, 2);
    wall(-HX - 1, 0, 2, HZ * 2);
    wall(HX + 1, 0, 2, HZ * 2);

    if (th.decor === "towers") {
      // Battlements along the top of the walls.
      const geo = new THREE.BoxGeometry(1.5, 1.3, 1.5);
      const spots: [number, number][] = [];
      for (let x = -HX; x <= HX; x += 3.2) spots.push([x, -HZ - 1], [x, HZ + 1]);
      for (let z = -HZ; z <= HZ; z += 3.2) spots.push([-HX - 1, z], [HX + 1, z]);
      const inst = new THREE.InstancedMesh(geo, wallMat, spots.length);
      const mat4 = new THREE.Matrix4();
      spots.forEach(([x, z], i) => {
        mat4.setPosition(x, WH + 0.65, z);
        inst.setMatrixAt(i, mat4);
      });
      inst.castShadow = true;
      scene.add(inst);
    }

    // cover, decks and stairs
    const rough = th.floor === "ice" ? 0.14 : 0.62;
    const metal = th.floor === "ice" || th.glow ? 0.12 : 0.04;
    const mats = {
      tall: new THREE.MeshStandardMaterial({ color: th.tall, roughness: rough, metalness: metal, emissive: th.glow ? th.tall : 0x000000, emissiveIntensity: th.glow ? 0.35 : 0 }),
      low: new THREE.MeshStandardMaterial({ color: th.low, roughness: 0.7, metalness: 0.02 }),
      deck: new THREE.MeshStandardMaterial({ color: th.deck, roughness: rough, metalness: metal, emissive: th.glow ? th.deck : 0x000000, emissiveIntensity: th.glow ? 0.3 : 0 }),
      stair: new THREE.MeshStandardMaterial({ color: th.stair, roughness: 0.7, metalness: 0.02 }),
    };
    const edgeMat = new THREE.LineBasicMaterial({ color: th.glow ? th.trim2 : 0xffffff, transparent: true, opacity: th.glow ? 0.95 : 0.28 });
    for (const b of m.boxes) {
      const k = b.k ?? (b.h > 2 ? "tall" : "low");
      const geo = new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2);
      const mesh = new THREE.Mesh(geo, mats[k]);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = k !== "stair";
      mesh.receiveShadow = true;
      if (k !== "stair") mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      scene.add(mesh);
      if (k === "tall") {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.1, 0.12, b.hz * 2 + 0.1), trimMat);
        cap.position.set(b.x, b.h + 0.06, b.z);
        scene.add(cap);
      } else if (k === "deck") {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.06, 0.08, b.hz * 2 + 0.06), trimMat2);
        cap.position.set(b.x, b.h + 0.04, b.z);
        scene.add(cap);
      }
    }

    this.buildDecor(m);

    // lights
    scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemi));
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(th.sun, th.sunPower);
    sun.position.set(...th.sunPos);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const ext = Math.max(HX, HZ) + 6;
    const sc = sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.05;
    scene.add(sun);
    this.sun = sun;
    if (th.glow) {
      const a = new THREE.PointLight(0x22d3ee, 900, 80, 1.6);
      a.position.set(-HX * 0.5, 10, 0);
      const b = new THREE.PointLight(0xff2bd6, 900, 80, 1.6);
      b.position.set(HX * 0.5, 10, 0);
      scene.add(a, b);
    }
  }

  private buildDecor(m: MapDef) {
    const scene = this.scene;
    const th = m.theme;
    const HX = m.halfX;
    const HZ = m.halfZ;
    const r = rng(11);
    switch (th.decor) {
      case "statues": {
        const kinds: PieceType[] = ["k", "q", "r", "b", "n", "p"];
        const spots: [number, number][] = [
          [-HX - 14, -HZ - 14], [HX + 14, -HZ - 14], [-HX - 14, HZ + 14], [HX + 14, HZ + 14],
          [0, -HZ - 20], [0, HZ + 20], [-HX - 20, 0], [HX + 20, 0],
          [-HX - 18, -HZ / 2], [HX + 18, HZ / 2], [-HX / 2, -HZ - 18], [HX / 2, HZ + 18],
          [-HX - 18, HZ / 2], [HX + 18, -HZ / 2],
        ];
        spots.forEach(([x, z], i) => {
          const s = buildPieceBody(kinds[i % 6], i % 2 === 0 ? "w" : "b");
          s.scale.multiplyScalar(8);
          s.position.set(x, 0, z);
          s.lookAt(0, 0, 0);
          scene.add(s);
        });
        break;
      }
      case "towers": {
        const stone = new THREE.MeshStandardMaterial({ color: 0x7a746a, roughness: 0.85 });
        const roof = new THREE.MeshStandardMaterial({ color: 0x8a2b2b, roughness: 0.6 });
        const flag = new THREE.MeshStandardMaterial({ color: 0xb91c1c, side: THREE.DoubleSide, roughness: 0.7 });
        const spots: [number, number, number][] = [
          [-HX - 9, -HZ - 9, 1], [HX + 9, -HZ - 9, 1], [-HX - 9, HZ + 9, 1], [HX + 9, HZ + 9, 1],
          [-HX - 12, 0, 0.7], [HX + 12, 0, 0.7], [0, -HZ - 12, 0.7], [0, HZ + 12, 0.7],
        ];
        for (const [x, z, k] of spots) {
          const body = new THREE.Mesh(new THREE.CylinderGeometry(5 * k, 5.6 * k, 28 * k, 24), stone);
          body.position.set(x, 14 * k, z);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(6.4 * k, 10 * k, 24), roof);
          cone.position.set(x, 33 * k, z);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6 * k, 6), stone);
          pole.position.set(x, 41 * k, z);
          const f = new THREE.Mesh(new THREE.PlaneGeometry(4 * k, 2.4 * k), flag);
          f.position.set(x + 2 * k, 42.5 * k, z);
          scene.add(body, cone, pole, f);
        }
        break;
      }
      case "neon": {
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const rx = HX + 18 + r() * 12;
          const rz = HZ + 18 + r() * 12;
          const hgt = 20 + r() * 26;
          const col = i % 2 === 0 ? th.trim : th.trim2;
          const p = new THREE.Mesh(new THREE.BoxGeometry(2, hgt, 2), new THREE.MeshStandardMaterial({ color: 0x151a3a, roughness: 0.4, metalness: 0.5 }));
          p.position.set(Math.cos(a) * rx, hgt / 2, Math.sin(a) * rz);
          const glowTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 2.2), new THREE.MeshBasicMaterial({ color: col }));
          glowTop.position.set(p.position.x, hgt - 1.5, p.position.z);
          scene.add(p, glowTop);
        }
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(30 + i * 14, 0.5, 8, 80), new THREE.MeshBasicMaterial({ color: i % 2 ? th.trim : th.trim2 }));
          ring.position.set(0, 70 + i * 10, -HZ - 70);
          scene.add(ring);
        }
        break;
      }
      case "crystals": {
        const mat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82, emissive: 0x2a6a9a, emissiveIntensity: 0.4 });
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2 + r() * 0.2;
          const rx = HX + 12 + r() * 20;
          const rz = HZ + 12 + r() * 20;
          const hgt = 8 + r() * 16;
          const c = new THREE.Mesh(new THREE.ConeGeometry(2 + r() * 3, hgt, 6), mat);
          c.position.set(Math.cos(a) * rx, hgt / 2, Math.sin(a) * rz);
          c.rotation.z = (r() - 0.5) * 0.4;
          c.rotation.x = (r() - 0.5) * 0.4;
          scene.add(c);
        }
        break;
      }
      case "columns": {
        const stone = new THREE.MeshStandardMaterial({ color: 0xcaa874, roughness: 0.8 });
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const rx = HX + 12 + r() * 10;
          const rz = HZ + 12 + r() * 10;
          const hgt = 10 + r() * 12;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, hgt, 14), stone);
          col.position.set(Math.cos(a) * rx, hgt / 2, Math.sin(a) * rz);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1, 4.4), stone);
          cap.position.set(col.position.x, hgt + 0.5, col.position.z);
          scene.add(col, cap);
        }
        for (let i = 0; i < 3; i++) {
          const p = new THREE.Mesh(new THREE.ConeGeometry(50 + i * 12, 55 + i * 10, 4), new THREE.MeshStandardMaterial({ color: 0xb8935e, roughness: 0.95 }));
          p.position.set(-120 + i * 110, 26, -HZ - 150);
          p.rotation.y = Math.PI / 4;
          scene.add(p);
        }
        break;
      }
    }
  }

  private bindInput(canvas: HTMLCanvasElement) {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Tab") e.preventDefault();
      if (e.code === "KeyE") this.useAbility(0);
      if (e.code === "KeyQ") this.useAbility(1);
      if (e.code === "KeyR") this.startReload();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const md = (e: MouseEvent) => {
      initAudio();
      if (!this.locked && !this.lockFailed) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.mouse[0] = true;
        this.fireBuf = this.t + 0.12;
      }
      if (e.button === 2) {
        this.mouse[2] = true;
        this.secBuf = this.t + 0.12;
      }
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) this.mouse[0] = false;
      if (e.button === 2) this.mouse[2] = false;
    };
    const mm = (e: MouseEvent) => {
      if (!this.locked && !this.lockFailed) return;
      // Some browsers report a huge bogus delta on the first events after pointer lock; ignore those.
      if (this.skipMoves > 0) {
        this.skipMoves--;
        return;
      }
      if (Math.hypot(e.movementX, e.movementY) > 450) return;
      const k = SENS * (this.aiming && this.myDef.aim ? this.myDef.aim.fov / BASE_FOV : 1);
      this.yaw -= e.movementX * k;
      this.pitch = clamp(this.pitch - e.movementY * k, -1.45, 1.45);
    };
    const cm = (e: Event) => e.preventDefault();
    const plc = () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.skipMoves = 3;
      if (!this.locked) {
        this.mouse = [false, false, false];
        this.keys.clear();
      }
    };
    const ple = () => {
      this.lockFailed = true;
    };
    const blur = () => {
      this.keys.clear();
      this.mouse = [false, false, false];
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    canvas.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("mousemove", mm);
    canvas.addEventListener("contextmenu", cm);
    document.addEventListener("pointerlockchange", plc);
    document.addEventListener("pointerlockerror", ple);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("mousemove", mm);
      canvas.removeEventListener("contextmenu", cm);
      document.removeEventListener("pointerlockchange", plc);
      document.removeEventListener("pointerlockerror", ple);
    });
  }

  /** Enter the arena: the countdown starts here. Desktop grabs the mouse; touch devices do not need it. */
  enterArena() {
    if (this.touchCapable) {
      this.touchMode = true;
      if (!this.entered) {
        this.entered = true;
        void this.netTick();
      }
      return;
    }
    this.requestLock();
  }

  requestLock() {
    initAudio();
    // The fight clock only starts once the player has actually entered the arena.
    if (!this.entered) {
      this.entered = true;
      void this.netTick();
    }
    const canvas = this.renderer.domElement;
    canvas.focus();
    try {
      const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
    // Some embedded previews never lock; fall back to free-look after a moment.
    window.setTimeout(() => {
      if (!this.locked && !this.disposed) this.lockFailed = true;
    }, 600);
  }

  private resize() {
    const el = this.o.container;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  start() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const raw = (now - this.lastFrame) / 1000;
      const dt = Math.min(0.05, raw);
      this.lastFrame = now;
      this.adaptQuality(Math.min(raw, 0.6));
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    this.netTimer = window.setInterval(() => void this.netTick(), NET_INTERVAL);
    this.hudTimer = window.setInterval(() => this.o.onHud(this.hud()), 66);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.netTimer);
    clearInterval(this.hudTimer);
    this.cleanup.forEach((f) => f());
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    for (const w of this.walls) removeExtraBox(w.id);
    clearExtraBoxes();
    const disposeTree = (root: THREE.Object3D) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    disposeTree(this.scene);
    disposeTree(this.vmScene);
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ touch input

  /** Normalised joystick vector: x right, y down (the player pushes the stick up to walk forward). */
  setTouchMove(x: number, y: number) {
    this.touch.x = clamp(x, -1, 1);
    this.touch.y = clamp(y, -1, 1);
    this.touchMode = true;
  }

  /** Look delta in pixels, from dragging anywhere on the arena. */
  look(dx: number, dy: number) {
    const k = SENS * (this.aiming && this.myDef.aim ? this.myDef.aim.fov / BASE_FOV : 1);
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k, -1.45, 1.45);
  }

  setTouchFire(v: boolean) {
    this.mouse[0] = v;
  }

  setTouchAlt(v: boolean) {
    this.mouse[2] = v;
  }

  setTouchJump(v: boolean) {
    if (v) this.keys.add("Space");
    else this.keys.delete("Space");
  }

  setTouchSprint(v: boolean) {
    if (v) this.keys.add("ShiftLeft");
    else this.keys.delete("ShiftLeft");
  }

  pressAbility(slot: 0 | 1) {
    this.useAbility(slot);
  }

  pressReload() {
    this.startReload();
  }

  // ------------------------------------------------------------------ helpers

  private get live() {
    return this.phase === "live" && !this.finished;
  }

  private eye(): V3 {
    return [this.pos.x, this.pos.y + hitShape(this.myDef.height).eye, this.pos.z];
  }

  private oppTarget(): Target {
    return { x: this.oppShown.x, y: this.oppShown.y, z: this.oppShown.z, height: this.oppDef.height };
  }

  private oppAlive() {
    return this.hp.opp > 0 && this.oppShown.init;
  }

  private queue(ev: Omit<ClientEvent, "cid"> & Record<string, unknown>) {
    this.outbox.push({ ...ev, cid: this.cid++ } as ClientEvent);
  }

  private moveInput() {
    if (this.touchMode && (this.touch.x !== 0 || this.touch.y !== 0)) {
      return { fwd: -this.touch.y, side: this.touch.x };
    }
    let fwd = 0;
    let side = 0;
    if (this.live) {
      if (this.keys.has("KeyW")) fwd++;
      if (this.keys.has("KeyS")) fwd--;
      if (this.keys.has("KeyD")) side++;
      if (this.keys.has("KeyA")) side--;
    }
    return { fwd, side };
  }

  private moveDir(): { x: number; z: number; moving: boolean } {
    const { fwd, side } = this.moveInput();
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let x = fx * fwd + rx * side;
    let z = fz * fwd + rz * side;
    const l = Math.hypot(x, z);
    if (l < 1e-6) return { x: fx, z: fz, moving: false };
    x /= l;
    z /= l;
    return { x, z, moving: true };
  }

  // ------------------------------------------------------------------ frame

  private frame(dt: number) {
    this.t += dt;
    this.updateMovement(dt);
    this.updateWeapons(dt);
    this.updateBarrage();
    this.updateProjectiles(dt);
    this.updateWalls();
    this.updateOpp(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    this.render();
  }

  /**
   * Dynamic resolution keeps the framerate steady. It measures real frame time over a short window and
   * rescales proportionally, so even a very slow GPU converges within a second or two.
   */
  /** Graphics preset: "auto" adapts resolution to the machine, "high" locks full resolution + shadows, "low" is lightest. */
  setQuality(q: "auto" | "high" | "low") {
    this.quality = q;
    try {
      localStorage.setItem("ga:quality", q);
    } catch {
      /* optional */
    }
    this.ratio = q === "high" ? this.maxRatio : q === "low" ? Math.min(0.6, this.maxRatio) : Math.min(this.maxRatio, 1);
    this.renderer.setPixelRatio(this.ratio);
    this.resize();
    if (this.sun) {
      this.shadowsOn = q !== "low";
      this.sun.castShadow = this.shadowsOn;
    }
    this.ceiling = Infinity;
    this.lowRuns = 0;
  }

  private govLast = 0;
  private adaptQuality(raw: number) {
    this.govFrames++;
    this.govTime += raw;
    if (this.govTime < 0.5 && this.govFrames < 6) return;
    const avg = this.govTime / this.govFrames;
    this.govLast = this.govTime;
    if (this.quality !== "auto") {
      this.fps = 1 / avg;
      this.govFrames = 0;
      this.govTime = 0;
      return;
    }
    this.fps = 1 / avg;
    this.govFrames = 0;
    this.govTime = 0;
    // Changing resolution reallocates the (multisampled) render buffers, so it is rate-limited and has
    // hysteresis: drop quickly when slow, but only climb after sustained headroom and never above the
    // level that previously proved too heavy.
    this.govCooldown = Math.max(0, this.govCooldown - this.govLast);
    let next = this.ratio;
    if (avg > 1 / 40) {
      this.govFast = 0;
      next = this.ratio * clamp(Math.sqrt(1 / 55 / avg), 0.45, 0.9);
      this.ceiling = Math.min(this.ceiling, this.ratio * 0.95);
    } else if (avg < 1 / 62) {
      this.govFast++;
      if (this.govFast >= 5) next = Math.min(this.ratio * 1.08, this.ceiling, this.maxRatio);
    } else this.govFast = 0;
    next = clamp(next, this.minRatio, this.maxRatio);
    const drop = next < this.ratio * 0.92;
    const rise = next > this.ratio * 1.05;
    if ((drop || rise) && (this.govCooldown <= 0 || drop)) {
      this.ratio = next;
      this.renderer.setPixelRatio(this.ratio);
      this.resize();
      this.govCooldown = 2.5;
      this.govFast = 0;
      this.renderer.domElement.dataset.pr = this.ratio.toFixed(2);
    }
    // Last resort on very weak hardware: stop rendering shadows.
    if (this.fps < 24 && this.ratio <= this.minRatio + 0.02) this.lowRuns++;
    else this.lowRuns = 0;
    if (this.lowRuns >= 3 && this.shadowsOn && this.sun) {
      this.sun.castShadow = false;
      this.shadowsOn = false;
    }
  }

  private updateMovement(dt: number) {
    const def = this.myDef;
    const ls = 2.2 * dt;
    if (this.keys.has("ArrowLeft")) this.yaw += ls;
    if (this.keys.has("ArrowRight")) this.yaw -= ls;
    if (this.keys.has("ArrowUp")) this.pitch = Math.min(1.45, this.pitch + ls);
    if (this.keys.has("ArrowDown")) this.pitch = Math.max(-1.45, this.pitch - ls);

    const dir = this.moveDir();
    const { fwd, side } = this.moveInput();
    const any = fwd !== 0 || side !== 0;
    const shift = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const firingGun = this.mouse[0] && def.primary.kind !== "melee";
    this.sprinting =
      this.live && shift && fwd > 0 && !firingGun && !this.mouse[2] && this.shieldT <= 0 && this.ws.sec.charge === 0 && !(def.type === "r" && this.ws.pri.spin > 0);

    let speed = def.speed;
    if (def.type === "p" && this.hp.me < UNDERDOG_THRESHOLD * this.hp.meMax) speed *= UNDERDOG_SPEED;
    if (this.promoteT > 0) speed *= PROMOTE_SPEED;
    if (this.sprinting) speed *= SPRINT_MULT;
    if (this.shieldT > 0) speed *= 0.5;
    if (def.type === "r" && this.mouse[0] && this.live && this.ws.pri.spin > 0) speed *= 0.6;
    if (this.aiming && def.aim) speed *= def.aim.fov < 40 ? 0.45 : 0.75;
    if (this.ws.sec.charge > 0) speed *= 0.5;
    const tvx = any ? dir.x * speed : 0;
    const tvz = any ? dir.z * speed : 0;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashV.x;
      this.vel.z = this.dashV.z;
    } else if (this.leapT > 0) {
      this.leapT -= dt;
      if (this.onGround && this.leapT < 0.7) this.leapT = 0;
    } else {
      const k = Math.min(1, (this.onGround ? 14 : 2.8) * dt);
      this.vel.x += (tvx - this.vel.x) * k;
      this.vel.z += (tvz - this.vel.z) * k;
    }

    if (this.live && this.keys.has("Space") && this.onGround) {
      this.vel.y = def.jump;
      this.onGround = false;
    }
    moveXZ(this.pos, this.vel.x * dt, this.vel.z * dt);
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    const g = groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.wasGround = this.onGround;
    if (this.pos.y <= g) {
      if (!this.onGround && this.vel.y < -5) {
        this.landDip = Math.min(0.28, -this.vel.y * 0.013);
        sfx("step", 0.5);
      }
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (this.pos.y < 0) this.pos.y = 0;
    if (!this.wasGround && this.onGround && this.stompPending > 0) {
      this.stompPending = 0;
      this.doStomp(true);
    }
    if (this.stompPending > 0) {
      this.stompPending -= dt;
      if (this.stompPending <= 0) this.stompPending = 0;
    }

    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.guardT > 0) this.guardT -= dt;
    if (this.promoteT > 0) this.promoteT -= dt;
    if (this.markT > 0) this.markT -= dt;
    if (this.xrayT > 0) this.xrayT -= dt;
    if (this.markedT > 0) this.markedT -= dt;
    this.aiming = this.live && this.mouse[2] && !!def.aim && !this.sprinting;

    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += dt * spd * 1.3;
    if (this.onGround && spd > 2.5 && this.live) {
      this.stride += spd * dt;
      if (this.stride > (this.sprinting ? 2.4 : 2.9)) {
        this.stride = 0;
        sfx("step", this.sprinting ? 0.32 : 0.2);
      }
    }
  }

  private startReload() {
    const w = this.myDef.primary;
    const st = this.ws.pri;
    if (!this.live || w.mag === undefined || st.reloadEnd > 0 || st.ammo >= w.mag) return;
    st.reloadStart = this.t;
    st.reloadEnd = this.t + (w.reload ?? 1.5);
    sfx("reload", 0.8);
  }

  private updateWeapons(dt: number) {
    const def = this.myDef;
    const w = def.primary;
    const pri = this.ws.pri;
    const sec = this.ws.sec;
    if (pri.reloadEnd > 0 && this.t >= pri.reloadEnd) {
      pri.reloadEnd = 0;
      pri.ammo = w.mag ?? 0;
    }
    const live = this.live;
    if (w.spinUp) {
      if (live && this.mouse[0] && pri.reloadEnd === 0) pri.spin = Math.min(w.spinUp, pri.spin + dt);
      else pri.spin = Math.max(0, pri.spin - dt * 1.5);
    }
    if (live && !this.sprinting) {
      const wants = this.mouse[0] && (w.auto || this.t <= this.fireBuf);
      if (wants && pri.reloadEnd === 0 && this.t >= pri.cd && (!w.spinUp || pri.spin >= w.spinUp) && this.dashT <= 0) {
        if (w.mag !== undefined && pri.ammo <= 0) this.startReload();
        else {
          this.fire(w, pri);
          if (!w.auto) this.fireBuf = -1;
        }
      }
      if (w.mag !== undefined && pri.ammo <= 0 && pri.reloadEnd === 0) this.startReload();
    } else if (live && w.kind === "melee") {
      // Sprinting with a lance is how you charge; attacking is still allowed.
      const wants = this.mouse[0] && (w.auto || this.t <= this.fireBuf);
      if (wants && this.t >= pri.cd) {
        this.fire(w, pri);
        if (!w.auto) this.fireBuf = -1;
      }
    }
    const s = def.secondary;
    if (s) {
      if (s.chargeTime) {
        if (live && this.mouse[2] && this.t >= sec.cd) {
          if (sec.charge === 0) sfx("charge", 0.7);
          sec.charge = Math.min(s.chargeTime, sec.charge + dt);
        } else if (!this.mouse[2]) {
          if (live && sec.charge >= s.chargeTime && this.t >= sec.cd) this.fire(s, sec);
          sec.charge = 0;
        }
      } else if (live && this.mouse[2] && (s.auto || this.t <= this.secBuf) && this.t >= sec.cd) {
        this.fire(s, sec);
        this.secBuf = -1;
      }
    }
    this.kick = Math.max(0, this.kick - dt * 8);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.thrust = Math.max(0, this.thrust - dt * 4.5);
    this.landDip = Math.max(0, this.landDip - dt * 1.4);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.vmFlash.visible = false;
    }
    if (this.avFlashT > 0) {
      this.avFlashT -= dt;
      if (this.avFlashT <= 0) this.avatarFlash.visible = false;
    }
    this.avThrust = Math.max(0, this.avThrust - dt * 4.5);
    this.avKick = Math.max(0, this.avKick - dt * 9);
  }

  private fire(w: WeaponDef, st: WS) {
    st.cd = this.t + w.cooldown;
    if (w.mag !== undefined) st.ammo--;
    const eye = this.eye();
    const base = dirFromAngles(this.yaw, this.pitch);
    const moveFrac = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / this.myDef.speed);
    const adsMul = this.aiming && this.myDef.aim && w.id === this.myDef.primary.id ? this.myDef.aim.spreadMult : 1;
    const spread = w.spread * adsMul * (1 + 0.6 * moveFrac) * (this.onGround ? 1 : 1.6);
    const fsfx = FIRE_SFX[w.id];
    if (fsfx) sfx(fsfx, 0.9);

    if (w.kind === "hitscan") {
      const d = applySpread(base, spread);
      const wallT = w.pierce ? Math.min(w.range, rayArena(eye, d)) : rayWorld(eye, d, w.range);
      const hit = this.oppAlive() ? rayTarget(eye, d, wallT, this.oppTarget()) : null;
      const dist = hit ? hit.dist : wallT;
      const end: V3 = [eye[0] + d[0] * dist, eye[1] + d[1] * dist, eye[2] + d[2] * dist];
      const tr = TRACER[w.id];
      if (tr) this.tracer(this.vmMuzzleWorld(), new THREE.Vector3(...end), tr.color, tr.thick, tr.life);
      this.spark(end, hit ? 0xff6b6b : 0xffe9a8, hit ? 0.22 : 0.16);
      if (hit) {
        this.registerHit(hit.zone);
        this.queue({ type: "hit", w: w.id, z: hit.zone, dir: d });
      }
      this.queue({ type: "fire", w: w.id, o: eye, d, e: end });
      const heavy = w.cooldown > 1;
      this.kick = Math.min(1.4, this.kick + (w.cooldown < 0.15 ? 0.35 : 1));
      this.recoil = Math.min(1, this.recoil + (heavy ? 0.9 : w.cooldown < 0.15 ? 0.12 : 0.35));
      this.vmFlash.visible = true;
      this.flashT = 0.04;
      this.shake += heavy ? 0.5 : 0.08;
    } else if (w.kind === "melee") {
      const t = this.oppTarget();
      const s = hitShape(t.height);
      const c: V3 = [t.x, t.y + s.bodyTop * 0.55, t.z];
      const dv: V3 = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
      const dist = Math.hypot(dv[0], dv[1], dv[2]);
      const nd = norm(dv);
      const dot = nd[0] * base[0] + nd[1] * base[1] + nd[2] * base[2];
      const reach = dist - s.bodyR;
      const speedNow = Math.hypot(this.vel.x, this.vel.z);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const runningForward = this.sprinting && speedNow >= this.myDef.speed * 1.1 && (this.vel.x * fx + this.vel.z * fz) / (speedNow || 1) > 0.7;
      const charged = !!w.chargedMult && (!this.onGround || runningForward);
      this.thrust = 1;
      this.queue({ type: "fire", w: w.id, o: eye, d: base });
      if (this.oppAlive() && reach <= w.range && dot >= (w.arc ?? 0.7) && rayWorld(eye, nd, dist) >= dist - 0.05) {
        this.registerHit("body");
        this.queue({ type: "hit", w: w.id, z: "body", c: charged, dir: norm([base[0], 0, base[2]]) });
        this.spark(c, charged ? 0xffc34d : 0xff6b6b, charged ? 0.5 : 0.3);
        if (charged) this.shake += 0.6;
      }
    } else {
      const d = applySpread(base, spread);
      this.spawnProjectile(w, [eye[0] + d[0] * 0.7, eye[1] + d[1] * 0.7 - 0.08, eye[2] + d[2] * 0.7], d, true);
      this.queue({ type: "fire", w: w.id, o: eye, d });
      this.kick = 1.6;
      this.recoil = 0.8;
      this.vmFlash.visible = true;
      this.flashT = 0.05;
      this.shake += 0.25;
    }
  }

  private registerHit(zone: "body" | "head") {
    this.hitAt = performance.now();
    this.hitKind = zone;
    sfx(zone === "head" ? "headshot" : "hit", 0.8);
  }

  private groundRing(p: V3, radius: number, color: number, life = 0.5) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.flatRing, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p[0], p[1] + 0.08, p[2]);
    this.scene.add(m);
    this.fx.push({
      obj: m,
      life,
      max: life,
      tick: (f) => {
        mat.opacity = 0.85 * (1 - f);
        m.scale.setScalar(0.4 + radius * Math.sqrt(f));
      },
      dispose: () => mat.dispose(),
    });
  }

  private useAbility(slot: 0 | 1) {
    if (!this.live) return;
    const def = this.myDef;
    const ab = def.abilities[slot];
    if (this.t < this.abCd[slot]) return;
    const dir = this.moveDir();
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.abCd[slot] = this.t + ab.cooldown;
    let to: V3 | undefined;
    let evDir: V3 | undefined;
    let sendNow = true;
    switch (ab.id) {
      case "dash":
        this.dashT = ab.duration;
        this.dashV = { x: (dir.x * 9) / ab.duration, z: (dir.z * 9) / ab.duration };
        evDir = [dir.x, 0, dir.z];
        sfx("dash", 0.7);
        break;
      case "slide":
        this.dashT = ab.duration;
        this.dashV = { x: (dir.x * 16) / ab.duration, z: (dir.z * 16) / ab.duration };
        evDir = [dir.x, 0, dir.z];
        sfx("dash", 0.9);
        break;
      case "leap": {
        const side = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
        this.vel.x = fx * 11.5 + rx * side * 6;
        this.vel.z = fz * 11.5 + rz * side * 6;
        this.vel.y = 10;
        this.onGround = false;
        this.leapT = ab.duration;
        evDir = [dir.x, 0, dir.z];
        sfx("dash", 0.8);
        break;
      }
      case "blink": {
        const f = this.keys.has("KeyS") ? -1 : 1;
        const s = this.keys.has("KeyA") ? -1 : 1;
        const bd = norm([fx * f + rx * s, 0, fz * f + rz * s]);
        const start: V3 = [this.pos.x, this.pos.y + 0.1, this.pos.z];
        const steps = 34;
        for (let i = 0; i < steps; i++) {
          const bx = this.pos.x;
          const bz = this.pos.z;
          moveXZ(this.pos, (bd[0] * 10) / steps, (bd[2] * 10) / steps);
          if (Math.hypot(this.pos.x - bx, this.pos.z - bz) < (10 / steps) * 0.8) break;
        }
        this.vel.x = this.vel.z = 0;
        this.groundRing(start, 2.4, 0x38bdf8, 0.45);
        this.groundRing([this.pos.x, this.pos.y + 0.1, this.pos.z], 2.4, 0x38bdf8, 0.45);
        to = [this.pos.x, this.pos.y, this.pos.z];
        sfx("blink", 0.9);
        break;
      }
      case "bulwark":
        this.shieldT = ab.duration;
        sfx("shield", 0.9);
        break;
      case "guard":
        this.guardT = ab.duration;
        sfx("guard", 0.9);
        break;
      case "promote":
        this.promoteT = ab.duration;
        this.groundRing([this.pos.x, this.pos.y + 0.1, this.pos.z], 3, 0xfde047, 0.7);
        sfx("promote", 0.9);
        break;
      case "mark":
        this.markT = ab.duration;
        this.xrayT = ab.duration;
        sfx("mark", 0.9);
        break;
      case "rampart": {
        const d: V3 = [fx, 0, fz];
        const lim = (v: number, h: number) => clamp(v, -h + 4, h - 4);
        const c: V3 = [lim(this.pos.x + fx * 4.6, this.map.halfX), 0, lim(this.pos.z + fz * 4.6, this.map.halfZ)];
        this.addWall(c, d, ab.duration);
        to = c;
        evDir = d;
        break;
      }
      case "barrage":
        this.barrage = { left: 4, next: this.t };
        sfx("barrage", 0.9);
        break;
      case "stomp":
        if (this.onGround) this.doStomp(false);
        else {
          this.vel.y = -22;
          this.stompPending = 1.6;
          this.abCd[slot] = this.t + 6;
          sendNow = false;
        }
        break;
      case "shockwave":
        this.doShockwave();
        sendNow = false;
        break;
    }
    if (sendNow) this.queue({ type: "ability", k: ab.id, to, dir: evDir });
  }

  private doStomp(charged: boolean) {
    const w = WEAPONS.n_stomp;
    const radius = (w.splash ?? 6.5) * (charged ? 1.2 : 1);
    const slot = this.myDef.abilities.findIndex((a) => a.id === "stomp");
    if (slot >= 0) this.abCd[slot] = this.t + this.myDef.abilities[slot].cooldown;
    this.groundRing([this.pos.x, this.pos.y, this.pos.z], radius, 0xffc34d, 0.55);
    this.groundRing([this.pos.x, this.pos.y, this.pos.z], radius * 0.6, 0xffffff, 0.4);
    sfx("stomp", 1);
    this.shake += charged ? 1.4 : 0.9;
    if (this.live && this.oppAlive()) {
      const t = this.oppTarget();
      const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
      if (d <= radius && Math.abs(t.y - this.pos.y) < 3) {
        this.registerHit("body");
        this.queue({
          type: "hit",
          w: w.id,
          z: "splash",
          f: Math.max(0.3, 1 - (d / radius) * 0.7),
          c: charged,
          dir: norm([t.x - this.pos.x, 0.3, t.z - this.pos.z]),
        });
      }
    }
    this.queue({ type: "ability", k: "stomp", to: [this.pos.x, this.pos.y, this.pos.z] });
  }

  private doShockwave() {
    const w = WEAPONS.k_shockwave;
    const radius = w.splash ?? 10;
    this.groundRing([this.pos.x, this.pos.y, this.pos.z], radius, 0xfacc15, 0.7);
    this.groundRing([this.pos.x, this.pos.y, this.pos.z], radius * 0.6, 0x67e8f9, 0.5);
    sfx("shockwave", 1);
    this.shake += 1.2;
    if (this.live && this.oppAlive()) {
      const t = this.oppTarget();
      const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
      if (d <= radius && Math.abs(t.y - this.pos.y) < 4) {
        this.registerHit("body");
        this.queue({
          type: "hit",
          w: w.id,
          z: "splash",
          f: Math.max(0.3, 1 - (d / radius) * 0.7),
          dir: norm([t.x - this.pos.x, 0.5, t.z - this.pos.z]),
        });
      }
    }
    this.queue({ type: "ability", k: "shockwave", to: [this.pos.x, this.pos.y, this.pos.z] });
  }

  private updateBarrage() {
    const b = this.barrage;
    if (!b) return;
    if (!this.live) {
      this.barrage = null;
      return;
    }
    if (this.t < b.next) return;
    const w = WEAPONS.q_barrage;
    const eye = this.eye();
    const d = applySpread(dirFromAngles(this.yaw, this.pitch), w.spread);
    this.spawnProjectile(w, [eye[0] + d[0] * 0.8, eye[1] + d[1] * 0.8 - 0.1, eye[2] + d[2] * 0.8], d, true);
    this.queue({ type: "fire", w: w.id, o: eye, d });
    sfx("barrage", 0.8);
    this.kick = 1.2;
    this.shake += 0.2;
    b.left--;
    b.next = this.t + 0.14;
    if (b.left <= 0) this.barrage = null;
  }

  // ------------------------------------------------------------------ walls

  private addWall(to: V3, dir: V3, duration: number) {
    const box = rampartBox(to, dir);
    const id = this.wallId++;
    addExtraBox({ ...box, id });
    const th = this.map.theme;
    const mat = new THREE.MeshStandardMaterial({ color: th.tall, roughness: 0.6, metalness: 0.1, emissive: th.trim, emissiveIntensity: 0.18 });
    const geo = new THREE.BoxGeometry(box.hx * 2, box.h, box.hz * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(box.x, 0.05, box.z);
    mesh.scale.y = 0.02;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: th.trim, transparent: true, opacity: 0.9 })));
    this.scene.add(mesh);
    this.walls.push({ id, mesh, born: this.t, until: this.t + duration, h: box.h, mat });
    this.groundRing([box.x, 0, box.z], 4.2, th.trim, 0.5);
    const dist = Math.hypot(box.x - this.pos.x, box.z - this.pos.z);
    sfx("rampart", clamp(1.1 - dist / 50, 0.25, 1));
  }

  private updateWalls() {
    for (const w of [...this.walls]) {
      const rise = clamp((this.t - w.born) / 0.35, 0, 1);
      const e = 1 - Math.pow(1 - rise, 3);
      w.mesh.scale.y = Math.max(0.02, e);
      w.mesh.position.y = (w.h * Math.max(0.02, e)) / 2;
      const left = w.until - this.t;
      if (left < 0.8) {
        w.mat.transparent = true;
        w.mat.opacity = clamp(left / 0.8, 0, 1) * (0.55 + 0.45 * Math.abs(Math.sin(this.t * 24)));
      }
      if (left <= 0) {
        removeExtraBox(w.id);
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mat.dispose();
        this.walls = this.walls.filter((x) => x !== w);
      }
    }
  }

  // ------------------------------------------------------------------ projectiles & fx

  private spawnProjectile(w: WeaponDef, o: V3, d: V3, local: boolean) {
    const g = new THREE.Group();
    if (w.id === "q_rocket" || w.id === "q_barrage") {
      const k = w.id === "q_barrage" ? 0.65 : 1;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * k, 0.07 * k, 0.5 * k, 12), new THREE.MeshStandardMaterial({ color: 0xdadde6, metalness: 0.8, roughness: 0.25 }));
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07 * k, 0.2 * k, 12), new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xe879f9, emissiveIntensity: 0.6 }));
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -0.35 * k;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.06 * k, 0.45 * k, 8), new THREE.MeshBasicMaterial({ color: 0xffa640 }));
      fire.rotation.x = Math.PI / 2;
      fire.position.z = 0.44 * k;
      g.add(body, nose, fire);
    } else {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x7a5530 }));
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0xcfd6e4, metalness: 0.9, roughness: 0.2 }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.8;
      g.add(shaft, tip);
    }
    g.position.set(...o);
    g.lookAt(o[0] + d[0], o[1] + d[1], o[2] + d[2]);
    this.scene.add(g);
    const sp = w.speed ?? 30;
    this.projs.push({
      mesh: g,
      pos: new THREE.Vector3(...o),
      vel: new THREE.Vector3(d[0] * sp, d[1] * sp, d[2] * sp),
      w,
      local,
      life: 5,
    });
  }

  private removeProj(p: Proj) {
    this.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.projs = this.projs.filter((x) => x !== p);
  }

  private updateProjectiles(dt: number) {
    for (const p of [...this.projs]) {
      const prev = p.pos.clone();
      p.vel.y -= (p.w.gravity ?? 0) * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      const seg = p.pos.clone().sub(prev);
      const len = seg.length();
      if (len > 0) seg.divideScalar(len);
      const o: V3 = [prev.x, prev.y, prev.z];
      const d: V3 = [seg.x, seg.y, seg.z];
      const wt = len > 0 ? rayWorld(o, d, len) : len;
      const worldHit = wt < len - 1e-4;

      if (p.local && this.live && this.oppAlive()) {
        const th = rayTarget(o, d, worldHit ? wt : len, this.oppTarget());
        if (th) {
          const boom = new THREE.Vector3(o[0] + d[0] * th.dist, o[1] + d[1] * th.dist, o[2] + d[2] * th.dist);
          this.registerHit(th.zone);
          this.queue({ type: "hit", w: p.w.id, z: th.zone, dir: norm([seg.x, 0.1, seg.z]) });
          this.finishProjectile(p, boom, false);
          continue;
        }
      }
      if (!p.local) {
        const dx = p.pos.x - this.pos.x;
        const dz = p.pos.z - this.pos.z;
        const dy = p.pos.y - (this.pos.y + this.myDef.height * 0.5);
        if (Math.hypot(dx, dy, dz) < 0.9) {
          this.finishProjectile(p, p.pos.clone(), false);
          continue;
        }
      }
      if (worldHit) {
        this.finishProjectile(p, new THREE.Vector3(o[0] + d[0] * wt, o[1] + d[1] * wt, o[2] + d[2] * wt), p.local);
        continue;
      }
      if (p.life <= 0) {
        this.removeProj(p);
        continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.vel.lengthSq() > 0) p.mesh.lookAt(p.pos.clone().add(p.vel));
    }
  }

  private finishProjectile(p: Proj, at: THREE.Vector3, doSplash: boolean) {
    const w = p.w;
    if (w.splash) {
      this.explosion(at, w.splash);
      if (doSplash && this.live && this.oppAlive()) {
        const t = this.oppTarget();
        const dd = Math.hypot(at.x - t.x, at.y - (t.y + t.height * 0.45), at.z - t.z);
        if (dd < w.splash) {
          this.registerHit("body");
          this.queue({ type: "hit", w: w.id, z: "splash", f: 1 - dd / w.splash, dir: norm([t.x - at.x, 0.4, t.z - at.z]) });
        }
      }
    } else {
      this.spark([at.x, at.y, at.z], 0xe0e6f5, 0.25);
    }
    this.removeProj(p);
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, thick: number, life: number) {
    const len = a.distanceTo(b);
    if (len < 0.05) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    const m = new THREE.Mesh(this.unitBox, mat);
    m.position.copy(a).lerp(b, 0.5);
    m.scale.set(thick, thick, len);
    m.lookAt(b);
    this.scene.add(m);
    this.fx.push({
      obj: m,
      life,
      max: life,
      tick: (f) => {
        mat.opacity = 0.95 * (1 - f);
        const k = 1 - f * 0.6;
        m.scale.set(thick * k, thick * k, len);
      },
      dispose: () => mat.dispose(),
    });
  }

  private spark(p: V3, color: number, size: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const m = new THREE.Mesh(this.unitSphere, mat);
    m.position.set(...p);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.fx.push({
      obj: m,
      life: 0.18,
      max: 0.18,
      tick: (f) => {
        mat.opacity = 1 - f;
        m.scale.setScalar(size * (1 + f * 1.4));
      },
      dispose: () => mat.dispose(),
    });
  }

  private explosion(p: THREE.Vector3, radius: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa940, transparent: true, opacity: 0.9, depthWrite: false });
    const m = new THREE.Mesh(this.unitSphere, mat);
    m.position.copy(p);
    this.scene.add(m);
    this.fx.push({
      obj: m,
      life: 0.45,
      max: 0.45,
      tick: (f) => {
        mat.opacity = 0.9 * (1 - f);
        mat.color.setHex(f < 0.3 ? 0xffe08a : 0xff7a2a);
        m.scale.setScalar(0.3 + radius * 0.8 * Math.sqrt(f));
      },
      dispose: () => mat.dispose(),
    });
    if (p.y < 1.5) this.groundRing([p.x, 0, p.z], radius * 1.1, 0xffb066, 0.4);
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    sfx("explode", clamp(1.2 - dist / 50, 0.2, 1));
    if (dist < 14) this.shake += (1 - dist / 14) * 0.8;
  }

  private updateFx(dt: number) {
    for (const f of [...this.fx]) {
      f.life -= dt;
      const prog = 1 - Math.max(0, f.life) / f.max;
      f.tick?.(prog);
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        f.dispose?.();
        this.fx = this.fx.filter((x) => x !== f);
      }
    }
  }

  private vmMuzzleWorld(): THREE.Vector3 {
    this.vm.updateWorldMatrix(true, true);
    const v = this.vmModel.muzzle.getWorldPosition(this._v.clone());
    this.camera.updateMatrixWorld();
    return v.applyMatrix4(this.camera.matrixWorld);
  }

  // ------------------------------------------------------------------ opponent

  /** Sample the opponent from the snapshot buffer, rendered slightly in the past for smooth motion. */
  private sampleOpp(): NetState | null {
    const s = this.snaps;
    if (!s.length) return this.oppNet;
    const rt = performance.now() + this.serverOffset - INTERP_MS;
    if (rt <= s[0].t) return s[0].s;
    const last = s[s.length - 1];
    if (rt >= last.t) {
      if (s.length >= 2) {
        const prev = s[s.length - 2];
        const span = last.t - prev.t;
        const jump = Math.hypot(last.s.x - prev.s.x, last.s.z - prev.s.z);
        if (span > 5 && span < 400 && jump < 5) {
          const k = Math.min(rt - last.t, 150) / span;
          return {
            x: last.s.x + (last.s.x - prev.s.x) * k,
            y: last.s.y + (last.s.y - prev.s.y) * k,
            z: last.s.z + (last.s.z - prev.s.z) * k,
            yaw: last.s.yaw + angDiff(prev.s.yaw, last.s.yaw) * k,
            pitch: last.s.pitch,
            f: last.s.f,
          };
        }
      }
      return last.s;
    }
    let i = 0;
    while (i + 1 < s.length - 1 && s[i + 1].t <= rt) i++;
    const a = s[i];
    const b = s[i + 1];
    const u = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
    if (Math.hypot(b.s.x - a.s.x, b.s.z - a.s.z) > 6) return u < 0.5 ? a.s : b.s;
    return {
      x: lerp(a.s.x, b.s.x, u),
      y: lerp(a.s.y, b.s.y, u),
      z: lerp(a.s.z, b.s.z, u),
      yaw: a.s.yaw + angDiff(a.s.yaw, b.s.yaw) * u,
      pitch: lerp(a.s.pitch, b.s.pitch, u),
      f: u < 0.5 ? a.s.f : b.s.f,
    };
  }

  private ensureXray() {
    if (this.xray) return this.xray;
    const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
    const clone = this.avatar.body.clone(true);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.renderOrder = 20;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.avatar.root.add(clone);
    this.xray = clone;
    return clone;
  }

  private updateOpp(dt: number) {
    const a = this.oppShown;
    const n = this.sampleOpp();
    if (n) {
      if (!a.init) Object.assign(a, { x: n.x, y: n.y, z: n.z, yaw: n.yaw, pitch: n.pitch, f: n.f, init: true });
      this.oppPrev.x = a.x;
      this.oppPrev.z = a.z;
      a.x = n.x;
      a.y = n.y;
      a.z = n.z;
      a.yaw = n.yaw;
      a.pitch = n.pitch;
      a.f = n.f;
      const vx = (a.x - this.oppPrev.x) / Math.max(dt, 1e-3);
      const vz = (a.z - this.oppPrev.z) / Math.max(dt, 1e-3);
      const kk = 1 - Math.exp(-dt * 10);
      const teleport = Math.hypot(a.x - this.oppPrev.x, a.z - this.oppPrev.z) > 3;
      this.oppVel.x = teleport ? 0 : lerp(this.oppVel.x, vx, kk);
      this.oppVel.z = teleport ? 0 : lerp(this.oppVel.z, vz, kk);
    }
    const av = this.avatar;
    const root = av.root;
    root.visible = a.init;
    root.position.set(a.x, a.y, a.z);
    root.rotation.y = a.yaw;

    this.shieldMesh.visible = (a.f & 1) !== 0;
    this.guardMesh.visible = (a.f & 2) !== 0;
    this.promoteMesh.visible = (a.f & 32) !== 0;
    if (this.shieldMesh.visible) this.shieldMesh.rotation.y += dt;
    if (this.promoteMesh.visible) {
      this.promoteMesh.rotation.z += dt * 3;
      this.promoteMesh.position.y = 0.15 + ((this.t * 0.8) % 1) * this.oppDef.height * 0.9;
    }

    // Locomotion: bob and lean into the movement direction.
    const spd = Math.hypot(this.oppVel.x, this.oppVel.z);
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    const rx = Math.cos(a.yaw);
    const rz = -Math.sin(a.yaw);
    const fc = spd > 0.1 ? (this.oppVel.x * fx + this.oppVel.z * fz) / 14 : 0;
    const sc = spd > 0.1 ? (this.oppVel.x * rx + this.oppVel.z * rz) / 14 : 0;
    this.oppBob += dt * spd * 1.6;
    const dead = this.finished && this.winner === this.o.role;
    if (!dead) {
      av.body.position.y = (a.f & 8) !== 0 ? 0 : Math.abs(Math.sin(this.oppBob)) * 0.06 * Math.min(1, spd / 5);
      av.body.rotation.x = lerp(av.body.rotation.x, -clamp(fc, -0.25, 0.25), Math.min(1, dt * 8));
      av.body.rotation.z = lerp(av.body.rotation.z, -clamp(sc, -0.25, 0.25), Math.min(1, dt * 8));
    } else {
      av.body.rotation.z += (Math.PI / 2 - av.body.rotation.z) * Math.min(1, dt * 3);
    }

    const h = this.oppDef.height;
    av.holder.rotation.x = a.pitch * 0.8;
    av.holder.position.set(
      0.3 * h,
      0.58 * h + Math.sin(this.t * 2) * 0.01,
      -0.2 * h + this.avKick * 0.14 - this.avThrust * 0.7 * Math.sin(Math.PI * Math.min(1, this.avThrust)),
    );
    poseArm(av);

    if (av.spin) {
      const firing = (a.f & 16) !== 0;
      if (firing) av.spin.rotation.z += dt * 28;
      else if (av.spinIdle) av.spin.rotation.z += dt * 2.5;
    }

    if (this.xrayT > 0 && a.init) {
      const x = this.ensureXray();
      x.visible = true;
      x.position.copy(av.body.position);
      x.rotation.copy(av.body.rotation);
    } else if (this.xray) this.xray.visible = false;
  }

  private muzzleFx(ev: Extract<ServerEvent, { type: "fire" }>) {
    const w = WEAPONS[ev.w];
    if (!w) return;
    const dist = Math.hypot(ev.o[0] - this.pos.x, ev.o[2] - this.pos.z);
    const vol = clamp(1.1 - dist / 70, 0.15, 0.8);
    const fsfx = FIRE_SFX[w.id];
    if (fsfx) sfx(fsfx, vol);
    this.avKick = 1;
    if (w.kind === "melee") {
      this.avThrust = 1;
      return;
    }
    if (w.kind === "projectile") {
      this.spawnProjectile(w, [ev.o[0] + ev.d[0] * 0.7, ev.o[1] + ev.d[1] * 0.7 - 0.1, ev.o[2] + ev.d[2] * 0.7], ev.d, false);
      return;
    }
    this.avatar.root.updateMatrixWorld(true);
    const start = this.avatar.muzzle.getWorldPosition(new THREE.Vector3());
    const tr = TRACER[w.id];
    if (ev.e && tr) this.tracer(start, new THREE.Vector3(...ev.e), tr.color, tr.thick, tr.life);
    if (ev.e) this.spark(ev.e, 0xffe9a8, 0.14);
    this.avatarFlash.visible = true;
    this.avFlashT = 0.05;
  }

  // ------------------------------------------------------------------ camera & render

  private updateCamera(dt: number) {
    const def = this.myDef;
    let targetFov = this.aiming && def.aim ? def.aim.fov : BASE_FOV;
    if (!this.aiming) {
      if (this.sprinting) targetFov += 6;
      if (this.dashT > 0) targetFov += 10;
    }
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 12);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const lost = this.finished && this.winner !== undefined && this.winner !== this.o.role;
    this.camRoll += ((lost ? 1.1 : 0) - this.camRoll) * Math.min(1, dt * 3);
    this.shake = Math.max(0, this.shake - dt * 3);
    const sx = (Math.random() - 0.5) * this.shake * 0.02;
    const sy = (Math.random() - 0.5) * this.shake * 0.02;
    const { side } = this.moveInput();
    this.tilt += (-side * 0.014 - this.tilt) * Math.min(1, dt * 8);
    const e = this.eye();
    const spd = Math.hypot(this.vel.x, this.vel.z);
    const bob = this.onGround ? Math.min(1, spd / 6) : 0;
    const drop = lost ? this.camRoll * 0.9 : 0;
    const bobY = Math.sin(this.bobT * 2) * 0.035 * bob * (this.sprinting ? 1.5 : 1);
    this.camera.position.set(e[0], Math.max(0.3, e[1] - drop - this.landDip + bobY), e[2]);
    this.camera.rotation.set(this.pitch + sy + this.recoil * 0.012, this.yaw + sx, this.camRoll + this.tilt);

    // viewmodel
    const vmc = VM[this.o.myPiece];
    const scoped = this.aiming && !!def.aim && def.aim.fov < 40;
    this.vm.visible = !scoped;
    const pri = this.ws.pri;
    const reloadBlend = pri.reloadEnd > 0 ? Math.sin(Math.PI * clamp((this.t - pri.reloadStart) / (pri.reloadEnd - pri.reloadStart), 0, 1)) : 0;
    const sprintBlend = this.sprinting ? 1 : 0;
    this.vmSprint += (sprintBlend - this.vmSprint) * Math.min(1, dt * 9);
    let thrustZ = 0;
    if (this.thrust > 0) thrustZ = -0.55 * Math.sin(Math.PI * (1 - this.thrust));
    const adsShift = this.aiming && !scoped ? 1 : 0;
    this.vm.position.set(
      vmc.pos[0] + Math.sin(this.bobT) * 0.012 * bob - adsShift * vmc.pos[0] * 0.7 - this.vmSprint * 0.08,
      vmc.pos[1] + Math.abs(Math.cos(this.bobT)) * 0.012 * bob + adsShift * 0.07 - reloadBlend * 0.12 - this.vmSprint * 0.07 - this.landDip * 0.2,
      vmc.pos[2] + this.kick * 0.04 + thrustZ,
    );
    this.vm.rotation.set(
      vmc.rot[0] + this.kick * 0.05 - reloadBlend * 0.55 - this.vmSprint * 0.4,
      vmc.rot[1] + this.vmSprint * 0.45,
      vmc.rot[2] + this.tilt * 2,
    );
    const spinTarget = this.vmModel.spinIdle ? 2.5 : (pri.spin / (def.primary.spinUp ?? 1)) * 28;
    if (this.vmModel.spin) this.vmModel.spin.rotation.z += spinTarget * dt;
  }

  private vmSprint = 0;

  private render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.vm.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  // ------------------------------------------------------------------ network

  private netState(): NetState {
    let f = 0;
    if (this.shieldT > 0) f |= 1;
    if (this.guardT > 0) f |= 2;
    if (this.aiming) f |= 4;
    if (!this.onGround) f |= 8;
    if (this.live && this.mouse[0] && this.ws.pri.reloadEnd === 0) f |= 16;
    if (this.promoteT > 0) f |= 32;
    if (this.sprinting) f |= 64;
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, f };
  }

  private async netTick() {
    if (!this.entered || this.disposed || this.finished) return;
    if (this.inflight >= MAX_INFLIGHT) return;
    this.inflight++;
    const seq = ++this.seq;
    const batch = this.outbox.slice();
    const t0 = performance.now();
    try {
      const res = await this.o.transport({ state: this.netState(), events: batch, ack: this.lastEventId, seq });
      if (!res) throw new Error("no response");
      const rtt = performance.now() - t0;
      this.ping = lerp(this.ping || rtt, rtt, 0.3);
      this.fails = 0;
      this.connected = true;
      const maxCid = batch.length ? batch[batch.length - 1].cid : 0;
      this.outbox = this.outbox.filter((e) => e.cid > maxCid);
      if (res.serverTime !== undefined) {
        const est = res.serverTime - (performance.now() - rtt / 2);
        this.serverOffset = this.offsetInit ? lerp(this.serverOffset, est, 0.1) : est;
        this.offsetInit = true;
      }
      if (seq > this.lastAppliedSeq) {
        this.lastAppliedSeq = seq;
        this.handleResponse(res);
      }
    } catch (e) {
      this.fails++;
      if (this.fails <= 3) console.warn("[fight] sync failed", e);
      if (this.fails > 6) this.connected = false;
    } finally {
      this.inflight--;
    }
  }

  private handleResponse(res: SyncResponse) {
    if (this.disposed) return;
    this.prevPhase = this.phase;
    this.phase = res.phase;
    this.countdownMs = res.countdownMs;
    this.timeLeftMs = res.timeLeftMs;
    const mine = this.o.role;
    const theirs: Role = mine === "a" ? "d" : "a";
    this.hp = { me: res.hp[mine], opp: res.hp[theirs], meMax: res.maxHp[mine], oppMax: res.maxHp[theirs] };
    if (res.opp) {
      this.oppNet = res.opp;
      const st = res.oppTime && res.oppTime > 0 ? res.oppTime : performance.now() + this.serverOffset;
      const last = this.snaps[this.snaps.length - 1];
      if (!last || st > last.t) {
        this.snaps.push({ t: st, s: res.opp });
        if (this.snaps.length > 40) this.snaps.shift();
      }
    }

    if (this.phase === "countdown") {
      const s = Math.ceil(res.countdownMs / 1000);
      if (s !== this.lastBeep && s > 0) {
        this.lastBeep = s;
        sfx("beep");
      }
    }
    if (this.prevPhase !== "live" && this.phase === "live") {
      sfx("go");
      this.ws.pri.ammo = this.myDef.primary.mag ?? 0;
    }

    for (const ev of res.events) {
      if (ev.id <= this.lastEventId) continue;
      this.lastEventId = ev.id;
      this.handleServerEvent(ev);
    }

    if ((res.phase === "done" || res.phase === "gone") && !this.finished) {
      this.finished = true;
      this.winner = res.winner;
      this.reason = res.reason;
      this.mouse = [false, false, false];
      if (document.pointerLockElement) document.exitPointerLock();
      if (res.winner !== undefined) sfx(res.winner === mine ? "headshot" : "hurt");
    }
  }

  private handleServerEvent(ev: ServerEvent) {
    if (ev.type === "fire") {
      this.muzzleFx(ev);
    } else if (ev.type === "ability") {
      const dist = this.oppShown.init ? Math.hypot(this.oppShown.x - this.pos.x, this.oppShown.z - this.pos.z) : 30;
      const vol = clamp(1.1 - dist / 70, 0.15, 0.85);
      switch (ev.k) {
        case "blink":
          this.groundRing([this.oppShown.x, this.oppShown.y + 0.1, this.oppShown.z], 2.4, 0x38bdf8, 0.45);
          if (ev.to) this.groundRing([ev.to[0], ev.to[1] + 0.1, ev.to[2]], 2.4, 0x38bdf8, 0.45);
          sfx("blink", vol);
          break;
        case "bulwark":
          sfx("shield", vol);
          break;
        case "guard":
          sfx("guard", vol);
          break;
        case "promote":
          this.groundRing([this.oppShown.x, this.oppShown.y + 0.1, this.oppShown.z], 3, 0xfde047, 0.7);
          sfx("promote", vol);
          break;
        case "mark":
          this.markedT = 6;
          sfx("mark", 0.9);
          break;
        case "rampart":
          if (ev.to && ev.dir) this.addWall(ev.to, ev.dir, 8);
          break;
        case "stomp":
          if (ev.to) {
            this.groundRing(ev.to, 7, 0xffc34d, 0.55);
            this.groundRing(ev.to, 4, 0xffffff, 0.4);
          }
          sfx("stomp", vol);
          this.shake += clamp(1 - dist / 25, 0, 1);
          break;
        case "shockwave":
          if (ev.to) {
            this.groundRing(ev.to, 10, 0xfacc15, 0.7);
            this.groundRing(ev.to, 6, 0x67e8f9, 0.5);
          }
          sfx("shockwave", vol);
          this.shake += clamp(1 - dist / 25, 0, 1.2);
          break;
        case "barrage":
          sfx("barrage", vol);
          break;
        default:
          sfx("dash", vol);
      }
    } else if (ev.type === "damage") {
      if (ev.amount > 0) {
        this.hurtAt = performance.now();
        const ax = -ev.dir[0];
        const az = -ev.dir[2];
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);
        this.hurtAngle = Math.atan2(ax * rx + az * rz, ax * fx + az * fz);
        this.shake += Math.min(1.2, ev.amount / 30);
        sfx("hurt", 0.7);
        const wd = WEAPONS[ev.w];
        if (wd?.knockback) {
          const kb = wd.knockback * (ev.c ? 1.3 : 1);
          const l = Math.hypot(ev.dir[0], ev.dir[2]) || 1;
          this.vel.x += (ev.dir[0] / l) * kb;
          this.vel.z += (ev.dir[2] / l) * kb;
          if (ev.c || wd.splash) {
            this.vel.y = Math.max(this.vel.y, 5);
            this.onGround = false;
          }
        }
      } else if (ev.blocked) {
        sfx("guard", 0.4);
      }
    }
  }

  // ------------------------------------------------------------------ HUD

  private hud(): HudState {
    const w = this.myDef.primary;
    const pri = this.ws.pri;
    const sec = this.ws.sec;
    const s = this.myDef.secondary;
    const scoped = this.aiming && !!this.myDef.aim && this.myDef.aim.fov < 40;
    const activeLeft = (id: string) =>
      id === "bulwark" ? this.shieldT : id === "guard" ? this.guardT : id === "promote" ? this.promoteT : id === "mark" ? this.markT : 0;

    let showOpp = false;
    if (this.oppShown.init) {
      const eye = this.eye();
      const dv: V3 = [this.oppShown.x - eye[0], this.oppShown.y + this.oppDef.height * 0.55 - eye[1], this.oppShown.z - eye[2]];
      const dist = Math.hypot(dv[0], dv[1], dv[2]);
      showOpp = this.xrayT > 0 || (dist > 0.1 && rayWorld(eye, norm(dv), dist) >= dist - 0.3);
    }
    return {
      phase: this.phase,
      countdown: Math.ceil(this.countdownMs / 1000),
      timeLeft: Math.ceil(this.timeLeftMs / 1000),
      myHp: this.hp.me,
      myMax: this.hp.meMax,
      oppHp: this.hp.opp,
      oppMax: this.hp.oppMax,
      ammo: w.mag !== undefined ? pri.ammo : null,
      mag: w.mag ?? null,
      reload: pri.reloadEnd > 0 ? Math.min(1, (this.t - pri.reloadStart) / (pri.reloadEnd - pri.reloadStart)) : 0,
      priCd: Math.max(0, Math.min(1, (pri.cd - this.t) / Math.max(0.2, w.cooldown))),
      secCd: s ? Math.max(0, Math.min(1, (sec.cd - this.t) / s.cooldown)) : 0,
      abilities: [0, 1].map((i) => ({
        cd: Math.max(0, Math.min(1, (this.abCd[i] - this.t) / this.abCdMax[i])),
        active: Math.max(0, activeLeft(this.myDef.abilities[i].id)),
      })),
      charge: s?.chargeTime ? sec.charge / s.chargeTime : 0,
      locked: this.locked,
      scoped,
      aiming: this.aiming,
      sprinting: this.sprinting,
      marked: this.markedT > 0,
      xray: this.xrayT > 0,
      hitAt: this.hitAt,
      hitKind: this.hitKind,
      hurtAt: this.hurtAt,
      hurtAngle: this.hurtAngle,
      winner: this.winner,
      reason: this.reason,
      finished: this.finished,
      connected: this.connected,
      ping: Math.round(this.ping),
      fps: Math.round(this.fps),
      pointerFallback: this.lockFailed && !this.locked && !this.touchMode,
      inArena: this.entered,
      quality: this.quality,
      radar: { x: this.pos.x, z: this.pos.z, yaw: this.yaw, ox: this.oppShown.x, oz: this.oppShown.z, showOpp },
    };
  }
}

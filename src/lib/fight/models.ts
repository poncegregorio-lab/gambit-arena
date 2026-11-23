import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Color, PieceType } from "@/lib/chess";
import { PIECES } from "./weapons";

type P2 = [number, number];

const PROFILES: Record<PieceType, P2[]> = {
  p: [[0.001, 0], [0.5, 0], [0.52, 0.06], [0.5, 0.1], [0.42, 0.17], [0.34, 0.3], [0.24, 0.5], [0.17, 0.75], [0.15, 0.95], [0.3, 1.02], [0.3, 1.1], [0.12, 1.16], [0.001, 1.16]],
  r: [[0.001, 0], [0.54, 0], [0.56, 0.06], [0.52, 0.12], [0.44, 0.2], [0.36, 0.35], [0.31, 0.6], [0.3, 0.9], [0.38, 1.22], [0.5, 1.3], [0.5, 1.62], [0.001, 1.62]],
  b: [[0.001, 0], [0.52, 0], [0.54, 0.06], [0.5, 0.11], [0.4, 0.2], [0.3, 0.35], [0.22, 0.6], [0.18, 0.85], [0.34, 0.95], [0.34, 1.05], [0.16, 1.12], [0.001, 1.12]],
  q: [[0.001, 0], [0.56, 0], [0.58, 0.06], [0.54, 0.11], [0.44, 0.2], [0.34, 0.35], [0.24, 0.65], [0.2, 0.95], [0.3, 1.2], [0.46, 1.65], [0.4, 1.78], [0.22, 1.82], [0.001, 1.82]],
  k: [[0.001, 0], [0.58, 0], [0.6, 0.06], [0.56, 0.11], [0.46, 0.2], [0.36, 0.35], [0.26, 0.7], [0.22, 1.0], [0.32, 1.25], [0.5, 1.8], [0.42, 1.95], [0.24, 2.0], [0.001, 2.0]],
  n: [[0.001, 0], [0.54, 0], [0.56, 0.06], [0.52, 0.12], [0.44, 0.2], [0.36, 0.35], [0.33, 0.6], [0.36, 0.82], [0.001, 0.86]],
};

const NOMINAL: Record<PieceType, number> = { p: 1.7, n: 2.3, b: 2.0, r: 1.82, q: 2.1, k: 2.5 };
// visor slit: [y, z, width]
const VISOR: Record<PieceType, [number, number, number]> = {
  p: [1.42, -0.29, 0.3],
  r: [1.45, -0.5, 0.5],
  b: [1.45, -0.27, 0.28],
  q: [1.55, -0.4, 0.34],
  k: [1.6, -0.42, 0.34],
  n: [0, 0, 0],
};

function mk(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const rb = (w: number, h: number, d: number, r = 0.012) =>
  new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));

function cylZ(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, r2 = r): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r2, len, 20);
  geo.rotateX(Math.PI / 2);
  return mk(geo, m, x, y, z);
}

const std = (color: number, rough = 0.5, metal = 0.2) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

const glow = (color: number, intensity = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });

const goldMat = () => std(0xe6b84f, 0.26, 1);

function knightHead(body: THREE.Material, gold: THREE.Material, eye: THREE.Material): THREE.Group {
  // Side profile of a horse head: x is "forward", y is up.
  const pts: P2[] = [
    [-0.34, 0.78], [-0.42, 1.25], [-0.38, 1.7], [-0.2, 2.02], [-0.14, 2.36], [0.02, 2.1], [0.16, 2.08],
    [0.5, 1.82], [0.7, 1.7], [0.78, 1.56], [0.64, 1.46], [0.38, 1.5], [0.22, 1.34], [0.38, 1.0], [0.44, 0.78],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 5,
    curveSegments: 8,
  });
  geo.translate(0, 0, -0.15);
  geo.rotateY(Math.PI / 2); // forward (+x) becomes -z
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(mk(geo, body));
  // Gold mane along the neck
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const y = 0.95 + t * 1.3;
    const x = -0.42 + Math.sin(t * Math.PI) * 0.04 - t * 0.0;
    const s = mk(new THREE.SphereGeometry(0.075 - t * 0.012, 12, 10), gold, 0, y, -x + 0.02);
    s.scale.set(0.85, 1.4, 1);
    g.add(s);
  }
  for (const sx of [-1, 1]) {
    g.add(mk(new THREE.SphereGeometry(0.035, 10, 8), eye, sx * 0.25, 1.77, -0.32));
    g.add(mk(new THREE.SphereGeometry(0.025, 8, 6), std(0x111111, 0.5, 0), sx * 0.2, 1.52, -0.74)); // nostril
  }
  return g;
}

export interface Avatar {
  root: THREE.Group;
  body: THREE.Group;
  holder: THREE.Group;
  weapon: THREE.Group;
  muzzle: THREE.Object3D;
  arm: THREE.Mesh;
  hand: THREE.Mesh;
  spin?: THREE.Object3D;
  spinIdle: boolean;
  shoulder: THREE.Vector3;
  armBase: number;
}

export function buildPieceBody(type: PieceType, color: Color): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: color === "w" ? 0xf2ecdc : 0x23252f,
    roughness: color === "w" ? 0.3 : 0.2,
    metalness: color === "w" ? 0.02 : 0.35,
  });
  const gold = goldMat();
  const accentColor = new THREE.Color(PIECES[type].accent);
  const accent = new THREE.MeshBasicMaterial({ color: accentColor });
  const eye = glow(accentColor.getHex(), 2.4);

  g.add(mk(new THREE.LatheGeometry(PROFILES[type].map(([r, y]) => new THREE.Vector2(r, y)), 64), bodyMat));
  // Glowing accent ring around the base so each piece reads clearly from far away.
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.018, 8, 48), accent);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.075;
  g.add(baseRing);

  const collar = (y: number, r: number, t = 0.03) => {
    const m = mk(new THREE.TorusGeometry(r, t, 10, 40), gold, 0, y, 0);
    m.rotation.x = Math.PI / 2;
    g.add(m);
  };

  switch (type) {
    case "p":
      g.add(mk(new THREE.SphereGeometry(0.3, 32, 24), bodyMat, 0, 1.4, 0));
      collar(1.06, 0.3);
      collar(0.52, 0.2, 0.022);
      break;
    case "r": {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const m = mk(rb(0.24, 0.26, 0.2, 0.02), bodyMat, Math.cos(a) * 0.4, 1.76, Math.sin(a) * 0.4);
        m.rotation.y = -a;
        g.add(m);
      }
      collar(1.3, 0.5);
      collar(0.92, 0.31, 0.022);
      break;
    }
    case "b": {
      const head = mk(new THREE.SphereGeometry(0.3, 32, 24), bodyMat, 0, 1.45, 0);
      head.scale.y = 1.4;
      g.add(head);
      g.add(mk(new THREE.SphereGeometry(0.085, 14, 12), gold, 0, 1.99, 0));
      g.add(mk(new THREE.BoxGeometry(0.03, 0.12, 0.03), gold, 0, 2.1, 0));
      g.add(mk(new THREE.BoxGeometry(0.1, 0.03, 0.03), gold, 0, 2.12, 0));
      const cut = mk(new THREE.BoxGeometry(0.5, 0.045, 0.06), gold, 0, 1.58, 0.1);
      cut.rotation.z = 0.7;
      cut.position.set(0, 1.6, 0.18);
      g.add(cut);
      collar(1.03, 0.34);
      collar(1.12, 0.17, 0.02);
      break;
    }
    case "q": {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const cone = mk(new THREE.ConeGeometry(0.06, 0.24, 10), gold, Math.cos(a) * 0.37, 1.95, Math.sin(a) * 0.37);
        g.add(cone);
        g.add(mk(new THREE.SphereGeometry(0.045, 10, 8), gold, Math.cos(a) * 0.37, 2.1, Math.sin(a) * 0.37));
      }
      g.add(mk(new THREE.SphereGeometry(0.16, 20, 16), gold, 0, 2.0, 0));
      collar(1.5, 0.47);
      collar(1.2, 0.3, 0.022);
      break;
    }
    case "k": {
      const band = mk(new THREE.CylinderGeometry(0.34, 0.38, 0.14, 40, 1, true), gold, 0, 2.05, 0);
      (band.material as THREE.Material).side = THREE.DoubleSide;
      g.add(band);
      for (let i = 0; i < 2; i++) {
        const arch = mk(new THREE.TorusGeometry(0.33, 0.03, 8, 28, Math.PI), gold, 0, 2.1, 0);
        arch.rotation.y = (i * Math.PI) / 2;
        g.add(arch);
      }
      g.add(mk(new THREE.SphereGeometry(0.1, 14, 12), gold, 0, 2.43, 0));
      g.add(mk(new THREE.BoxGeometry(0.1, 0.46, 0.1), gold, 0, 2.62, 0));
      g.add(mk(new THREE.BoxGeometry(0.34, 0.1, 0.1), gold, 0, 2.68, 0));
      collar(1.62, 0.5);
      collar(1.0, 0.24, 0.022);
      break;
    }
    case "n": {
      g.add(knightHead(bodyMat, gold, eye));
      collar(0.85, 0.36);
      break;
    }
  }

  if (type !== "n") {
    const [vy, vz, vw] = VISOR[type];
    const visor = new THREE.Mesh(new THREE.BoxGeometry(vw, 0.07, 0.06), eye);
    visor.position.set(0, vy, vz);
    g.add(visor);
  }
  g.scale.setScalar(PIECES[type].height / NOMINAL[type]);
  return g;
}

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  spin?: THREE.Object3D;
  spinIdle?: boolean;
}

export function buildWeaponModel(type: PieceType): WeaponModel {
  const g = new THREE.Group();
  const dark = std(0x3b414f, 0.35, 0.75);
  const dark2 = std(0x1f232c, 0.5, 0.5);
  const steel = std(0xc3cad8, 0.28, 0.95);
  const gold = goldMat();
  const gripMat = std(0x16181d, 0.85, 0);
  const muzzle = new THREE.Object3D();
  let spin: THREE.Object3D | undefined;
  let spinIdle = false;

  switch (type) {
    case "p": {
      g.add(mk(rb(0.056, 0.07, 0.3, 0.014), dark, 0, 0, -0.05));
      for (let i = 0; i < 5; i++) g.add(mk(new THREE.BoxGeometry(0.058, 0.05, 0.005), dark2, 0, 0, 0.055 + i * 0.014));
      g.add(mk(rb(0.05, 0.04, 0.24, 0.01), steel, 0, -0.052, -0.02));
      const grip = mk(rb(0.046, 0.13, 0.07, 0.016), gripMat, 0, -0.115, 0.078);
      grip.rotation.x = 0.22;
      g.add(grip);
      g.add(mk(new THREE.BoxGeometry(0.008, 0.03, 0.05), steel, 0, -0.085, -0.045));
      g.add(mk(new THREE.BoxGeometry(0.008, 0.012, 0.06), steel, 0, -0.105, -0.015));
      g.add(cylZ(0.016, 0.1, steel, 0, 0.004, -0.22));
      g.add(mk(new THREE.BoxGeometry(0.01, 0.016, 0.012), dark2, 0, 0.043, -0.185));
      g.add(mk(new THREE.BoxGeometry(0.03, 0.014, 0.012), dark2, 0, 0.042, 0.075));
      g.add(mk(new THREE.BoxGeometry(0.012, 0.004, 0.27), gold, 0, 0.037, -0.05));
      g.add(mk(new THREE.SphereGeometry(0.006, 8, 6), glow(0x7dd3fc, 3), 0, 0.05, -0.185));
      muzzle.position.set(0, 0.004, -0.275);
      break;
    }
    case "n": {
      const wood = std(0x7a4f2a, 0.62, 0);
      const shaft = new THREE.CylinderGeometry(0.034, 0.02, 2.1, 16);
      shaft.rotateX(Math.PI / 2); // thick butt toward +z, slim tip toward -z
      g.add(mk(shaft, wood, 0, 0, -0.5));
      for (const z of [-1.25, -0.85, -0.45, -0.05]) {
        g.add(mk(new THREE.TorusGeometry(0.032 - (z + 1.25) * 0.004, 0.008, 8, 20), gold, 0, 0, z));
      }
      const cup = new THREE.ConeGeometry(0.17, 0.28, 28, 1, true);
      cup.rotateX(-Math.PI / 2); // apex forward
      const cupMesh = mk(cup, gold, 0, 0, -0.12);
      (cupMesh.material as THREE.Material).side = THREE.DoubleSide;
      g.add(cupMesh);
      g.add(cylZ(0.037, 0.32, gripMat, 0, 0, 0.1));
      g.add(mk(new THREE.SphereGeometry(0.048, 14, 12), gold, 0, 0, 0.56));
      const tip = new THREE.ConeGeometry(0.058, 0.55, 18);
      tip.rotateX(-Math.PI / 2);
      g.add(mk(tip, steel, 0, 0, -1.82));
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7, side: THREE.DoubleSide });
      const flag = mk(new THREE.PlaneGeometry(0.42, 0.2, 6, 1), flagMat, 0.21, 0.02, -1.4);
      flag.rotation.y = Math.PI / 2;
      flag.rotation.x = 0.0;
      flag.rotation.set(0, 0, 0);
      flag.rotateY(Math.PI / 2);
      flag.position.set(0.0, 0.1, -1.36);
      g.add(flag);
      const flagEdge = mk(new THREE.BoxGeometry(0.006, 0.2, 0.42), gold, 0, 0.1, -1.36);
      g.add(flagEdge);
      muzzle.position.set(0, 0, -2.1);
      break;
    }
    case "b": {
      const wood = std(0x5a3b22, 0.6, 0);
      g.add(mk(rb(0.06, 0.1, 0.5, 0.014), dark, 0, 0, -0.12));
      g.add(mk(rb(0.05, 0.13, 0.34, 0.02), wood, 0, -0.02, 0.3));
      g.add(mk(rb(0.048, 0.07, 0.28, 0.012), wood, 0, -0.012, -0.52));
      g.add(cylZ(0.017, 0.92, steel, 0, 0.012, -0.72));
      g.add(cylZ(0.027, 0.1, dark2, 0, 0.012, -1.12));
      for (let i = 0; i < 3; i++) g.add(mk(new THREE.BoxGeometry(0.06, 0.01, 0.012), dark, 0, 0.012, -1.09 - i * 0.025));
      g.add(cylZ(0.03, 0.34, dark2, 0, 0.098, -0.14));
      g.add(cylZ(0.042, 0.08, dark2, 0, 0.098, -0.34));
      g.add(cylZ(0.035, 0.06, dark2, 0, 0.098, 0.07));
      g.add(cylZ(0.037, 0.004, glow(0x7dd3fc, 2.6), 0, 0.098, -0.382));
      g.add(mk(new THREE.BoxGeometry(0.02, 0.03, 0.03), dark, 0, 0.065, -0.07));
      g.add(mk(new THREE.BoxGeometry(0.02, 0.03, 0.03), dark, 0, 0.065, -0.22));
      g.add(cylZ(0.008, 0.07, steel, 0.05, 0.02, 0.0));
      g.children[g.children.length - 1].rotation.set(0, 0, Math.PI / 2);
      g.add(mk(new THREE.SphereGeometry(0.014, 10, 8), gold, 0.085, 0.02, 0));
      g.add(mk(rb(0.045, 0.1, 0.07, 0.01), dark2, 0, -0.085, -0.1));
      g.add(mk(new THREE.BoxGeometry(0.004, 0.06, 0.013), gold, 0.027, -0.005, 0.32));
      g.add(mk(new THREE.BoxGeometry(0.004, 0.014, 0.044), gold, 0.027, 0.005, 0.32));
      muzzle.position.set(0, 0.012, -1.2);
      break;
    }
    case "r": {
      g.add(mk(rb(0.22, 0.24, 0.44, 0.03), dark, 0, 0, 0));
      g.add(mk(rb(0.05, 0.12, 0.05, 0.01), dark2, -0.06, 0.17, 0.0));
      g.add(mk(rb(0.05, 0.12, 0.05, 0.01), dark2, 0.06, 0.17, 0.0));
      g.add(mk(rb(0.18, 0.04, 0.06, 0.012), gripMat, 0, 0.24, 0.0));
      const drumGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 28);
      drumGeo.rotateZ(Math.PI / 2);
      g.add(mk(drumGeo, dark2, -0.21, -0.06, 0.06));
      for (const dx of [-0.29, -0.13]) {
        const rim = new THREE.CylinderGeometry(0.128, 0.128, 0.014, 28);
        rim.rotateZ(Math.PI / 2);
        g.add(mk(rim, gold, dx, -0.06, 0.06));
      }
      for (let i = 0; i < 7; i++) g.add(mk(new THREE.BoxGeometry(0.03, 0.022, 0.03), gold, -0.12 + i * 0.001, -0.02 + i * 0.005, 0.06 - i * 0.012));
      g.add(mk(new THREE.BoxGeometry(0.005, 0.1, 0.22), glow(0xff6a2a, 1.6), 0.112, 0.03, -0.05));
      g.add(mk(new THREE.BoxGeometry(0.005, 0.1, 0.22), glow(0xff6a2a, 1.6), -0.112, 0.03, -0.05));
      const sp = new THREE.Group();
      sp.position.set(0, 0, -0.52);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        sp.add(cylZ(0.019, 0.72, steel, Math.cos(a) * 0.066, Math.sin(a) * 0.066, 0));
      }
      for (const z of [-0.3, 0.0, 0.3]) sp.add(cylZ(0.1, 0.03, gold, 0, 0, z));
      sp.add(cylZ(0.04, 0.72, dark2, 0, 0, 0));
      g.add(sp);
      spin = sp;
      muzzle.position.set(0, 0, -0.92);
      break;
    }
    case "q": {
      const pearl = std(0xf0e6f6, 0.22, 0.65);
      g.add(mk(rb(0.07, 0.11, 0.5, 0.02), pearl, 0, 0, 0));
      g.add(mk(new THREE.BoxGeometry(0.074, 0.012, 0.32), glow(0xe879f9, 2.2), 0, 0.022, -0.04));
      g.add(cylZ(0.03, 0.3, steel, 0, 0.012, -0.4));
      g.add(cylZ(0.014, 0.22, steel, 0, 0.012, -0.64));
      g.add(mk(rb(0.05, 0.12, 0.26, 0.02), pearl, 0, -0.02, 0.32));
      const mag = mk(rb(0.05, 0.14, 0.08, 0.01), dark2, 0, -0.115, 0.0);
      mag.rotation.x = 0.12;
      g.add(mag);
      g.add(cylZ(0.05, 0.5, dark2, 0, -0.088, -0.12));
      g.add(cylZ(0.058, 0.04, gold, 0, -0.088, -0.36));
      g.add(mk(new THREE.SphereGeometry(0.03, 14, 10), glow(0xe879f9, 2.8), 0, -0.088, -0.385));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mk(new THREE.ConeGeometry(0.011, 0.045, 8), gold, Math.cos(a) * 0.028, 0.076, -0.2 + Math.sin(a) * 0.028));
      }
      g.add(mk(new THREE.SphereGeometry(0.012, 8, 6), glow(0xff3355, 3), 0, 0.06, 0.02));
      muzzle.position.set(0, 0.012, -0.76);
      break;
    }
    case "k": {
      g.add(cylZ(0.026, 1.1, gold, 0, 0, 0.18));
      for (let i = 0; i < 6; i++) g.add(mk(new THREE.TorusGeometry(0.03, 0.006, 6, 14), dark2, 0, 0, 0.3 + i * 0.1));
      g.add(mk(rb(0.15, 0.17, 0.46, 0.03), gold, 0, 0, -0.45));
      g.add(mk(rb(0.153, 0.05, 0.3, 0.01), dark2, 0, 0, -0.45));
      g.add(cylZ(0.05, 0.36, dark2, 0, 0, -0.82));
      g.add(cylZ(0.066, 0.04, gold, 0, 0, -0.97));
      g.add(mk(new THREE.SphereGeometry(0.044, 16, 12), glow(0x67e8f9, 3), 0, 0.11, -0.45));
      const ring = mk(new THREE.TorusGeometry(0.1, 0.012, 8, 28), gold, 0, 0, -0.64);
      g.add(ring);
      const sp = new THREE.Group();
      sp.position.set(0, 0, -0.45);
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.007, 8, 32), glow(0x67e8f9, 2.2));
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.007, 8, 32), glow(0x67e8f9, 2.2));
      r2.rotation.x = Math.PI / 2;
      sp.add(r1, r2);
      g.add(sp);
      spin = sp;
      spinIdle = true;
      g.add(mk(new THREE.SphereGeometry(0.065, 16, 12), gold, 0, 0, 0.74));
      g.add(mk(new THREE.BoxGeometry(0.014, 0.07, 0.014), gold, 0, 0.08, 0.74));
      g.add(mk(new THREE.BoxGeometry(0.05, 0.014, 0.014), gold, 0, 0.095, 0.74));
      muzzle.position.set(0, 0, -1.0);
      break;
    }
  }
  g.add(muzzle);
  return { group: g, muzzle, spin, spinIdle };
}

export function buildAvatar(type: PieceType, color: Color): Avatar {
  const root = new THREE.Group();
  const body = buildPieceBody(type, color);
  root.add(body);
  const wm = buildWeaponModel(type);
  const h = PIECES[type].height;
  const k = h / 1.8;
  const holder = new THREE.Group();
  holder.position.set(0.3 * h, 0.58 * h, -0.2 * h);
  wm.group.scale.setScalar(type === "n" ? 0.9 : 1.15);
  holder.add(wm.group);
  root.add(holder);

  const armMat = new THREE.MeshStandardMaterial({ color: color === "w" ? 0xe9e2cf : 0x2c2f3a, roughness: 0.4, metalness: 0.3 });
  const armR = 0.07 * k;
  const armGeo = new THREE.CapsuleGeometry(armR, 1, 6, 12);
  armGeo.rotateX(Math.PI / 2);
  const arm = mk(armGeo, armMat);
  const hand = mk(new THREE.SphereGeometry(0.095 * k, 14, 12), goldMat());
  root.add(arm, hand);
  return {
    root,
    body,
    holder,
    weapon: wm.group,
    muzzle: wm.muzzle,
    arm,
    hand,
    spin: wm.spin,
    spinIdle: !!wm.spinIdle,
    shoulder: new THREE.Vector3(0.2 * h, 0.66 * h, -0.02),
    armBase: 1 + 2 * armR,
  };
}

const _dir = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

/** Aim the arm capsule from the shoulder to wherever the weapon holder currently is. */
export function poseArm(av: Avatar) {
  const to = av.holder.position;
  _dir.copy(to).sub(av.shoulder);
  const len = Math.max(0.05, _dir.length());
  _dir.divideScalar(len);
  av.arm.position.copy(av.shoulder).addScaledVector(_dir, len / 2);
  av.arm.quaternion.setFromUnitVectors(_z, _dir);
  av.arm.scale.set(1, 1, len / av.armBase);
  av.hand.position.copy(to);
}

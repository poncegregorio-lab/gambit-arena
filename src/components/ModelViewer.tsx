"use client";

import { useEffect, useRef, useState } from "react";
import type { Color, PieceType } from "@/lib/chess";

/** Turntable view of a piece (with its weapon in hand) or of just the weapon, rendered with the real in-game models. */
export function ModelViewer({ piece, color, view }: { piece: PieceType; color: Color; view: "piece" | "weapon" }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef({ down: false, x: 0, spin: 0.6 });

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const [THREE, { RoomEnvironment }, models] = await Promise.all([
          import("three"),
          import("three/examples/jsm/environments/RoomEnvironment.js"),
          import("@/lib/fight/models"),
        ]);
        const el = host.current;
        if (disposed || !el) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.enabled = true;
        el.appendChild(renderer.domElement);
        renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";
        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        scene.environment = env;
        scene.environmentIntensity = 0.9;
        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303548, 1.2));
        const key = new THREE.DirectionalLight(0xfff1d8, 2.4);
        key.position.set(3, 5, 4);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
        rim.position.set(-4, 3, -3);
        scene.add(rim);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.6, metalness: 0.3 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const turntable = new THREE.Group();
        scene.add(turntable);
        let spin: import("three").Object3D | undefined;
        let spinIdle = false;
        let avatar: ReturnType<typeof models.buildAvatar> | null = null;
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
        if (view === "piece") {
          avatar = models.buildAvatar(piece, color);
          avatar.root.rotation.y = Math.PI * 0.12;
          turntable.add(avatar.root);
          spin = avatar.spin;
          spinIdle = true;
          models.poseArm(avatar);
          const h = avatar.body.children.length ? 2.4 : 2;
          camera.position.set(0, h * 0.62, h * 2.35);
          camera.lookAt(0, h * 0.45, 0);
        } else {
          const w = models.buildWeaponModel(piece);
          const box = new THREE.Box3().setFromObject(w.group);
          const size = box.getSize(new THREE.Vector3());
          const centre = box.getCenter(new THREE.Vector3());
          const k = 2.3 / Math.max(size.x, size.y, size.z);
          w.group.position.sub(centre);
          const holder = new THREE.Group();
          holder.add(w.group);
          holder.scale.setScalar(k);
          holder.position.y = 1.0;
          holder.rotation.y = Math.PI / 2; // side-on, barrel pointing right
          turntable.add(holder);
          spin = w.spin;
          spinIdle = true;
          camera.position.set(0, 1.5, 4.2);
          camera.lookAt(0, 1.0, 0);
        }

        const resize = () => {
          const w = Math.max(1, el.clientWidth);
          const h = Math.max(1, el.clientHeight);
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);

        const dom = renderer.domElement;
        const down = (e: PointerEvent) => {
          drag.current.down = true;
          drag.current.x = e.clientX;
          dom.setPointerCapture(e.pointerId);
          dom.style.cursor = "grabbing";
        };
        const move = (e: PointerEvent) => {
          if (!drag.current.down) return;
          turntable.rotation.y += (e.clientX - drag.current.x) * 0.012;
          drag.current.x = e.clientX;
        };
        const up = () => {
          drag.current.down = false;
          dom.style.cursor = "grab";
        };
        dom.addEventListener("pointerdown", down);
        dom.addEventListener("pointermove", move);
        dom.addEventListener("pointerup", up);

        let raf = 0;
        let last = performance.now();
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (!drag.current.down) turntable.rotation.y += dt * 0.5;
          if (spin && spinIdle) spin.rotation.z += dt * 2;
          if (avatar) avatar.body.position.y = 0;
          renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(loop);

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          dom.removeEventListener("pointerdown", down);
          dom.removeEventListener("pointermove", move);
          dom.removeEventListener("pointerup", up);
          scene.traverse((o) => {
            const m = o as import("three").Mesh;
            m.geometry?.dispose();
            const mat = m.material as import("three").Material | import("three").Material[] | undefined;
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
            else mat?.dispose();
          });
          env.dispose();
          renderer.dispose();
          dom.remove();
        };
      } catch (e) {
        console.error(e);
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [piece, color, view]);

  if (failed) return <div className="grid h-full place-items-center text-xs text-[#6f788d]">3D preview needs WebGL</div>;
  return <div ref={host} className="h-full w-full" />;
}

export type SfxKind =
  | "pistol"
  | "rifle"
  | "sniper"
  | "chaingun"
  | "rail"
  | "rocket"
  | "lance"
  | "javelin"
  | "explode"
  | "hit"
  | "headshot"
  | "hurt"
  | "reload"
  | "dash"
  | "blink"
  | "shield"
  | "guard"
  | "beep"
  | "go"
  | "charge"
  | "step"
  | "stomp"
  | "barrage"
  | "mark"
  | "promote"
  | "rampart"
  | "shockwave"
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "gameover"
  | "select"
  | "illegal";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

export function initAudio() {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
}

function tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = "square", delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur: number, gain: number, lp: number, delay = 0) {
  if (!ctx || !noise) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(lp, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, lp / 6), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export function sfx(kind: SfxKind, vol = 1) {
  if (!ctx || muted) return;
  const v = vol;
  switch (kind) {
    case "pistol":
      burst(0.12, 0.35 * v, 5000);
      tone(520, 90, 0.1, 0.18 * v);
      break;
    case "rifle":
      burst(0.09, 0.22 * v, 6000);
      tone(700, 120, 0.07, 0.1 * v);
      break;
    case "chaingun":
      burst(0.07, 0.2 * v, 4000);
      tone(300, 70, 0.06, 0.1 * v, "sawtooth");
      break;
    case "sniper":
      burst(0.35, 0.6 * v, 3500);
      tone(300, 40, 0.35, 0.3 * v, "sawtooth");
      break;
    case "rail":
      tone(1800, 120, 0.5, 0.25 * v, "sawtooth");
      burst(0.4, 0.35 * v, 7000);
      break;
    case "rocket":
      burst(0.4, 0.35 * v, 2500);
      tone(180, 50, 0.4, 0.2 * v, "sawtooth");
      break;
    case "lance":
      burst(0.18, 0.3 * v, 2500);
      tone(240, 90, 0.15, 0.12 * v, "triangle");
      break;
    case "javelin":
      burst(0.22, 0.22 * v, 1800);
      tone(500, 200, 0.2, 0.08 * v, "triangle");
      break;
    case "explode":
      burst(0.7, 0.7 * v, 1800);
      tone(110, 30, 0.6, 0.35 * v, "sawtooth");
      break;
    case "hit":
      tone(1400, 900, 0.07, 0.18 * v, "sine");
      break;
    case "headshot":
      tone(2000, 1500, 0.09, 0.22 * v, "sine");
      tone(1000, 800, 0.1, 0.15 * v, "sine", 0.05);
      break;
    case "hurt":
      tone(160, 60, 0.18, 0.3 * v, "sawtooth");
      burst(0.12, 0.2 * v, 900);
      break;
    case "reload":
      tone(900, 600, 0.04, 0.08 * v);
      tone(500, 400, 0.05, 0.08 * v, "square", 0.25);
      tone(1100, 700, 0.04, 0.08 * v, "square", 0.5);
      break;
    case "dash":
      burst(0.25, 0.25 * v, 3000);
      break;
    case "blink":
      tone(300, 1600, 0.2, 0.15 * v, "sine");
      tone(1600, 300, 0.2, 0.1 * v, "sine", 0.15);
      break;
    case "shield":
      tone(200, 400, 0.25, 0.2 * v, "triangle");
      break;
    case "guard":
      tone(400, 900, 0.5, 0.2 * v, "sine");
      tone(600, 1200, 0.5, 0.12 * v, "sine");
      break;
    case "beep":
      tone(660, 660, 0.12, 0.15 * v, "sine");
      break;
    case "go":
      tone(990, 990, 0.35, 0.2 * v, "sine");
      break;
    case "step":
      burst(0.05, 0.05 * v, 900);
      break;
    case "stomp":
      burst(0.45, 0.6 * v, 700);
      tone(90, 30, 0.45, 0.4 * v, "sine");
      break;
    case "barrage":
      burst(0.12, 0.28 * v, 3000);
      tone(260, 90, 0.15, 0.12 * v, "sawtooth");
      break;
    case "mark":
      tone(700, 1400, 0.25, 0.15 * v, "sine");
      tone(1400, 700, 0.25, 0.1 * v, "sine", 0.2);
      break;
    case "promote":
      tone(520, 520, 0.12, 0.14 * v, "triangle");
      tone(660, 660, 0.12, 0.14 * v, "triangle", 0.1);
      tone(880, 880, 0.25, 0.16 * v, "triangle", 0.2);
      break;
    case "rampart":
      burst(0.5, 0.5 * v, 500);
      tone(70, 40, 0.5, 0.35 * v, "sine");
      break;
    case "shockwave":
      burst(0.6, 0.6 * v, 1400);
      tone(160, 35, 0.6, 0.4 * v, "sawtooth");
      tone(900, 200, 0.35, 0.12 * v, "sine");
      break;
    // ---- board sounds (soft wooden clicks, like a physical board) ----
    case "move":
      tone(210, 120, 0.06, 0.22 * v, "triangle");
      burst(0.04, 0.12 * v, 2500);
      break;
    case "capture":
      tone(160, 70, 0.12, 0.3 * v, "triangle");
      burst(0.09, 0.28 * v, 3200);
      break;
    case "check":
      tone(180, 100, 0.08, 0.22 * v, "triangle");
      tone(740, 740, 0.14, 0.1 * v, "sine", 0.06);
      break;
    case "castle":
      tone(210, 120, 0.06, 0.2 * v, "triangle");
      tone(240, 140, 0.06, 0.2 * v, "triangle", 0.11);
      break;
    case "gameover":
      tone(392, 392, 0.2, 0.15 * v, "triangle");
      tone(330, 330, 0.2, 0.15 * v, "triangle", 0.18);
      tone(262, 262, 0.45, 0.17 * v, "triangle", 0.36);
      break;
    case "select":
      tone(520, 480, 0.03, 0.06 * v, "sine");
      break;
    case "illegal":
      tone(130, 110, 0.12, 0.12 * v, "square");
      break;
    case "charge":
      tone(200, 1200, 0.8, 0.1 * v, "sawtooth");
      break;
  }
}

import type { PieceType } from "@/lib/chess";

export type V3 = [number, number, number];

export const FIGHT_DURATION_MS = 75_000;
export const COUNTDOWN_MS = 4_000;
export const BULWARK_REDUCTION = 0.35; // damage multiplier while the Rook's Bulwark is up
export const UNDERDOG_THRESHOLD = 0.4;
export const UNDERDOG_DAMAGE = 1.25;
export const UNDERDOG_SPEED = 1.2;
export const PROMOTE_DAMAGE = 1.3;
export const PROMOTE_SPEED = 1.15;
export const PROMOTE_HEAL = 25;
export const MARK_DAMAGE = 1.2;
export const SPRINT_MULT = 1.32;

export interface WeaponDef {
  id: string;
  name: string;
  button: "LMB" | "RMB" | "E" | "Q";
  kind: "hitscan" | "melee" | "projectile";
  damage: number;
  headMult: number;
  cooldown: number; // seconds
  range: number;
  auto: boolean;
  mag?: number;
  reload?: number;
  spread: number; // radians
  spinUp?: number; // seconds of wind-up before firing
  chargeTime?: number; // hold to charge, release to fire
  pierce?: boolean; // ignores cover
  speed?: number; // projectile speed
  gravity?: number; // projectile gravity
  splash?: number; // splash radius
  splashDamage?: number;
  knockback?: number;
  chargedMult?: number; // lance / stomp bonus when charged
  arc?: number; // melee: min dot product with aim
  blurb: string;
}

export type AbilityId =
  | "dash"
  | "leap"
  | "blink"
  | "bulwark"
  | "slide"
  | "guard"
  | "promote"
  | "stomp"
  | "mark"
  | "rampart"
  | "barrage"
  | "shockwave";

export interface AbilityDef {
  id: AbilityId;
  key: "E" | "Q";
  name: string;
  cooldown: number;
  duration: number;
  icon: string;
  blurb: string;
}

export interface PieceDef {
  type: PieceType;
  name: string;
  title: string;
  hp: number;
  speed: number;
  jump: number;
  height: number;
  power: number; // 1..6 for guide display
  accent: string;
  primary: WeaponDef;
  secondary?: WeaponDef;
  /** Weapons that are fired by an ability rather than a mouse button. */
  abilityWeapons?: WeaponDef[];
  aim?: { fov: number; spreadMult: number; label: string; blurb: string };
  abilities: [AbilityDef, AbilityDef];
  passive?: { name: string; blurb: string };
  guide: {
    summary: string;
    howTo: string[];
    strongVs: string;
    weakVs: string;
  };
}

export const PIECES: Record<PieceType, PieceDef> = {
  p: {
    type: "p",
    name: "Pawn",
    title: "The Foot Soldier",
    hp: 80,
    speed: 7.8,
    jump: 8,
    height: 1.5,
    power: 1,
    accent: "#9ca3af",
    primary: {
      id: "p_pistol",
      name: "Militia Pistol",
      button: "LMB",
      kind: "hitscan",
      damage: 12,
      headMult: 2,
      cooldown: 0.28,
      range: 90,
      auto: false,
      mag: 12,
      reload: 1.2,
      spread: 0.012,
      blurb: "Semi-automatic sidearm. One click, one shot. Headshots deal double damage.",
    },
    aim: {
      fov: 56,
      spreadMult: 0.25,
      label: "Iron Sights",
      blurb: "Hold to zoom slightly and shoot almost perfectly straight. Moves you slower.",
    },
    abilities: [
      {
        id: "dash",
        key: "E",
        name: "Forward March",
        cooldown: 4,
        duration: 0.18,
        icon: "»",
        blurb: "A short, fast dash in the direction you are moving. Dodge a shot or close the gap.",
      },
      {
        id: "promote",
        key: "Q",
        name: "Battlefield Promotion",
        cooldown: 24,
        duration: 6,
        icon: "♛",
        blurb: "Get promoted mid-fight: instantly heal 25 HP, then deal 30% more damage and move 15% faster for 6 seconds.",
      },
    ],
    passive: {
      name: "Underdog",
      blurb: "Below 40% health you deal 25% more damage and move 20% faster.",
    },
    guide: {
      summary: "Small, quick and fragile. A pawn can't win a slugfest, but a smart one can still take down a giant.",
      howTo: [
        "Tap the left mouse button to shoot — it's semi-auto, so don't hold it down.",
        "You are the smallest target in the arena. Strafe constantly and duck behind low walls.",
        "Aim for the head: 24 damage per headshot adds up fast.",
        "Save Forward March (E) to dodge a rocket or a lance charge, then punish.",
        "Press Q to get promoted: heal, hit harder and run faster. Use it when a fight turns close.",
      ],
      strongVs: "Other pawns, and anyone who stands still.",
      weakVs: "Sustained automatic fire from Rooks, Queens and Kings.",
    },
  },
  n: {
    type: "n",
    name: "Knight",
    title: "The Lancer",
    hp: 120,
    speed: 8.7,
    jump: 8.5,
    height: 1.85,
    power: 3,
    accent: "#f59e0b",
    primary: {
      id: "n_lance",
      name: "Cavalry Lance",
      button: "LMB",
      kind: "melee",
      damage: 38,
      headMult: 1,
      cooldown: 0.65,
      range: 4.8,
      auto: true,
      spread: 0,
      knockback: 7,
      chargedMult: 1.6,
      arc: 0.72,
      blurb:
        "Long-reach melee thrust. A CHARGED thrust (sprinting at full speed, or in mid-air after a leap) hits 60% harder and launches the target.",
    },
    secondary: {
      id: "n_javelin",
      name: "Throwing Javelin",
      button: "RMB",
      kind: "projectile",
      damage: 32,
      headMult: 1.5,
      cooldown: 2.6,
      range: 120,
      auto: false,
      spread: 0.004,
      speed: 44,
      gravity: 9,
      blurb: "Lobbed spear that drops over distance. Slow to re-throw — make it count.",
    },
    abilityWeapons: [
      {
        id: "n_stomp",
        name: "Hoof Stomp",
        button: "Q",
        kind: "melee",
        damage: 38,
        headMult: 1,
        cooldown: 1,
        range: 6.5,
        auto: false,
        spread: 0,
        splash: 6.5,
        splashDamage: 38,
        knockback: 11,
        chargedMult: 1.35,
        blurb: "Ground-slam shockwave.",
      },
    ],
    abilities: [
      {
        id: "leap",
        key: "E",
        name: "L-Leap",
        cooldown: 3.5,
        duration: 0.9,
        icon: "♞",
        blurb:
          "Vault forward and over cover. Hold A or D while leaping to add the sideways 'L' hop. Your lance is charged while airborne.",
      },
      {
        id: "stomp",
        key: "Q",
        name: "Hoof Stomp",
        cooldown: 11,
        duration: 0,
        icon: "◎",
        blurb:
          "Slam the ground: a 6.5 m shockwave that damages and launches enemies. Use it in mid-air to dive down and hit 35% harder.",
      },
    ],
    guide: {
      summary: "The only piece that jumps over things. Deadly up close, awkward at range.",
      howTo: [
        "Close the distance with L-Leap (E) — it carries you over walls and crates.",
        "Hold Shift to sprint: a sprinting or airborne thrust is CHARGED for 61 damage and a big knockback.",
        "Leap, then press Q in mid-air: you dive-bomb into a stronger Hoof Stomp.",
        "Throw a javelin (right-click) to chip enemies who are hiding. Aim a little above the target for long throws.",
        "Never stand still in the open at range — you have nothing that shoots fast.",
      ],
      strongVs: "Pawns, Bishops and anyone fighting around cover.",
      weakVs: "Rooks and Kings who can mow you down as you approach.",
    },
  },
  b: {
    type: "b",
    name: "Bishop",
    title: "The Marksman",
    hp: 95,
    speed: 7.3,
    jump: 7.5,
    height: 1.95,
    power: 3,
    accent: "#38bdf8",
    primary: {
      id: "b_rifle",
      name: "Diagonal Rifle",
      button: "LMB",
      kind: "hitscan",
      damage: 52,
      headMult: 2,
      cooldown: 1.25,
      range: 260,
      auto: false,
      mag: 5,
      reload: 2,
      spread: 0.045,
      blurb: "Bolt-action sniper. 52 body / 104 head damage. Wildly inaccurate unless scoped.",
    },
    aim: {
      fov: 22,
      spreadMult: 0,
      label: "Scope",
      blurb: "Hold to zoom 3.5× with pinpoint accuracy. You move much slower while scoped.",
    },
    abilities: [
      {
        id: "blink",
        key: "E",
        name: "Diagonal Blink",
        cooldown: 4,
        duration: 0,
        icon: "✦",
        blurb:
          "Teleport 10 metres on a diagonal. Defaults to forward-right; hold A for forward-left, hold S to blink backwards.",
      },
      {
        id: "mark",
        key: "Q",
        name: "Divine Mark",
        cooldown: 18,
        duration: 6,
        icon: "✚",
        blurb: "Mark the enemy for 6 seconds: you see them through walls and they take 20% more damage from every source.",
      },
    ],
    guide: {
      summary: "Slow but devastating. Every shot you land has to count — and every shot you miss is a gift.",
      howTo: [
        "Hold right-click to scope in, then left-click. Un-scoped shots spray wildly.",
        "Aim for the head: 104 damage one-shots Pawns, Bishops and nearly everything else.",
        "Pop Divine Mark (Q) to track an enemy behind cover and make your next shots hurt more.",
        "After every shot, Blink (E) to a new angle — snipers who stay put get found.",
        "You only have 5 rounds. Reload (R) behind cover.",
      ],
      strongVs: "Slow targets, Rooks and Kings who must stand in the open.",
      weakVs: "Knights and Queens who rush you before the scope settles.",
    },
  },
  r: {
    type: "r",
    name: "Rook",
    title: "The Fortress",
    hp: 170,
    speed: 5.5,
    jump: 6.5,
    height: 1.9,
    power: 4,
    accent: "#ef4444",
    primary: {
      id: "r_chaingun",
      name: "Rampart Chaingun",
      button: "LMB",
      kind: "hitscan",
      damage: 5.5,
      headMult: 1.5,
      cooldown: 0.085,
      range: 80,
      auto: true,
      mag: 100,
      reload: 3,
      spread: 0.035,
      spinUp: 0.45,
      blurb: "Heavy rotary gun. Needs a moment to spin up, then hoses out bullets. Slows you while firing.",
    },
    abilities: [
      {
        id: "bulwark",
        key: "E",
        name: "Bulwark",
        cooldown: 9,
        duration: 3.2,
        icon: "▣",
        blurb: "Raise a tower shield: take 65% less damage for 3.2 seconds, but move at half speed.",
      },
      {
        id: "rampart",
        key: "Q",
        name: "Rampart Wall",
        cooldown: 16,
        duration: 8,
        icon: "▥",
        blurb: "Raise a solid stone wall in front of you for 8 seconds. It blocks movement and bullets for everyone.",
      },
    ],
    guide: {
      summary: "A walking castle. Slow, tough and terrifying down a straight line.",
      howTo: [
        "Hold left-click to spin up the chaingun. It takes 0.45 s before bullets come out, so start early.",
        "Fire in the open lanes; the spread is wide, so close to mid-range is where it shines.",
        "Pop Bulwark (E) when you're being shot or when a Knight is charging you.",
        "Drop a Rampart Wall (Q) to cut off a sniper's lane — or to wall yourself in and reload safely.",
        "100 rounds is plenty, but reload (R) while behind cover — it takes 3 seconds.",
      ],
      strongVs: "Pawns, Knights and anything that must close in.",
      weakVs: "Bishops sniping from range, and Queens who out-manoeuvre you.",
    },
  },
  q: {
    type: "q",
    name: "Queen",
    title: "The Sovereign's Blade",
    hp: 150,
    speed: 9.4,
    jump: 8.5,
    height: 2.0,
    power: 5,
    accent: "#e879f9",
    primary: {
      id: "q_carbine",
      name: "Royal Carbine",
      button: "LMB",
      kind: "hitscan",
      damage: 8.5,
      headMult: 2,
      cooldown: 0.095,
      range: 110,
      auto: true,
      mag: 32,
      reload: 1.5,
      spread: 0.018,
      blurb: "Fast, accurate automatic rifle with a big magazine and a quick reload.",
    },
    secondary: {
      id: "q_rocket",
      name: "Sovereign Rocket",
      button: "RMB",
      kind: "projectile",
      damage: 45,
      headMult: 1,
      cooldown: 1.7,
      range: 140,
      auto: false,
      spread: 0.004,
      speed: 30,
      gravity: 0,
      splash: 4.5,
      splashDamage: 40,
      knockback: 9,
      blurb: "Explosive rocket: 45 direct damage, or up to 40 splash if it lands near the target.",
    },
    abilityWeapons: [
      {
        id: "q_barrage",
        name: "Royal Barrage",
        button: "Q",
        kind: "projectile",
        damage: 24,
        headMult: 1,
        cooldown: 0.1,
        range: 140,
        auto: false,
        spread: 0.03,
        speed: 34,
        gravity: 0,
        splash: 3.5,
        splashDamage: 18,
        knockback: 3,
        blurb: "A volley of mini-rockets.",
      },
    ],
    abilities: [
      {
        id: "slide",
        key: "E",
        name: "Queen's Slide",
        cooldown: 4.5,
        duration: 0.22,
        icon: "≫",
        blurb: "A lightning dash 16 metres in any direction you are moving — along a rank, file or diagonal.",
      },
      {
        id: "barrage",
        key: "Q",
        name: "Royal Barrage",
        cooldown: 14,
        duration: 0.6,
        icon: "✹",
        blurb: "Unleash a volley of four mini-rockets (24 direct, 18 splash each) at wherever you are aiming.",
      },
    ],
    guide: {
      summary: "Fast, versatile and lethal. She moves like every piece at once — and fights like it too.",
      howTo: [
        "Strafe-shoot with the carbine (left-click). Short bursts stay more accurate.",
        "Rockets (right-click) don't have to hit directly — aim at the floor or wall by their feet.",
        "Queen's Slide (E) crosses the arena in a blink. Slide in, burst, slide out.",
        "Open with Royal Barrage (Q) to force an enemy out of cover, then finish with the carbine.",
        "She has less armour than the Rook or King, so avoid straight shootouts with them.",
      ],
      strongVs: "Pawns, Knights, Bishops and Rooks.",
      weakVs: "The King — the only piece that out-guns her.",
    },
  },
  k: {
    type: "k",
    name: "King",
    title: "The Sovereign",
    hp: 240,
    speed: 6.2,
    jump: 5.5,
    height: 2.1,
    power: 6,
    accent: "#facc15",
    primary: {
      id: "k_scepter",
      name: "Scepter Cannon",
      button: "LMB",
      kind: "hitscan",
      damage: 24,
      headMult: 1.75,
      cooldown: 0.3,
      range: 130,
      auto: true,
      mag: 20,
      reload: 1.4,
      spread: 0.008,
      blurb: "Rapid, laser-accurate energy bolts. 24 per hit, 42 to the head.",
    },
    secondary: {
      id: "k_decree",
      name: "Royal Decree",
      button: "RMB",
      kind: "hitscan",
      damage: 90,
      headMult: 1.6,
      cooldown: 2.8,
      range: 340,
      auto: false,
      spread: 0,
      chargeTime: 0.8,
      pierce: true,
      blurb: "Hold to charge for 0.8 s, release to fire a railgun beam that pierces cover. 90 damage (144 to the head).",
    },
    abilityWeapons: [
      {
        id: "k_shockwave",
        name: "Royal Shockwave",
        button: "Q",
        kind: "melee",
        damage: 45,
        headMult: 1,
        cooldown: 1,
        range: 10,
        auto: false,
        spread: 0,
        splash: 10,
        splashDamage: 45,
        knockback: 15,
        blurb: "Radial blast.",
      },
    ],
    abilities: [
      {
        id: "guard",
        key: "E",
        name: "Royal Guard",
        cooldown: 14,
        duration: 1.6,
        icon: "♔",
        blurb: "Become completely invulnerable for 1.6 seconds.",
      },
      {
        id: "shockwave",
        key: "Q",
        name: "Royal Shockwave",
        cooldown: 15,
        duration: 0,
        icon: "◉",
        blurb: "Command the room: a 10 m shockwave that deals up to 45 damage and hurls everyone nearby away from you.",
      },
    ],
    passive: {
      name: "Heavy is the Crown",
      blurb: "The slowest, biggest target in the arena, and he can barely jump. If your King loses a fight, you lose the game.",
    },
    guide: {
      summary: "The strongest piece with the strongest weapons — but lose a King fight and the whole game is over.",
      howTo: [
        "Hold left-click for a stream of accurate bolts. You out-trade almost every piece.",
        "Use Decree (hold right-click, release to fire) on enemies behind walls: it pierces cover.",
        "Royal Guard (E) makes you invulnerable for 1.6 s — use it to survive a rocket or a burst.",
        "Royal Shockwave (Q) punishes anyone who gets close. Combine it with Guard to hold a position.",
        "Think twice before capturing with your King: a defeat ends the entire match.",
      ],
      strongVs: "Everything. Even a Queen.",
      weakVs: "Nothing in particular — but a lucky pawn headshot streak still hurts.",
    },
  },
};

export const PIECE_ORDER: PieceType[] = ["k", "q", "r", "b", "n", "p"];

export const WEAPONS: Record<string, WeaponDef & { owner: PieceType }> = {};
for (const def of Object.values(PIECES)) {
  WEAPONS[def.primary.id] = { ...def.primary, owner: def.type };
  if (def.secondary) WEAPONS[def.secondary.id] = { ...def.secondary, owner: def.type };
  for (const w of def.abilityWeapons ?? []) WEAPONS[w.id] = { ...w, owner: def.type };
}

// Hit shapes are derived from the piece height so the models and hitboxes agree.
export const hitShape = (height: number) => ({
  bodyR: 0.25 * height,
  bodyTop: 0.76 * height,
  headY: 0.87 * height,
  headR: 0.14 * height,
  eye: 0.9 * height,
});

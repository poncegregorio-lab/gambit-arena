"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, usePlayer } from "@/lib/client";
import { PIECES, PIECE_ORDER } from "@/lib/fight/weapons";
import type { OpenGame } from "@/lib/types";
import { PieceIcon } from "./PieceIcon";
import { DifficultyPicker } from "./DifficultyPicker";
import { MapPicker } from "./MapPicker";
import { WifiPanel } from "./WifiPanel";
import { isMapChoice } from "@/lib/fight/maps";
import { DEFAULT_BOT_SETTINGS, readBotSettings, type BotSettings } from "@/lib/bots/difficulty";

type Pref = "white" | "black" | "random";

export function Lobby() {
  const router = useRouter();
  const { player, setName } = usePlayer();
  const [name, setNameInput] = useState("");
  const [pref, setPref] = useState<Pref>("random");
  const [mode, setMode] = useState<"online" | "bot">("bot");
  const [mapPref, setMapPref] = useState("random");
  const [botSettings, setBotSettings] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenGame[]>([]);

  useEffect(() => {
    if (player) setNameInput((n) => n || player.name);
  }, [player]);

  useEffect(() => {
    try {
      const saved = readBotSettings(JSON.parse(localStorage.getItem("ga:botSettings") ?? "null"));
      if (saved) setBotSettings(saved);
      const savedMap = localStorage.getItem("ga:map");
      if (isMapChoice(savedMap)) setMapPref(savedMap);
    } catch { /* Use defaults if storage is unavailable. */ }
  }, []);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const load = async () => {
      try {
        const r = await api<{ games: OpenGame[] }>("/api/games");
        if (!stop) setOpen(r.games);
      } catch {
        /* ignore */
      }
      if (!stop) timer = window.setTimeout(load, 4000);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  async function create() {
    if (!player) return;
    setBusy(true);
    setError(null);
    try {
      setName(name.trim());
      if (mode === "bot") {
        try { localStorage.setItem("ga:botSettings", JSON.stringify(botSettings)); } catch { /* Optional preference. */ }
      }
      try { localStorage.setItem("ga:map", mapPref); } catch { /* Optional preference. */ }
      const r = await api<{ id: string }>("/api/games", {
        playerId: player.id, name: name.trim(), color: pref, mode, map: mapPref,
        ...(mode === "bot" ? { bot: botSettings } : {}),
      });
      router.push(`/game/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the game");
      setBusy(false);
    }
  }

  function join(id: string) {
    const clean = id.trim().toUpperCase();
    if (clean.length < 4) {
      setError("Enter a game code");
      return;
    }
    if (name.trim()) setName(name.trim());
    router.push(`/game/${clean}`);
  }

  const prefs: { id: Pref; label: string; icon: React.ReactNode }[] = [
    { id: "white", label: "White", icon: <PieceIcon type="k" color="w" size={28} /> },
    { id: "random", label: "Random", icon: <span className="text-xl">🎲</span> },
    { id: "black", label: "Black", icon: <PieceIcon type="k" color="b" size={28} /> },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10">
      <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr]">
        <section className="fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
            ⚔ Online chess · 3D capture duels
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl">
            Chess, but every capture is a <span className="text-amber-300">firefight</span>.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#a3acc1]">
            Challenge a friend online or take on a bot with separately adjustable chess and combat skills. When a piece takes another, both pieces drop into a first-person arena —
            each with its own weapons and abilities. Win the duel, win the square.
          </p>

          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Play chess", "Castling, en passant, promotion, check — all the real rules."],
              ["2", "Capture = duel", "Attacker and defender fight it out in 3D for 75 seconds."],
              ["3", "Winner takes it", "Attacker wins: capture succeeds. Defender wins: attacker is destroyed."],
            ].map(([n, t, d]) => (
              <li key={n} className="card p-4">
                <div className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-sm font-bold text-amber-300">{n}</div>
                <div className="mt-3 text-sm font-semibold text-white">{t}</div>
                <p className="mt-1 text-[13px] leading-snug text-[#8d96ab]">{d}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/practice" className="btn btn-ghost">
              🎯 Try a duel vs a bot
            </Link>
            <Link href="/guide" className="btn btn-ghost">
              📖 Read the piece guide
            </Link>
          </div>
        </section>

        <section className="fade-up space-y-4" style={{ animationDelay: "80ms" }}>
          <div className="card p-6">
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.06] bg-black/20 p-1" role="tablist" aria-label="Choose opponent">
              {(["bot", "online"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === m ? "bg-white/10 text-white shadow-sm" : "text-[#8d96ab] hover:text-white"}`}>
                  {m === "bot" ? "🤖 Play a bot" : "↗ Play online"}
                </button>
              ))}
            </div>
            <h2 className="text-lg font-semibold text-white">{mode === "bot" ? "Your bot, your challenge" : "Play with a friend"}</h2>
            <p className="mt-1 text-[13px] text-[#8d96ab]">{mode === "bot" ? "A full chess match, with a real 3D duel for every capture. No waiting for an opponent." : "No account needed — create a game and send the link to a friend."}</p>

            <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-[#6f788d]">Your name</label>
            <input
              className="input mt-1.5"
              placeholder="Anonymous"
              maxLength={24}
              value={name}
              onChange={(e) => setNameInput(e.target.value)}
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-[#6f788d]">Play as</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {prefs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPref(p.id)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${
                    pref === p.id ? "border-amber-300/70 bg-amber-300/10 text-white" : "border-white/10 bg-white/[0.03] text-[#9aa3b8] hover:bg-white/[0.07]"
                  }`}
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-5 border-t border-white/[0.06] pt-4">
              <MapPicker value={mapPref} onChange={setMapPref} />
            </div>
            {mode === "bot" && (
              <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-4">
                <DifficultyPicker kind="board" value={botSettings.boardDifficulty} onChange={(boardDifficulty) => setBotSettings((s) => ({ ...s, boardDifficulty }))} />
                <DifficultyPicker kind="fight" value={botSettings.fightDifficulty} onChange={(fightDifficulty) => setBotSettings((s) => ({ ...s, fightDifficulty }))} />
                <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-[#8d96ab]">
                  Mix them freely — Expert chess + Easy fights, or the other way around. Piece health and damage stay the same at every level.
                </div>
              </div>
            )}
            <button className="btn btn-primary mt-5 w-full !py-3" disabled={!player || busy} onClick={() => void create()}>
              {busy ? "Creating…" : mode === "bot" ? "Start bot game" : "Create game"}
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-[#6f788d]">
              <span className="h-px flex-1 bg-white/10" />
              or join with a code
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                join(code);
              }}
            >
              <input
                className="input font-mono uppercase tracking-[0.25em]"
                placeholder="ABC123"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button className="btn btn-ghost !px-5" type="submit">
                Join
              </button>
            </form>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          </div>

          <WifiPanel />

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Open games</h3>
              <span className="flex items-center gap-1.5 text-[11px] text-[#6f788d]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live
              </span>
            </div>
            {open.length === 0 ? (
              <p className="mt-3 text-sm text-[#6f788d]">No one is waiting right now. Create a game and invite someone!</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {open
                  .filter((g) => g.id)
                  .map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <PieceIcon type="k" color={g.hostColor === "white" ? "w" : "b"} size={26} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{g.hostName}</div>
                          <div className="text-[11px] text-[#6f788d]">
                            plays {g.hostColor} · <span className="font-mono">{g.id}</span>
                          </div>
                        </div>
                      </div>
                      <button className="btn btn-primary !px-3.5 !py-1.5 !text-xs" onClick={() => join(g.id)}>
                        Join
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-14">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">The roster</h2>
            <p className="text-sm text-[#8d96ab]">Every piece fights differently. The King and Queen are the heaviest hitters.</p>
          </div>
          <Link href="/guide" className="text-sm font-semibold text-amber-300 hover:underline">
            Full guide →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIECE_ORDER.map((p) => {
            const d = PIECES[p];
            return (
              <div key={p} className="card flex items-center gap-4 p-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
                  <PieceIcon type={p} color="w" size={44} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-white">{d.name}</span>
                    <span className="text-[11px] tabular-nums text-[#6f788d]">{d.hp} HP</span>
                  </div>
                  <div className="truncate text-[13px] text-[#9aa3b8]">
                    {d.primary.name}
                    {d.secondary ? ` · ${d.secondary.name}` : ""}
                  </div>
                  <div className="truncate text-[12px]" style={{ color: d.accent }}>
                    E {d.abilities[0].name} · Q {d.abilities[1].name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
